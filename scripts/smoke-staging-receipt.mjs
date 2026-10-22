// End-to-end check of the refund receipt photo against a DEPLOYED staging backend (HTTPS, MOCK payments only):
//   customer (guest) orders -> MOCK payment -> restaurant cancels (refund opens) -> restaurant uploads ONE receipt photo -> customer reads it back.
// It needs a THROWAWAY restaurant on the server that you control (slug + API password) with one product, and an eligible taxi company.
//   STAGING_URL=https://staging.example SMOKE_RESTAURANT_SLUG=... SMOKE_RESTAURANT_PASSWORD=... SMOKE_RESTAURANT_ID=... SMOKE_PRODUCT_ID=... \
//     node scripts/smoke-staging-receipt.mjs
// Credentials come from the environment only and are never printed. Creates one test order and one refund on the target (history is never deleted).
import { randomBytes, randomUUID } from 'node:crypto';

const need = n => { const v = process.env[n]; if (!v) { console.error(`Set ${n}`); process.exit(2); } return v; };
const BASE = need('STAGING_URL').replace(/\/$/, '');
if (!/^https:\/\/[a-z0-9.-]+$/.test(BASE)) { console.error('STAGING_URL must be https://host'); process.exit(2); }
const [SLUG, PW, RID, PID] = ['SMOKE_RESTAURANT_SLUG', 'SMOKE_RESTAURANT_PASSWORD', 'SMOKE_RESTAURANT_ID', 'SMOKE_PRODUCT_ID'].map(need);

let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const call = async (method, path, { headers = {}, body, raw } = {}) => {
  const res = await fetch(BASE + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  let json = null; try { json = await res.json(); } catch { /* none */ }
  return { status: res.status, json };
};
const jpeg = (n = 3000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(n)]);

// customer: guest -> order -> MOCK payment
const g = await call('POST', '/api/v1/miniapp/guest/session', { body: { installationId: randomUUID() } });
const cust = { authorization: `Bearer ${g.json?.token}` };
const items = [{ productId: PID, quantity: 1 }];
const quote = await call('POST', '/api/v1/miniapp/quote', { headers: cust, body: { restaurantId: RID, items } });
check('quote ok', quote.status === 200 && quote.json?.ok === true, String(quote.status));
const order = await call('POST', '/api/v1/miniapp/orders', { headers: cust, body: { checkoutKey: randomUUID(), restaurantId: RID, items,
  expectedTotalSom: quote.json?.totalSom ?? 0, phone: '+998900000009', address: { addressText: 'SMOKE: refund receipt test' } } });
check('order created', order.status === 201, `${order.status} ${order.json?.error ?? ''}`);
const id = order.json?.order?.id;
if (!id) process.exit(1);
check('MOCK payment', (await call('POST', `/api/v1/miniapp/orders/${id}/mock-payment`, { headers: cust, body: {} })).status === 200);

// restaurant: login, cancel (opens a refund already APPROVED)
const login = await call('POST', '/api/v1/restaurant/auth/login', { body: { slug: SLUG, password: PW } });
check('restaurant login', login.status === 200 && Boolean(login.json?.accessToken), String(login.status));
const rest = { authorization: `Bearer ${login.json?.accessToken}` };
const cancel = await call('POST', `/api/v1/restaurant/orders/${id}/cancel`, { headers: rest, body: { reason: 'OUT_OF_STOCK' } });
check('restaurant cancels the paid order -> refund APPROVED', cancel.status === 200 && cancel.json?.refund?.status === 'APPROVED', `${cancel.status} ${cancel.json?.error ?? ''}`);
check('customer sees no receipt yet (404)', (await call('GET', `/api/v1/miniapp/orders/${id}/refund/receipt`, { headers: cust })).status === 404);

// upload: refusals first, then the photo
const up = (buf, type, headers = rest) => call('POST', `/api/v1/restaurant/orders/${id}/refund/receipt`, { headers: { ...headers, 'content-type': type }, raw: buf });
check('anonymous upload refused (401)', (await up(jpeg(), 'image/jpeg', {})).status === 401);
check('not an image refused (400)', (await up(Buffer.from('hello '.repeat(400)), 'image/png')).status === 400);
check('> 5 MB refused (413)', (await up(Buffer.concat([jpeg(), Buffer.alloc(5 * 1024 * 1024)]), 'image/jpeg')).status === 413);
const photo = jpeg(4096);
const sent = await up(photo, 'image/jpeg');
check('receipt photo accepted -> refund SENT with a receipt', sent.status === 200 && sent.json?.refund?.status === 'SENT' && sent.json?.refund?.hasReceipt === true && sent.json?.refund?.bankReference === null, `${sent.status} ${sent.json?.error ?? ''}`);
check('a second photo after SENT is refused (409)', (await up(jpeg(), 'image/jpeg')).status === 409);

// customer reads it back
const view = await call('GET', `/api/v1/miniapp/orders/${id}`, { headers: cust });
check('customer order view: refund SENT, hasReceipt', view.json?.order?.refund?.status === 'SENT' && view.json?.order?.refund?.hasReceipt === true);
const got = await call('GET', `/api/v1/miniapp/orders/${id}/refund/receipt`, { headers: cust });
check('customer receives the exact bytes', got.status === 200 && got.json?.mime === 'image/jpeg' && Buffer.from(got.json?.dataBase64 ?? '', 'base64').equals(photo));
const other = await call('POST', '/api/v1/miniapp/guest/session', { body: { installationId: randomUUID() } });
check("another customer cannot read it (404)", (await call('GET', `/api/v1/miniapp/orders/${id}/refund/receipt`, { headers: { authorization: `Bearer ${other.json?.token}` } })).status === 404);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
