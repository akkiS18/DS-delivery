import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { attemptKey, hashToken, setRestaurantPassword } from '../modules/restaurant-auth/service.js';
import { db as appDb } from '../lib/db.js';

process.env.RESTAURANT_LOGIN_MAX_FAILURES = '50';
process.env.RESTAURANT_LOGIN_IP_MAX_FAILURES = '1000';

const db = new PrismaClient();
const app = buildApp(new PaymentEngineV3(db, defaultOptions, () => {}));
const nonce = randomUUID().slice(0, 8);
const slugA = `cat-a-${nonce}`;
const slugB = `cat-b-${nonce}`;
const PW_A = `Alpha-${randomUUID()}`;
const PW_B = `Bravo-${randomUUID()}`;
const ids: Record<string, string> = {};
const ips: string[] = [];
const customerIds: string[] = [];
let ta = '';
let tb = '';

const ip = () => { const v = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`; ips.push(v); return v; };
async function loginToken(slug: string, password: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/v1/restaurant/auth/login', payload: { slug, password }, remoteAddress: ip() });
  assert.equal(r.statusCode, 200);
  return r.json().accessToken;
}
const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, token: string | undefined, payload?: unknown) =>
  app.inject({ method, url: `/api/v1/restaurant${url}`, payload: payload as object | undefined, headers: token ? { authorization: `Bearer ${token}` } : {} });
const mkProduct = async (token: string, over: Record<string, unknown> = {}) => {
  const r = await call('POST', '/products', token, { name: `Item ${randomUUID().slice(0, 8)}`, priceSom: 10_000, ...over });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const mkCategory = async (token: string, over: Record<string, unknown> = {}) => {
  const r = await call('POST', '/categories', token, { name: `Cat ${randomUUID().slice(0, 8)}`, ...over });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};

before(async () => {
  await db.$connect();
  // Restaurant A starts paused: since Stage 6F a price may only be edited while paused (the dedicated test below covers the open case).
  for (const [k, slug] of [['a', slugA], ['b', slugB]] as const) ids[k] = (await db.restaurant.create({ data: { slug, name: `Cat ${k}`, isPaused: k === 'a' } })).id;
  await setRestaurantPassword({ slug: slugA, password: PW_A });
  await setRestaurantPassword({ slug: slugB, password: PW_B });
  ta = await loginToken(slugA, PW_A);
  tb = await loginToken(slugB, PW_B);
});
after(async () => {
  await db.restaurantLoginAttempt.deleteMany({ where: { keyHash: { in: [slugA, slugB].map(s => attemptKey('slug', s)).concat(ips.map(i => attemptKey('ip', i))) } } });
  await db.order.deleteMany({ where: { restaurantId: { in: Object.values(ids) } } });
  await db.customer.deleteMany({ where: { id: { in: customerIds } } });
  await db.product.deleteMany({ where: { restaurantId: { in: Object.values(ids) } } });
  await db.category.deleteMany({ where: { restaurantId: { in: Object.values(ids) } } });
  await db.restaurant.deleteMany({ where: { id: { in: Object.values(ids) } } }); // cascades sessions, credentials, catalog events
  await app.close();
  await db.$disconnect();
  await appDb.$disconnect();
});

const ROUTES: Array<['GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', string, unknown?]> = [
  ['GET', '/products'], ['POST', '/products', { name: 'Nope', priceSom: 1000 }], ['PUT', '/products/x1', {}],
  ['PATCH', '/products/x1/availability', { isAvailable: true }], ['DELETE', '/products/x1'],
  ['GET', '/categories'], ['POST', '/categories', { name: 'Nope' }], ['PUT', '/categories/x1', {}], ['DELETE', '/categories/x1'],
];

test('every catalog route rejects missing, malformed, expired and revoked sessions with 401', async () => {
  for (const [m, u, p] of ROUTES) {
    assert.equal((await call(m, u, undefined, p)).statusCode, 401, `${m} ${u} no token`);
    assert.equal((await call(m, u, 'bad-token', p)).statusCode, 401, `${m} ${u} bad token`);
  }
  const expired = await loginToken(slugA, PW_A);
  await db.restaurantSession.update({ where: { tokenHash: hashToken(expired) }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const revoked = await loginToken(slugA, PW_A);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/restaurant/auth/logout', headers: { authorization: `Bearer ${revoked}` } })).statusCode, 204);
  for (const t of [expired, revoked]) for (const [m, u, p] of ROUTES) assert.equal((await call(m, u, t, p)).statusCode, 401, `${m} ${u}`);
  assert.equal((await db.product.count({ where: { restaurantId: ids.a!, name: 'Nope' } })), 0);
});

test('inactive restaurant gets 403 on catalog routes and nothing is changed', async () => {
  await db.restaurant.update({ where: { id: ids.b! }, data: { isActive: false } });
  try {
    assert.equal((await call('GET', '/products', tb)).statusCode, 403);
    assert.equal((await call('POST', '/products', tb, { name: 'Ghost item', priceSom: 1000 })).statusCode, 403);
  } finally { await db.restaurant.update({ where: { id: ids.b! }, data: { isActive: true } }); }
  assert.equal(await db.product.count({ where: { restaurantId: ids.b!, name: 'Ghost item' } }), 0);
});

test('create/list: unavailable products are listed; the restaurant is taken from the session, never from the body', async () => {
  const spoof = await call('POST', '/products', ta, { name: 'Spoofed', priceSom: 1000, restaurantId: ids.b });
  assert.equal(spoof.statusCode, 400);
  const p = await mkProduct(ta, { isAvailable: false, description: 'Sovuq' });
  assert.equal(p.isAvailable, false);
  assert.equal(p.version, 0);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: p.id } })).restaurantId, ids.a);
  const list = (await call('GET', '/products', ta)).json().products as Array<{ id: string; isAvailable: boolean }>;
  assert.ok(list.some(x => x.id === p.id && x.isAvailable === false));
  const other = (await call('GET', '/products', tb)).json().products as Array<{ id: string }>;
  assert.ok(!other.some(x => x.id === p.id));
});

test('invalid prices, names and body shapes are 400 and create nothing', async () => {
  const before = await db.product.count({ where: { restaurantId: ids.a! } });
  for (const body of [{ name: 'Bad price', priceSom: 0 }, { name: 'Bad price', priceSom: 50 }, { name: 'Bad price', priceSom: -1000 },
    { name: 'Bad price', priceSom: 10.5 }, { name: 'Bad price', priceSom: '10000' }, { name: 'Bad price', priceSom: 100_000_001 },
    { name: 'x', priceSom: 1000 }, { priceSom: 1000 }, { name: 'Bad price', priceSom: 1000, imageUrl: 'http://169.254.169.254/' }]) {
    assert.equal((await call('POST', '/products', ta, body)).statusCode, 400, JSON.stringify(body));
  }
  assert.equal(await db.product.count({ where: { restaurantId: ids.a! } }), before);
});

test('cross-restaurant isolation: another restaurant\'s products and categories are plain 404, nothing changes', async () => {
  const p = await mkProduct(ta, { priceSom: 12_345 });
  const c = await mkCategory(ta);
  for (const [m, u, body] of [
    ['PUT', `/products/${p.id}`, { name: 'Hijack', description: null, priceSom: 100, categoryId: null, version: 0 }],
    ['PATCH', `/products/${p.id}/availability`, { isAvailable: false }],
    ['DELETE', `/products/${p.id}`],
    ['PUT', `/categories/${c.id}`, { name: 'Hijack', position: 1, version: 0 }],
    ['DELETE', `/categories/${c.id}`],
  ] as const) assert.equal((await call(m, u, tb, body)).statusCode, 404, `${m} ${u}`);
  const row = await db.product.findUniqueOrThrow({ where: { id: p.id } });
  assert.deepEqual([row.name, row.priceSom, row.isAvailable, row.archivedAt, row.version], [p.name, 12_345, true, null, 0]);
  assert.equal(await db.category.count({ where: { id: c.id } }), 1);
  const cats = (await call('GET', '/categories', tb)).json().categories as Array<{ id: string }>;
  assert.ok(!cats.some(x => x.id === c.id));
});

test('invalid category ownership is rejected on create and update (foreign or unknown category)', async () => {
  const foreign = await mkCategory(tb);
  const p = await mkProduct(ta);
  assert.equal((await call('POST', '/products', ta, { name: 'Wrong cat', priceSom: 1000, categoryId: foreign.id })).statusCode, 422);
  assert.equal((await call('POST', '/products', ta, { name: 'Wrong cat', priceSom: 1000, categoryId: 'nonexistent' })).statusCode, 422);
  const r = await call('PUT', `/products/${p.id}`, ta, { name: p.name, description: null, priceSom: 1000, categoryId: foreign.id, version: 0 });
  assert.equal(r.statusCode, 422);
  assert.equal(r.json().error, 'INVALID_CATEGORY');
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: p.id } })).categoryId, null);
  const own = await mkCategory(ta);
  const ok = await call('PUT', `/products/${p.id}`, ta, { name: p.name, description: 'x', priceSom: 1000, categoryId: own.id, version: 0 });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().categoryId, own.id);
});

test('duplicate requests: parallel identical creates give one product; names are unique per restaurant ignoring case', async () => {
  const name = `Lavash ${randomUUID().slice(0, 6)}`;
  const rs = await Promise.all(Array.from({ length: 6 }, () => call('POST', '/products', ta, { name, priceSom: 20_000 })));
  assert.equal(rs.filter(r => r.statusCode === 201).length, 1);
  assert.equal(rs.filter(r => r.statusCode === 409).length, 5);
  assert.equal((await call('POST', '/products', ta, { name: name.toUpperCase(), priceSom: 20_000 })).statusCode, 409);
  assert.equal((await call('POST', '/products', tb, { name, priceSom: 20_000 })).statusCode, 201); // other restaurant: fine
  assert.equal(await db.product.count({ where: { restaurantId: ids.a!, name } }), 1);
  // archiving frees the name
  const created = rs.find(r => r.statusCode === 201)!.json();
  assert.equal((await call('DELETE', `/products/${created.id}`, ta)).statusCode, 204);
  assert.equal((await call('POST', '/products', ta, { name, priceSom: 20_000 })).statusCode, 201);
});

test('concurrent updates: optimistic version lets exactly one writer win; the loser gets 409 and no lost update', async () => {
  const p = await mkProduct(ta, { priceSom: 10_000 });
  const put = (price: number, v: number) => call('PUT', `/products/${p.id}`, ta,
    { name: p.name, description: null, priceSom: price, categoryId: null, version: v });
  const rs = await Promise.all([put(11_000, 0), put(12_000, 0), put(13_000, 0), put(14_000, 0)]);
  assert.equal(rs.filter(r => r.statusCode === 200).length, 1);
  assert.equal(rs.filter(r => r.statusCode === 409).length, 3);
  assert.ok(rs.filter(r => r.statusCode === 409).every(r => r.json().error === 'VERSION_CONFLICT'));
  const winner = rs.find(r => r.statusCode === 200)!.json();
  const row = await db.product.findUniqueOrThrow({ where: { id: p.id } });
  assert.equal(row.priceSom, winner.priceSom);
  assert.equal(row.version, 1);
  assert.equal((await put(15_000, 0)).statusCode, 409); // stale editor
  assert.equal((await put(15_000, 1)).statusCode, 200);
  assert.equal(await db.catalogEvent.count({ where: { entityId: p.id, action: 'PRODUCT_UPDATED' } }), 2);
});

test('a "was X" earlier price survives an edit that keeps the price, and is cleared when the restaurant changes the price', async () => {
  const p = await mkProduct(ta, { priceSom: 49_000 });
  await db.product.update({ where: { id: p.id }, data: { oldPriceSom: 60_000 } });
  const put = (price: number, name: string, v: number) => call('PUT', `/products/${p.id}`, ta, { name, description: null, priceSom: price, categoryId: null, version: v });
  assert.equal((await put(49_000, `${p.name} yangi`, 0)).statusCode, 200);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: p.id } })).oldPriceSom, 60_000, 'same price: the offer stays');
  assert.equal((await put(52_000, `${p.name} yangi`, 1)).statusCode, 200);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: p.id } })).oldPriceSom, null, 'new price: the crossed-out price is gone');
});

test('availability is an idempotent set: repeats change nothing and write no audit row; stale version is 409', async () => {
  const p = await mkProduct(ta);
  const set = (isAvailable: boolean, version?: number) => call('PATCH', `/products/${p.id}/availability`, ta, { isAvailable, ...(version !== undefined ? { version } : {}) });
  const rs = await Promise.all(Array.from({ length: 5 }, () => set(false)));
  assert.ok(rs.every(r => r.statusCode === 200 && r.json().isAvailable === false));
  assert.equal(await db.catalogEvent.count({ where: { entityId: p.id, action: 'PRODUCT_AVAILABILITY' } }), 1);
  const row = await db.product.findUniqueOrThrow({ where: { id: p.id } });
  assert.equal(row.isAvailable, false);
  assert.equal(row.version, 1);
  assert.equal((await set(true, 0)).statusCode, 409);
  assert.equal((await set(true, 1)).json().isAvailable, true);
  assert.equal((await call('PATCH', `/products/${p.id}/availability`, ta, { isAvailable: 'yes' })).statusCode, 400);
});

test('archiving preserves historical orders; archived products are unavailable, hidden by default and cannot be edited', async () => {
  const p = await mkProduct(ta, { priceSom: 21_000 });
  const customer = await db.customer.create({ data: { telegramUserId: String(randomInt(100000000000, 900000000000)) } });
  customerIds.push(customer.id);
  const order = await db.order.create({ data: { restaurantId: ids.a!, customerId: customer.id, addressText: 'x', totalSom: 21_000,
    items: { create: [{ productId: p.id, name: p.name, unitSom: 21_000, quantity: 1, subtotalSom: 21_000 }] } } });
  await call('PUT', `/products/${p.id}`, ta, { name: `${p.name} v2`, description: null, priceSom: 99_000, categoryId: null, version: 0 });
  assert.equal((await call('DELETE', `/products/${p.id}`, ta)).statusCode, 204);
  assert.equal((await call('DELETE', `/products/${p.id}`, ta)).statusCode, 204); // idempotent
  const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
  assert.deepEqual([item.name, item.unitSom, item.quantity, item.subtotalSom, item.productId], [p.name, 21_000, 1, 21_000, p.id]);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).totalSom, 21_000);
  const row = await db.product.findUniqueOrThrow({ where: { id: p.id } }); // row still exists
  assert.ok(row.archivedAt);
  assert.equal(row.isAvailable, false); // Stage 4B acceptance / customer menu treat it as unavailable
  assert.ok(!((await call('GET', '/products', ta)).json().products as Array<{ id: string }>).some(x => x.id === p.id));
  const withArchived = (await call('GET', '/products?includeArchived=true', ta)).json().products as Array<{ id: string; archivedAt: string | null }>;
  assert.ok(withArchived.find(x => x.id === p.id)?.archivedAt);
  assert.equal((await call('PUT', `/products/${p.id}`, ta, { name: 'x2', description: null, priceSom: 1000, categoryId: null, version: 2 })).statusCode, 409);
  assert.equal((await call('PATCH', `/products/${p.id}/availability`, ta, { isAvailable: true })).statusCode, 409);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: p.id } })).isAvailable, false);
  await assert.rejects(db.$executeRaw`UPDATE "Product" SET "isAvailable" = true WHERE "id" = ${p.id}`); // DB CHECK
  assert.equal(await db.catalogEvent.count({ where: { entityId: p.id, action: 'PRODUCT_ARCHIVED' } }), 1);
});

test('audit trail: actor session, before/after and restaurant scope are recorded', async () => {
  const p = await mkProduct(ta, { priceSom: 5_000 });
  await call('PUT', `/products/${p.id}`, ta, { name: p.name, description: null, priceSom: 6_000, categoryId: null, version: 0 });
  const events = await db.catalogEvent.findMany({ where: { entityId: p.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  assert.deepEqual(events.map(e => e.action), ['PRODUCT_CREATED', 'PRODUCT_UPDATED']);
  const session = await db.restaurantSession.findUniqueOrThrow({ where: { tokenHash: hashToken(ta) } });
  assert.ok(events.every(e => e.restaurantId === ids.a && e.actorSessionId === session.id));
  assert.equal((events[1]!.before as { priceSom: number }).priceSom, 5_000);
  assert.equal((events[1]!.after as { priceSom: number }).priceSom, 6_000);
});

test('categories: scoped CRUD, default positions, unique names, version conflicts', async () => {
  const c1 = await mkCategory(ta);
  const c2 = await mkCategory(ta);
  assert.ok(c2.position > c1.position);
  assert.equal((await call('POST', '/categories', ta, { name: c1.name.toLowerCase() })).statusCode, 409);
  assert.equal((await call('POST', '/categories', ta, { name: 'Bad', position: -1 })).statusCode, 400);
  assert.equal((await call('POST', '/categories', ta, { name: ' ' })).statusCode, 400);
  const rs = await Promise.all([0, 1, 2].map(i => call('PUT', `/categories/${c1.id}`, ta, { name: `${c1.name} ${i}`, position: 5 + i, version: 0 })));
  assert.equal(rs.filter(r => r.statusCode === 200).length, 1);
  assert.equal(rs.filter(r => r.statusCode === 409).length, 2);
  const listed = (await call('GET', '/categories', ta)).json().categories as Array<{ id: string; productCount: number }>;
  assert.ok(listed.some(c => c.id === c1.id && c.productCount === 0));
});

test('deleting a category with products: refused, or products are explicitly reassigned; history untouched', async () => {
  const cat = await mkCategory(ta);
  const dest = await mkCategory(ta);
  const foreign = await mkCategory(tb);
  const live = await mkProduct(ta, { categoryId: cat.id });
  const old = await mkProduct(ta, { categoryId: cat.id });
  await call('DELETE', `/products/${old.id}`, ta); // archived leftovers do not block deletion
  assert.equal((await call('DELETE', `/categories/${cat.id}`, ta)).json().error, 'CATEGORY_NOT_EMPTY');
  assert.equal((await call('DELETE', `/categories/${cat.id}?reassignTo=${foreign.id}`, ta)).statusCode, 422);
  assert.equal((await call('DELETE', `/categories/${cat.id}?reassignTo=${cat.id}`, ta)).statusCode, 422);
  assert.equal(await db.category.count({ where: { id: cat.id } }), 1);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: live.id } })).categoryId, cat.id);
  assert.equal((await call('DELETE', `/categories/${cat.id}?reassignTo=${dest.id}`, ta)).statusCode, 204);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: live.id } })).categoryId, dest.id);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: old.id } })).categoryId, null);
  assert.equal(await db.category.count({ where: { id: cat.id } }), 0);
  assert.equal((await call('DELETE', `/categories/${cat.id}`, ta)).statusCode, 404);
  const ev = await db.catalogEvent.findFirstOrThrow({ where: { entityId: cat.id, action: 'CATEGORY_DELETED' } });
  assert.deepEqual(ev.after, { movedProducts: 1, reassignTo: dest.id });
  // "none" uncategorises; an empty category deletes directly
  assert.equal((await call('DELETE', `/categories/${dest.id}?reassignTo=none`, ta)).statusCode, 204);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: live.id } })).categoryId, null);
  assert.equal((await call('DELETE', `/categories/${(await mkCategory(ta)).id}`, ta)).statusCode, 204);
  assert.equal((await call('DELETE', `/categories/${dest.id}?bogus=1`, ta)).statusCode, 400);
});

test('PUT with explicit nulls (Android edit of a product without description/category) updates the same row, no duplicate', async () => {
  const p = await mkProduct(ta, { name: `Edit me ${randomUUID().slice(0, 8)}`, priceSom: 12_000 });
  const count = () => db.product.count({ where: { restaurantId: ids.a! } });
  const before = await count();
  const body = { name: `Edited ${randomUUID().slice(0, 8)}`, priceSom: 15_000, description: null, categoryId: null, version: p.version };
  const r = await call('PUT', `/products/${p.id}`, ta, body);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().id, p.id);
  assert.equal(r.json().version, p.version + 1);
  assert.equal(await count(), before);
  const row = await db.product.findUniqueOrThrow({ where: { id: p.id } });
  assert.equal(row.name, body.name);
  assert.equal(row.priceSom, 15_000);
  // keys omitted entirely are still a 400 (backend validation unchanged), and a stale version is still a 409
  assert.equal((await call('PUT', `/products/${p.id}`, ta, { name: 'Edited again', priceSom: 16_000, version: row.version })).statusCode, 400);
  assert.equal((await call('PUT', `/products/${p.id}`, ta, { ...body, version: p.version })).statusCode, 409);
});

test('Stage 6F: a live price can only be edited while the restaurant is paused; other edits and new products are unaffected; orders keep their snapshot', async () => {
  const p = await mkProduct(ta, { priceSom: 10_000 });
  const put = (over: Record<string, unknown>, v: number) => call('PUT', `/products/${p.id}`, ta,
    { name: p.name, description: null, priceSom: 10_000, categoryId: null, version: v, ...over });
  const customer = await db.customer.create({ data: { telegramUserId: String(randomInt(800000000001, 899999999999)) } });
  customerIds.push(customer.id);
  const order = await db.order.create({ data: { restaurantId: ids.a!, customerId: customer.id, addressText: 'x', totalSom: 10_000, status: 'PAYMENT_PENDING',
    items: { create: [{ productId: p.id, name: p.name, unitSom: 10_000, quantity: 1, subtotalSom: 10_000 }] } } });
  await db.restaurant.update({ where: { id: ids.a! }, data: { isPaused: false } });
  try {
    const blocked = await put({ priceSom: 11_000 }, 0);
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.json().error, 'PRICE_EDIT_REQUIRES_PAUSE');
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: p.id } })).priceSom, 10_000);
    assert.equal((await put({ description: 'new text' }, 0)).statusCode, 200, 'non-price edits stay possible while open');
    assert.equal((await call('POST', '/products', ta, { name: `New ${randomUUID().slice(0, 6)}`, priceSom: 5_000 })).statusCode, 201, 'creating a product is not a price edit');
    await db.restaurant.update({ where: { id: ids.a! }, data: { isPaused: true } });
    assert.equal((await put({ priceSom: 11_000, description: 'new text' }, 1)).statusCode, 200);
  } finally { await db.restaurant.update({ where: { id: ids.a! }, data: { isPaused: true } }); }
  const line = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
  assert.equal(line.unitSom, 10_000, 'the order line is an immutable snapshot');
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).totalSom, 10_000);
});
