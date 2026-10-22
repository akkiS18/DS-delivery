import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { attemptKey, hashToken, setRestaurantPassword } from '../modules/restaurant-auth/service.js';
import { db as appDb } from '../lib/db.js';

// Small limits keep the throttle tests fast; they are read per call by the service.
process.env.RESTAURANT_LOGIN_MAX_FAILURES = '3';
process.env.RESTAURANT_LOGIN_IP_MAX_FAILURES = '1000';
process.env.RESTAURANT_MAX_SESSIONS = '4';

const db = new PrismaClient();
const app = buildApp(new PaymentEngineV3(db, defaultOptions, () => {}));
const nonce = randomUUID().slice(0, 8);
const slugA = `auth-a-${nonce}`;
const slugB = `auth-b-${nonce}`;
const slugC = `auth-c-${nonce}`;
const PW_A = `Alpha-${randomUUID()}`;
const PW_B = `Bravo-${randomUUID()}`;
const ids: Record<string, string> = {};
const ips: string[] = [];
const customerIds: string[] = [];
let orderA = '';
let orderB = '';

const freshIp = () => { const ip = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`; ips.push(ip); return ip; };
const post = (url: string, payload: unknown, ip = freshIp(), headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload: payload as object, remoteAddress: ip, headers });
const login = (slug: string, password: string, ip?: string) => post('/api/v1/restaurant/auth/login', { slug, password }, ip);
const get = (url: string, token?: string) =>
  app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });
const me = (token?: string) => get('/api/v1/restaurant/auth/me', token);
async function token(slug: string, pw: string): Promise<string> {
  const r = await login(slug, pw);
  assert.equal(r.statusCode, 200);
  return r.json().accessToken;
}

before(async () => {
  await db.$connect();
  for (const [key, slug] of [['a', slugA], ['b', slugB], ['c', slugC]] as const) {
    ids[key] = (await db.restaurant.create({ data: { slug, name: `Auth ${key}` } })).id;
  }
  await setRestaurantPassword({ slug: slugA, password: PW_A });
  await setRestaurantPassword({ slug: slugB, password: PW_B });
  // slugC deliberately has NO credential.
  const customer = await db.customer.create({ data: { telegramUserId: String(randomInt(100000000000, 900000000000)) } });
  customerIds.push(customer.id);
  const mk = (restaurantId: string) => db.order.create({ data: { restaurantId, customerId: customer.id, addressText: 'x', totalSom: 1000,
    items: { create: [{ name: 'Burger', unitSom: 1000, quantity: 1, subtotalSom: 1000 }] } } });
  orderA = (await mk(ids.a!)).id;
  orderB = (await mk(ids.b!)).id;
});
after(async () => {
  const keys = [slugA, slugB, slugC, 'no-such-slug-' + nonce].map(s => attemptKey('slug', s)).concat(ips.map(ip => attemptKey('ip', ip)));
  await db.restaurantLoginAttempt.deleteMany({ where: { keyHash: { in: keys } } });
  await db.order.deleteMany({ where: { restaurantId: { in: Object.values(ids) } } });
  await db.customer.deleteMany({ where: { id: { in: customerIds } } });
  await db.restaurant.deleteMany({ where: { id: { in: Object.values(ids) } } }); // cascades credentials and sessions
  await app.close();
  await db.$disconnect();
  await appDb.$disconnect();
});

test('provisioning stores only an Argon2id hash and refuses silent overwrite', async () => {
  const cred = await db.restaurantCredential.findUniqueOrThrow({ where: { restaurantId: ids.a! } });
  assert.match(cred.passwordHash, /^\$argon2id\$/);
  assert.ok(!cred.passwordHash.includes(PW_A));
  await assert.rejects(setRestaurantPassword({ slug: slugA, password: `Other-${randomUUID()}` }), /PAROL_MAVJUD/);
  await assert.rejects(setRestaurantPassword({ slug: slugC, password: 'short' }), /PAROL_UZUNLIGI/);
  await assert.rejects(setRestaurantPassword({ slug: 'nope-' + nonce, password: `Whatever-${randomUUID()}` }), /RESTORAN_TOPILMADI/);
  assert.equal((await db.restaurantCredential.findUniqueOrThrow({ where: { restaurantId: ids.a! } })).passwordHash, cred.passwordHash);
});

test('correct login returns a token once; only its hash is stored; no secret fields are exposed', async () => {
  const r = await login(slugA, PW_A);
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['cache-control'], 'no-store');
  const body = r.json();
  assert.equal(body.tokenType, 'Bearer');
  assert.match(body.accessToken, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(Object.keys(body.restaurant).sort(), ['id', 'isPaused', 'name', 'slug']);
  const text = r.body;
  assert.ok(!/passwordHash|argon2|passwordVersion|tokenHash/i.test(text));
  assert.ok(new Date(body.expiresAt).getTime() > Date.now());
  const s = await db.restaurantSession.findUniqueOrThrow({ where: { tokenHash: hashToken(body.accessToken) } });
  assert.equal(s.restaurantId, ids.a);
  assert.equal(await db.restaurantSession.count({ where: { tokenHash: body.accessToken } }), 0);
  const m = await me(body.accessToken);
  assert.equal(m.statusCode, 200);
  assert.equal(m.json().restaurant.id, ids.a);
  assert.ok(!/passwordHash|argon2/i.test(m.body));
});

test('wrong password, unknown slug and credential-less restaurant look identical', async () => {
  const wrong = await login(slugA, 'definitely-wrong');
  const unknown = await login('no-such-slug-' + nonce, 'definitely-wrong');
  const noCred = await login(slugC, 'definitely-wrong');
  for (const r of [wrong, unknown, noCred]) assert.equal(r.statusCode, 401);
  assert.deepEqual(wrong.json(), { error: 'INVALID_CREDENTIALS' });
  assert.deepEqual(unknown.json(), wrong.json());
  assert.deepEqual(noCred.json(), wrong.json());
});

test('inputs are validated: malformed slug, empty/oversized password, extra fields, no body', async () => {
  const url = '/api/v1/restaurant/auth/login';
  for (const payload of [{ slug: 'A B', password: 'x' }, { slug: slugA, password: '' }, { slug: slugA, password: 'x'.repeat(201) },
    { slug: slugA, password: 'x', restaurantId: ids.b }, { slug: slugA }, {}, { slug: 5, password: 'x' }]) {
    assert.equal((await post(url, payload)).statusCode, 400, JSON.stringify(payload).slice(0, 60));
  }
  assert.equal((await app.inject({ method: 'POST', url, remoteAddress: freshIp() })).statusCode, 400);
});

test('missing, malformed or unknown tokens are 401 on every protected route', async () => {
  for (const url of ['/api/v1/restaurant/auth/me', `/api/v1/restaurant/orders/${orderA}`]) {
    assert.equal((await get(url)).statusCode, 401);
    assert.equal((await get(url, 'short')).statusCode, 401);
    assert.equal((await get(url, 'C'.repeat(43))).statusCode, 401);
  }
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/restaurant/auth/me', headers: { authorization: 'Basic abc' } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/restaurant/auth/logout' })).statusCode, 401);
  // the internal API key is not a restaurant credential
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/restaurant/auth/me', headers: { 'x-internal-api-key': process.env.INTERNAL_API_KEY ?? 'x' } })).statusCode, 401);
});

test('session expiry: an expired session is rejected with 401', async () => {
  const t = await token(slugA, PW_A);
  assert.equal((await me(t)).statusCode, 200);
  await db.restaurantSession.update({ where: { tokenHash: hashToken(t) }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await me(t)).statusCode, 401);
});

test('logout invalidates the server-side session; repeat logout is 401; other sessions survive', async () => {
  const t1 = await token(slugA, PW_A);
  const t2 = await token(slugA, PW_A);
  const out = await app.inject({ method: 'POST', url: '/api/v1/restaurant/auth/logout', headers: { authorization: `Bearer ${t1}` } });
  assert.equal(out.statusCode, 204);
  assert.equal((await me(t1)).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/restaurant/auth/logout', headers: { authorization: `Bearer ${t1}` } })).statusCode, 401);
  assert.ok((await db.restaurantSession.findUniqueOrThrow({ where: { tokenHash: hashToken(t1) } })).revokedAt);
  assert.equal((await me(t2)).statusCode, 200);
});

test('inactive restaurant: login is forbidden, live sessions are denied, reactivation restores access', async () => {
  const t = await token(slugB, PW_B);
  await db.restaurant.update({ where: { id: ids.b! }, data: { isActive: false } });
  try {
    const l = await login(slugB, PW_B);
    assert.equal(l.statusCode, 403);
    assert.deepEqual(l.json(), { error: 'RESTAURANT_INACTIVE' });
    assert.equal((await login(slugB, 'wrong-password-here')).statusCode, 401); // wrong password still reveals nothing
    const m = await me(t);
    assert.equal(m.statusCode, 403);
    assert.equal((await get(`/api/v1/restaurant/orders/${orderB}`, t)).statusCode, 403);
  } finally { await db.restaurant.update({ where: { id: ids.b! }, data: { isActive: true } }); }
  assert.equal((await me(t)).statusCode, 200);
});

test('password change (--replace) revokes every session and the old password stops working', async () => {
  const t = await token(slugB, PW_B);
  const NEW = `Charlie-${randomUUID()}`;
  await assert.rejects(setRestaurantPassword({ slug: slugB, password: NEW }), /PAROL_MAVJUD/);
  assert.equal((await setRestaurantPassword({ slug: slugB, password: NEW, replace: true })).created, false);
  assert.equal((await me(t)).statusCode, 401);
  assert.equal((await login(slugB, PW_B)).statusCode, 401);
  const t2 = await token(slugB, NEW);
  assert.equal((await me(t2)).statusCode, 200);
  // a session minted under an older password version is rejected even if it was never revoked
  await db.restaurantCredential.update({ where: { restaurantId: ids.b! }, data: { passwordVersion: { increment: 1 } } });
  assert.equal((await me(t2)).statusCode, 401);
  await setRestaurantPassword({ slug: slugB, password: PW_B, replace: true }); // restore for later tests
});

test('tenant isolation: a restaurant only sees its own orders; client-supplied restaurant ids are ignored', async () => {
  const ta = await token(slugA, PW_A);
  const tb = await token(slugB, PW_B);
  const own = await get(`/api/v1/restaurant/orders/${orderA}`, ta);
  assert.equal(own.statusCode, 200);
  assert.equal(own.json().id, orderA);
  // Stage 6C extended the detail view; the original fields are still present and no internal ids leak.
  const keys = Object.keys(own.json());
  for (const k of ['createdAt', 'estimatedPrepMinutes', 'id', 'items', 'number', 'payment', 'status', 'totalSom', 'allowedActions']) assert.ok(keys.includes(k), k);
  for (const k of ['restaurantId', 'customerId', 'customerTelegramUserId', 'staffTelegramUserId']) assert.ok(!keys.includes(k), k);
  assert.equal((await get(`/api/v1/restaurant/orders/${orderB}`, ta)).statusCode, 404);
  assert.equal((await get(`/api/v1/restaurant/orders/${orderA}`, tb)).statusCode, 404);
  assert.equal((await get(`/api/v1/restaurant/orders/${orderA}?restaurantId=${ids.a}`, tb)).statusCode, 404);
  const spoof = await app.inject({ method: 'GET', url: `/api/v1/restaurant/orders/${orderA}`,
    headers: { authorization: `Bearer ${tb}`, 'x-restaurant-id': ids.a! } });
  assert.equal(spoof.statusCode, 404);
  assert.equal((await me(tb)).json().restaurant.id, ids.b);
  assert.equal((await get('/api/v1/restaurant/orders/does-not-exist', ta)).statusCode, 404);
});

test('concurrent logins respect the session cap; concurrent logouts of one token are safe', async () => {
  const results = await Promise.all(Array.from({ length: 10 }, () => login(slugA, PW_A)));
  assert.ok(results.every(r => r.statusCode === 200));
  const active = await db.restaurantSession.count({ where: { restaurantId: ids.a!, revokedAt: null, expiresAt: { gt: new Date() } } });
  assert.ok(active <= 4, `active sessions ${active}`);
  const t = await token(slugA, PW_A);
  const outs = await Promise.all(Array.from({ length: 6 }, () =>
    app.inject({ method: 'POST', url: '/api/v1/restaurant/auth/logout', headers: { authorization: `Bearer ${t}` } })));
  assert.ok(outs.every(r => r.statusCode === 204 || r.statusCode === 401));
  assert.ok(outs.some(r => r.statusCode === 204));
  assert.equal((await me(t)).statusCode, 401);
  assert.ok((await db.restaurantSession.findUniqueOrThrow({ where: { tokenHash: hashToken(t) } })).revokedAt);
});

test('rate limiting: failures are capped per slug (even in parallel), the right password is then locked out, others unaffected', async () => {
  const attempts = await Promise.all(Array.from({ length: 12 }, () => login(slugC, 'wrong-password-here')));
  const unauthorized = attempts.filter(r => r.statusCode === 401).length;
  const throttled = attempts.filter(r => r.statusCode === 429);
  assert.ok(unauthorized <= 3, `verified ${unauthorized} guesses`);
  assert.equal(unauthorized + throttled.length, 12);
  assert.ok(throttled.length >= 9);
  assert.equal(throttled[0]!.json().error, 'TOO_MANY_ATTEMPTS');
  assert.ok(Number(throttled[0]!.headers['retry-after']) > 0);
  // no password text or hash in the response
  assert.ok(!throttled[0]!.body.includes('wrong-password-here'));
  // a different restaurant from a different IP is not affected
  assert.equal((await login(slugA, PW_A)).statusCode, 200);
});

test('rate limiting: a locked slug rejects even the correct password, and success clears the failure counter', async () => {
  // slugB: two failures, then the right password succeeds and resets the counter
  assert.equal((await login(slugB, 'wrong-1-password')).statusCode, 401);
  assert.equal((await login(slugB, 'wrong-2-password')).statusCode, 401);
  assert.equal((await login(slugB, PW_B)).statusCode, 200);
  for (let i = 0; i < 3; i++) assert.equal((await login(slugB, `wrong-again-${i}-pw`)).statusCode, 401);
  assert.equal((await login(slugB, PW_B)).statusCode, 429);
  assert.equal((await login(slugB, 'x')).statusCode, 429);
});
