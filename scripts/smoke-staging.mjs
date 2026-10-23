// Black-box smoke test against a DEPLOYED staging backend (HTTPS). Run from an allowlisted workstation:
//   STAGING_URL=https://staging.sultonxoja.uz node scripts/smoke-staging.mjs [--order]
// Default = read-only probes (no data written except ONE orphan guest profile when --guest is given). --order additionally walks one MOCK
// checkout (guest -> quote -> order -> MOCK payment) which creates one test order; it needs an eligible taxi company on the server.
// No secret is read or printed; guest tokens live in memory only.
import { randomUUID } from 'node:crypto';

const BASE = (process.env.STAGING_URL ?? '').replace(/\/$/, '');
if (!/^https:\/\/[a-z0-9.-]+$/.test(BASE)) { console.error('Set STAGING_URL=https://<host> (https only).'); process.exit(2); }
const wantOrder = process.argv.includes('--order');
const wantGuest = wantOrder || process.argv.includes('--guest');

let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const call = async (method, path, { headers = {}, body } = {}) => {
  const res = await fetch(BASE + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  let json = null; try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
};

// 1. health: liveness, readiness with coarse body only
const live = await call('GET', '/health/live');
check('GET /health/live = 200', live.status === 200);
const ready = await call('GET', '/health/ready');
check('GET /health/ready = 200, database up', ready.status === 200 && ready.json?.checks?.database === 'up', JSON.stringify(ready.json?.checks ?? {}));
check('readiness body leaks nothing beyond coarse states', !/postgres|password|token|@/i.test(JSON.stringify(ready.json ?? {})));

// 2. private endpoints must refuse anonymous callers
const anon = [
  ['GET', '/api/v1/miniapp/config'], ['GET', '/api/v1/miniapp/me'], ['GET', '/api/v1/miniapp/orders'],
  ['GET', '/api/v1/restaurant/auth/me'], ['GET', '/api/v1/restaurant/orders'],
  ['GET', '/api/v1/internal/orders'], ['GET', '/api/v1/internal/cards'], ['POST', '/api/v1/internal/payments/mock-incoming'],
];
for (const [m, p] of anon) {
  const r = await call(m, p, m === 'POST' ? { body: {} } : {});
  // the shared edge proxy answers 404 for /api/v1/internal (never public); the backend itself answers 401/403
  check(`anonymous ${m} ${p} is refused`, (p.startsWith('/api/v1/internal') ? [401, 403, 404] : [401, 403]).includes(r.status), String(r.status));
}
const badGuest = await call('GET', '/api/v1/miniapp/me', { headers: { authorization: 'Bearer dsg_' + 'A'.repeat(43) } });
check('unknown guest credential = 401', badGuest.status === 401, String(badGuest.status));
const badTma = await call('GET', '/api/v1/miniapp/me', { headers: { authorization: 'tma user=%7B%22id%22%3A1%7D&hash=00', 'x-platform': 'android' } });
check('forged Telegram initData (+ spoofed X-Platform) = 401', badTma.status === 401, String(badTma.status));
const badKey = await call('GET', '/api/v1/internal/orders', { headers: { 'x-api-key': 'x'.repeat(40), 'x-internal-api-key': 'x'.repeat(40) } });
check('wrong internal API key is refused', [401, 403, 404].includes(badKey.status), String(badKey.status));

// 3. optional: guest session and ownership
if (wantGuest) {
  const g = await call('POST', '/api/v1/miniapp/guest/session', { body: { installationId: randomUUID() } });
  const token = g.json?.token ?? null;
  check('guest bootstrap issues a dsg_ credential', g.status === 200 || g.status === 201 ? /^dsg_[A-Za-z0-9_-]{43}$/.test(String(token)) : false, String(g.status));
  if (token) {
    const auth = { authorization: `Bearer ${token}` };
    const me = await call('GET', '/api/v1/miniapp/me', { headers: auth });
    check('guest can read its own profile', me.status === 200, String(me.status));
    const list = await call('GET', '/api/v1/miniapp/restaurants', { headers: auth });
    const restaurants = list.json?.restaurants ?? [];
    check('catalog visible to guest', list.status === 200 && restaurants.length > 0, `${restaurants.length} restaurants`);
    if (wantOrder && restaurants[0]) {
      const r = restaurants[0];
      const menu = await call('GET', `/api/v1/miniapp/restaurants/${r.id}/menu`, { headers: auth });
      const product = (menu.json?.products ?? []).find(p => p.isAvailable);
      check('menu has a product', menu.status === 200 && Boolean(product?.id));
      if (product) {
        const items = [{ productId: product.id, quantity: 1 }];
        const quote = await call('POST', '/api/v1/miniapp/quote', { headers: auth, body: { restaurantId: r.id, items } });
        check('quote ok', quote.status === 200 && quote.json?.ok === true, String(quote.status));
        const order = await call('POST', '/api/v1/miniapp/orders', { headers: auth, body: {
          checkoutKey: randomUUID(), restaurantId: r.id, items, expectedTotalSom: quote.json?.totalSom ?? 0,
          phone: '+998900000000', address: { addressText: 'STAGING TEST: Toshkent, test manzil' } } });
        check('MOCK order created (201)', order.status === 201, `${order.status} ${order.json?.error ?? ''}`);
        const id = order.json?.order?.id;
        if (id) {
          const mine = await call('GET', `/api/v1/miniapp/orders/${id}`, { headers: auth });
          check('guest reads its own order', mine.status === 200);
          const other = await call('POST', '/api/v1/miniapp/guest/session', { body: { installationId: randomUUID() } });
          const otherAuth = { authorization: `Bearer ${other.json?.token}` };
          const stolen = await call('GET', `/api/v1/miniapp/orders/${id}`, { headers: otherAuth });
          check('another guest cannot read that order (404)', stolen.status === 404, String(stolen.status));
          const paid = await call('POST', `/api/v1/miniapp/orders/${id}/mock-payment`, { headers: auth });
          check('MOCK payment accepted', paid.status === 200, `${paid.status} ${paid.json?.error ?? ''}`);
        }
      }
    }
  }
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
