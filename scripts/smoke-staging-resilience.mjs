// Resilience checks against the DEPLOYED staging stack (MOCK payments only). Run from an allowlisted workstation that can `ssh ds-staging`:
//   STAGING_URL=https://staging.example STAGING_SSH=ds-staging SMOKE_RESTAURANT_ID=... SMOKE_PRODUCT_ID=... node scripts/smoke-staging-resilience.mjs
// It briefly restarts the backend and stops/starts the database container (a few seconds each; staging only). It creates 2 guest orders.
//   1. an order survives a backend restart and the same checkoutKey replays to the same order (no duplicate);
//   2. while the database is down an order is NOT created (no 201) and the readiness probe says 503;
//   3. after the database returns, retrying the same checkoutKey creates exactly ONE order, and the MOCK payment works.
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const need = n => { const v = process.env[n]; if (!v) { console.error(`Set ${n}`); process.exit(2); } return v; };
const BASE = need('STAGING_URL').replace(/\/$/, '');
const SSH = need('STAGING_SSH');
const [RID, PID] = ['SMOKE_RESTAURANT_ID', 'SMOKE_PRODUCT_ID'].map(need);
if (!/^https:\/\/[a-z0-9.-]+$/.test(BASE) || !/^[a-z0-9_-]+$/i.test(SSH)) { console.error('bad STAGING_URL / STAGING_SSH'); process.exit(2); }

let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sh = cmd => execFileSync('ssh', ['-o', 'BatchMode=yes', SSH, cmd], { encoding: 'utf8', timeout: 120_000 });
const call = async (method, path, { headers = {}, body } = {}) => {
  try {
    const res = await fetch(BASE + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
    let json = null; try { json = await res.json(); } catch { /* none */ }
    return { status: res.status, json };
  } catch (e) { return { status: 0, json: null, error: String(e.cause?.code ?? e.message) }; }
};
const waitUntil = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(1500); } return false; };

const g = await call('POST', '/api/v1/miniapp/guest/session', { body: { installationId: randomUUID() } });
check('guest session', g.status === 201, String(g.status) + (g.error ? ' ' + g.error : ''));
const auth = { authorization: `Bearer ${g.json?.token}` };
// a random quantity gives a unique amount, so leftover unpaid orders from earlier runs cannot hold the single MOCK card
const items = [{ productId: PID, quantity: 1 + Math.floor(Math.random() * 29) }];
const quote = await call('POST', '/api/v1/miniapp/quote', { headers: auth, body: { restaurantId: RID, items } });
const mkBody = key => ({ checkoutKey: key, restaurantId: RID, items, expectedTotalSom: quote.json?.totalSom ?? 0, phone: '+998900000009', address: { addressText: 'SMOKE: resilience test' } });
const ordersCount = async () => (await call('GET', '/api/v1/miniapp/orders', { headers: auth })).json?.orders?.length ?? -1;

// 1. backend restart
const k1 = randomUUID();
const o1 = await call('POST', '/api/v1/miniapp/orders', { headers: auth, body: mkBody(k1) });
check('order created before the restart', o1.status === 201, `${o1.status} ${o1.json?.error ?? ''}`);
sh('docker restart ds-staging-backend-1 >/dev/null');
check('backend ready again after the restart', await waitUntil(async () => (await call('GET', '/health/live')).status === 200, 90_000));
const again = await call('POST', '/api/v1/miniapp/orders', { headers: auth, body: mkBody(k1) });
check('same checkoutKey after the restart replays the SAME order (no duplicate)', again.status === 200 && again.json?.replayed === true && again.json?.order?.id === o1.json?.order?.id, `${again.status}`);
check('order and session survived the restart', (await call('GET', `/api/v1/miniapp/orders/${o1.json?.order?.id}`, { headers: auth })).status === 200);
check('exactly one order exists', (await ordersCount()) === 1);

// 2. database down
const k2 = randomUUID();
sh('docker stop ds-staging-db-1 >/dev/null');
await sleep(3000);
const ready = await call('GET', '/health/live');
check('liveness stays 200 while the database is down', ready.status === 200);
const down = await call('POST', '/api/v1/miniapp/orders', { headers: auth, body: mkBody(k2) });
check('no order is created while the database is down (no 201)', down.status !== 201 && down.status !== 200, String(down.status));
sh('docker start ds-staging-db-1 >/dev/null');
check('service recovers by itself after the database returns', await waitUntil(async () => (await call('GET', '/api/v1/miniapp/orders', { headers: auth })).status === 200, 90_000));

// 3. retry
const retry = await call('POST', '/api/v1/miniapp/orders', { headers: auth, body: mkBody(k2) });
check('retry with the same checkoutKey creates the order', retry.status === 201, `${retry.status} ${retry.json?.error ?? ''}`);
check('exactly two orders in total (no ghost order from the failed attempt)', (await ordersCount()) === 2);
// both orders have the same amount and the throwaway restaurant has ONE card, so only the first order holds it (the second is queued): pay the first
check('MOCK payment works after all of it', (await call('POST', `/api/v1/miniapp/orders/${o1.json?.order?.id}/mock-payment`, { headers: auth, body: {} })).status === 200);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
