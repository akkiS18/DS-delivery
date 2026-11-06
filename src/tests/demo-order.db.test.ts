import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { attemptKey, setRestaurantPassword } from '../modules/restaurant-auth/service.js';
import { createDemoOrder, DEMO_AFTER_READY_MS, DEMO_MAX_AGE_MS, removeDemoOrders, sweepDemoOrders } from '../modules/restaurant-orders/demo.js';
import { db as appDb } from '../lib/db.js';

// Admin "sinov" (demo) order: shown in the restaurant app, two taps work, and nothing else is touched. Needs the isDemo migration (20261114000100_demo_orders).
process.env.RESTAURANT_LOGIN_MAX_FAILURES = '50';
process.env.RESTAURANT_LOGIN_IP_MAX_FAILURES = '1000';
const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const app = buildApp(engine);
const nonce = randomUUID().slice(0, 8);
const slugA = `demo-a-${nonce}`;
const slugB = `demo-b-${nonce}`;
const PW_A = `Alpha-${randomUUID()}`;
const PW_B = `Bravo-${randomUUID()}`;
const ids: Record<string, string> = {};
const ips: string[] = [];
let ta = '';
let tb = '';
let plainOrderId = '';

const ip = () => { const v = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`; ips.push(v); return v; };
async function loginToken(slug: string, password: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/v1/restaurant/auth/login', payload: { slug, password }, remoteAddress: ip() });
  assert.equal(r.statusCode, 200);
  return r.json().accessToken;
}
const call = (method: 'GET' | 'POST', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1/restaurant${url}`, payload: payload as object | undefined, headers: { authorization: `Bearer ${token}` } });

before(async () => {
  await db.$connect();
  ids.a = (await db.restaurant.create({ data: { slug: slugA, name: 'Demo A' } })).id;
  ids.b = (await db.restaurant.create({ data: { slug: slugB, name: 'Demo B' } })).id;
  await db.product.createMany({ data: [
    { restaurantId: ids.a, name: 'Osh', priceSom: 30_000 },
    { restaurantId: ids.a, name: 'Somsa', priceSom: 8_000 },
    { restaurantId: ids.a, name: 'Arxiv taom', priceSom: 5_000, isAvailable: false, archivedAt: new Date() },
  ] });
  await setRestaurantPassword({ slug: slugA, password: PW_A });
  await setRestaurantPassword({ slug: slugB, password: PW_B });
  ta = await loginToken(slugA, PW_A);
  tb = await loginToken(slugB, PW_B);
  // a normal (non-demo) order of restaurant B that the sweep must never touch
  const customer = await db.customer.create({ data: { displayName: `Plain ${nonce}` } });
  plainOrderId = (await db.order.create({ data: { restaurantId: ids.b, customerId: customer.id, addressText: 'x', totalSom: 1000, createdViaBot: true, status: 'PREPARING', createdAt: new Date(Date.now() - 3 * DEMO_MAX_AGE_MS) } })).id;
});
after(async () => {
  const rids = Object.values(ids);
  await db.order.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.customer.deleteMany({ where: { displayName: `Plain ${nonce}` } });
  await db.product.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.restaurantLoginAttempt.deleteMany({ where: { keyHash: { in: [slugA, slugB].map(s => attemptKey('slug', s)).concat(ips.map(i => attemptKey('ip', i))) } } });
  await db.restaurant.deleteMany({ where: { id: { in: rids } } });
  await app.close();
  await db.$disconnect();
  await appDb.$disconnect();
});

test('a demo order looks like a fresh paid order but has no payment, no taxi and no history', async () => {
  const r = await createDemoOrder(ids.a!);
  assert.equal(r.result, 'CREATED');
  if (r.result !== 'CREATED') return;
  assert.equal(r.totalSom, 2 * 30_000 + 8_000, 'two real, available dishes of the restaurant (the archived one is not used)');
  const o = await db.order.findUniqueOrThrow({ where: { id: r.orderId }, include: { items: true, payment: true } });
  assert.equal(o.isDemo, true);
  assert.equal(o.paymentIsTest, true);
  assert.equal(o.status, 'PREPARING');
  assert.equal(o.payment, null, 'no payment row: nothing for finance, the bank matcher or a refund to touch');
  assert.equal(o.taxiCompanyId, null, 'no taxi company: no dispatch can exist');
  assert.equal(o.items.length, 2);
  assert.equal(await db.orderEvent.count({ where: { orderId: o.id } }), 0, 'nothing is written to the order history');

  const list = (await call('GET', '/orders?filter=new', ta)).json();
  const view = list.orders.find((x: { id: string }) => x.id === o.id);
  assert.ok(view, 'it is in the "new" tab, so the bell rings');
  assert.equal(view.isTest, true);
  assert.deepEqual(view.allowedActions, ['SET_PREP_TIME', 'MARK_READY']);
  assert.equal(view.payment.status, 'CONFIRMED_MANUAL');
  assert.equal(view.prep.chosenMinutes, null, 'not acknowledged yet');
  assert.equal((await call('GET', `/orders/${o.id}`, tb)).statusCode, 404, 'another restaurant cannot see it');
  assert.equal((await call('POST', `/orders/${o.id}/prep-time`, tb, {})).statusCode, 404, 'nor press its buttons');
});

test('"Qabul qildim" then "Tayyor" work; nothing else does; repeated taps are harmless', async () => {
  const id = (await db.order.findFirstOrThrow({ where: { restaurantId: ids.a, isDemo: true } })).id;
  assert.equal((await call('POST', `/orders/${id}/cancel`, ta, { reason: 'OTHER' })).statusCode, 409, 'cancel is not offered');
  assert.equal((await call('POST', `/orders/${id}/verify-payment`, ta, { confirmReceived: true })).statusCode, 409);
  assert.equal((await call('POST', `/orders/${id}/prep-time`, ta, {})).statusCode, 200);
  const cooking = (await call('GET', '/orders?filter=cooking', ta)).json();
  assert.ok(cooking.orders.some((x: { id: string }) => x.id === id), 'acknowledged: it moved to "Tayyorlanmoqda"');
  const taps = await Promise.all(Array.from({ length: 5 }, () => call('POST', `/orders/${id}/ready`, ta, {})));
  assert.deepEqual(taps.map(t => t.statusCode), [200, 200, 200, 200, 200]);
  const o = await db.order.findUniqueOrThrow({ where: { id } });
  assert.equal(o.status, 'READY');
  assert.equal(o.deliveryMode, 'TAXI');
  assert.equal(await db.taxiDispatch.count({ where: { orderId: id } }), 0, 'ready never calls a taxi');
  assert.equal(await db.orderEvent.count({ where: { orderId: id } }), 0);
  assert.equal(await db.payment.count({ where: { orderId: id } }), 0);
  assert.equal(await db.commissionEntry.count({ where: { orderId: id } }), 0);
  assert.deepEqual((await call('GET', `/orders/${id}`, ta)).json().allowedActions, []);
});

test('a new demo order replaces the old one (one per restaurant)', async () => {
  assert.equal((await createDemoOrder(ids.a!)).result, 'CREATED');
  assert.equal((await createDemoOrder(ids.a!)).result, 'CREATED');
  assert.equal(await db.order.count({ where: { restaurantId: ids.a, isDemo: true } }), 1);
  assert.equal((await createDemoOrder('no-such-restaurant')).result, 'NOT_FOUND');
});

test('the sweep deletes old and finished demo orders and never a real order', async () => {
  const now = new Date();
  await db.order.updateMany({ where: { restaurantId: ids.a, isDemo: true }, data: { createdAt: new Date(now.getTime() - DEMO_MAX_AGE_MS - 60_000) } });
  assert.equal(await sweepDemoOrders(now), 1);
  assert.equal(await db.order.count({ where: { restaurantId: ids.a, isDemo: true } }), 0);

  const r = await createDemoOrder(ids.a!);
  assert.equal(r.result, 'CREATED');
  if (r.result !== 'CREATED') return;
  assert.equal(await sweepDemoOrders(now), 0, 'a fresh demo order stays');
  await db.order.update({ where: { id: r.orderId }, data: { status: 'READY', readyAt: new Date(now.getTime() - DEMO_AFTER_READY_MS - 60_000) } });
  assert.equal(await sweepDemoOrders(now), 1, 'ready for a few minutes: the demo is over');
  assert.ok(await db.order.findUnique({ where: { id: plainOrderId } }), 'an old real order is never swept');
});

test('the administrator can end a demo by hand, and only the demo', async () => {
  assert.equal((await createDemoOrder(ids.b!)).result, 'CREATED');
  assert.equal(await removeDemoOrders(ids.b!), 1);
  assert.ok(await db.order.findUnique({ where: { id: plainOrderId } }));
  assert.equal(await removeDemoOrders(ids.b!), 0);
});
