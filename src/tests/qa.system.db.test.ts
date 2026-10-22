import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { signInitData } from '../modules/miniapp/auth.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { completeDelivery, respondToTaxi } from '../modules/taxi/service.js';
import { db as appDb } from '../lib/db.js';

// Stage 7C-QA: system-level regression tests against ds_delivery_test (the before() hook refuses any other database).
// Synthetic fixtures only: fake Telegram identities, a fixture bot token used for signing initData, MOCK payments, no Telegram traffic.
// Everything this file creates is deleted by id in after(); nothing else is touched.
const BOT_TOKEN = '123456789:AAFakeQaSystemTokenLocalOnly_0123456789';
process.env.BOT_TOKEN = BOT_TOKEN;
process.env.MINIAPP_ENABLED = 'true';
process.env.MINIAPP_ORDER_RATE_PER_MINUTE = '5000'; // production default (10/min) is covered by miniapp.db.test.ts
delete process.env.BOT_PAYMENT_MODE;
delete process.env.RESTAURANT_MANUAL_ACCEPTANCE;
delete process.env.TRUST_PROXY; // the "untrusted proxy" tests need the default (off)

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const app = buildApp(engine);
const nonce = randomUUID().slice(0, 8);
const operatorTg = String(randomInt(900000000001, 990000000000));
const strangerTg = String(randomInt(990000000001, 999999999999));
process.env.TAXI_OPERATOR_ALLOWLIST = operatorTg;
const users = new Set<string>();
let restaurantId = '';
let pausedRestaurantId = '';
let taxiId = '';
const cardLast4: string[] = [];
const freshUser = () => { const u = String(randomInt(600000000001, 699999999999)); users.add(u); return u; };

const initFor = (userId: string, token = BOT_TOKEN) => signInitData({
  auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
  user: JSON.stringify({ id: Number(userId), first_name: 'QA', username: 'qa' }),
}, token);
const call = (method: 'GET' | 'POST', url: string, userId: string | null, payload?: unknown, target = app) =>
  target.inject({ method, url: `/api/v1/miniapp${url}`, payload: payload as object | undefined, remoteAddress: nextIp(), // distinct peers: the per-IP budget is not what these tests measure
    headers: userId ? { authorization: `tma ${initFor(userId)}` } : {} });
const product = (priceSom: number, available = true, rid = restaurantId) =>
  db.product.create({ data: { restaurantId: rid, name: `QA${randomUUID().slice(0, 6)}`, priceSom, isAvailable: available } });
const orderBody = (p: { id: string; priceSom: number }, quantity = 2, over: Record<string, unknown> = {}) => ({
  checkoutKey: randomUUID(), restaurantId, items: [{ productId: p.id, quantity }], expectedTotalSom: p.priceSom * quantity,
  address: { addressText: 'QA street 1' }, phone: '+998901234567', ...over });
let ipSeq = 0;
const nextIp = () => `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`;
const ms = (t: number) => Math.round(performance.now() - t);

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.equal(name, 'ds_delivery_test', `refusing to run against database "${name}"`);
  restaurantId = (await db.restaurant.create({ data: { slug: `qa-a-${nonce}`, name: `QA Resto ${nonce}`, pickupAddress: 'Pickup 1', pickupPhone: '+998900000001' } })).id;
  pausedRestaurantId = (await db.restaurant.create({ data: { slug: `qa-p-${nonce}`, name: `QA Paused ${nonce}`, isPaused: true } })).id;
  taxiId = (await db.taxiCompany.create({ data: { name: `QA Taxi ${randomUUID()}`, isActive: true, operatorTelegramUserId: operatorTg } })).id;
  for (;;) { // one MOCK (test) card for the restaurant
    const c = String(randomInt(1000, 9999));
    if (await db.card.findUnique({ where: { last4: c } })) continue;
    cardLast4.push(c); await engine.addCard(c, true, restaurantId); break;
  }
});
after(async () => {
  const rids = [restaurantId, pausedRestaurantId];
  const customers = await db.customer.findMany({ where: { telegramUserId: { in: [...users] } }, select: { id: true } });
  const orders = (await db.order.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(o => o.id);
  await db.notificationLog.deleteMany({ where: { orderId: { in: orders } } });
  await db.refundRequest.deleteMany({ where: { orderId: { in: orders } } });
  const pays = (await db.payment.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(p => p.id);
  await db.incomingTransaction.deleteMany({ where: { OR: [{ matchedPaymentId: { in: pays } }, { cardLast4: { in: cardLast4 } }] } });
  await db.taxiDispatch.deleteMany({ where: { orderId: { in: orders } } });
  await db.payment.deleteMany({ where: { id: { in: pays } } });
  const cards = (await db.card.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(c => c.id);
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards } } });
  await db.card.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.order.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.customer.deleteMany({ where: { id: { in: customers.map(c => c.id) } } });
  await db.product.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.restaurant.deleteMany({ where: { id: { in: rids } } });
  await db.taxiCompany.deleteMany({ where: { id: taxiId } });
  await app.close();
  await db.$disconnect();
  await appDb.$disconnect();
});

/** Invariants that must hold after any burst of checkouts: no 5xx, every created order has the frozen correct total, and the database never holds
 *  two live payment attempts for one (card, amount). Returns the created order ids. */
async function assertBurst(results: { statusCode: number; body: string; json: () => any }[], expected: Map<string, number>) {
  const bad = results.filter(r => ![200, 201, 409, 429].includes(r.statusCode));
  assert.deepEqual(bad.map(r => `${r.statusCode} ${r.body.slice(0, 160)}`), [], 'no 5xx / unexpected status');
  const created = results.filter(r => r.statusCode === 201).map(r => r.json().order as { id: string; foodTotalSom: number });
  assert.equal(new Set(created.map(o => o.id)).size, created.length, 'no order returned twice');
  for (const o of created) assert.equal(o.foodTotalSom, expected.get(o.id) ?? o.foodTotalSom);
  const live = await db.payment.groupBy({ by: ['cardId', 'amountTiyin'], where: { restaurantId, status: 'AWAITING' }, _count: true });
  assert.ok(live.every(g => g._count === 1), 'one AWAITING attempt per (card, amount)');
  return created;
}

// ------------------------------------------------------------------------------------------------ Phase 2: order stress
for (const n of [20, 50]) {
  test(`stress: ${n} customers check out at the same moment with distinct totals - one logical order each, correct totals`, async () => {
    const batch = Array.from({ length: n }, () => ({ user: freshUser() }));
    const prods = await Promise.all(batch.map((_, i) => product(10_000 + i * 1_000 + randomInt(0, 99) * 100_000)));
    const bodies = prods.map(p => orderBody(p, 2));
    const t0 = performance.now();
    const res = await Promise.all(batch.map((b, i) => call('POST', '/orders', b.user, bodies[i])));
    const took = ms(t0);
    const created = await assertBurst(res, new Map());
    console.log(`[perf] ${n} concurrent checkouts: ${took} ms total, ${res.map(r => r.statusCode).sort().join(',').replace(/(\d+)(,\1)+/g, m => `${m.split(',')[0]}x${m.split(',').length}`)}`);
    // All distinct totals + one card: every request must have produced an order (none may be silently dropped).
    assert.equal(created.length, n, `statuses: ${res.map(r => r.statusCode).join(',')}`);
    const rows = await db.order.findMany({ where: { id: { in: created.map(o => o.id) } }, include: { payment: true, items: true } });
    assert.equal(rows.length, n);
    rows.forEach(r => {
      const idx = bodies.findIndex(b => b.checkoutKey === r.checkoutKey);
      assert.ok(idx >= 0);
      assert.equal(r.status, 'PAYMENT_PENDING');
      assert.equal(r.items.reduce((s, i) => s + i.unitSom * i.quantity, 0), prods[idx]!.priceSom * 2, 'frozen line total');
      assert.equal(r.payment?.amountTiyin, BigInt(prods[idx]!.priceSom * 2) * 100n, 'payment amount equals order total');
      assert.equal(r.paymentIsTest, true);
    });
  });
}

test('stress: 30 customers order the SAME price at once - amount collisions never double-allocate and never 5xx', async () => {
  const p = await product(33_300);
  const batch = Array.from({ length: 30 }, () => freshUser());
  const res = await Promise.all(batch.map(u => call('POST', '/orders', u, orderBody(p, 1))));
  const created = await assertBurst(res, new Map());
  console.log(`[perf] 30 same-amount checkouts: created ${created.length}, statuses ${[...new Set(res.map(r => r.statusCode))].join('/')}`);
  assert.ok(created.length >= 1);
  const orders = await db.order.count({ where: { restaurantId, items: { some: { productId: p.id } } } });
  assert.equal(orders, created.length, 'no order exists that the customer was not told about');
});

test('regression: a brand-new customer first 12 simultaneous taps with one checkoutKey create one customer and one order, all answered 200/201', async () => {
  // Root cause of the defect this guards: ensureCustomer() used Prisma upsert, which is not atomic, so simultaneous first requests of a NEW Telegram
  // user hit the unique telegramUserId and the losers were answered 409 "Record already exists" although the order was created.
  // (Idempotency is per checkoutKey; a new key is a new order by design.)
  const u = freshUser();
  const p = await product(41_000);
  const same = orderBody(p, 1);
  const res = await Promise.all(Array.from({ length: 12 }, () => call('POST', '/orders', u, same)));
  assert.ok(res.every(r => [200, 201].includes(r.statusCode)), res.map(r => `${r.statusCode}:${r.body.slice(0, 90)}`).join(' | '));
  assert.equal(new Set(res.map(r => r.json().order.id)).size, 1, 'same key from 12 taps = exactly one order');
  assert.equal(await db.order.count({ where: { checkoutKey: same.checkoutKey } }), 1);
  assert.equal(await db.customer.count({ where: { telegramUserId: u } }), 1);
});

test('regression: ensureCustomer is race-safe - 15 parallel first calls for one new Telegram user return the same row', async () => {
  const { ensureCustomer } = await import('../modules/miniapp/profile.js');
  const u = freshUser();
  const rows = await Promise.all(Array.from({ length: 15 }, () => ensureCustomer(u, 'Race')));
  assert.equal(new Set(rows.map(r => r.id)).size, 1);
  assert.equal(await db.customer.count({ where: { telegramUserId: u } }), 1);
});

test('restart during checkout: a fresh server instance replays the same key to the same order and creates nothing', async () => {
  const u = freshUser();
  const p = await product(52_000);
  const body = orderBody(p, 1);
  const first = await call('POST', '/orders', u, body);
  assert.equal(first.statusCode, 201, first.body);
  const restarted = buildApp(new PaymentEngineV3(new PrismaClient(), defaultOptions, () => {})); // new process-equivalent: no in-memory state
  try {
    const replay = await call('POST', '/orders', u, body, restarted);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().order.id, first.json().order.id);
    assert.equal(replay.json().replayed, true);
    assert.equal(await db.order.count({ where: { checkoutKey: body.checkoutKey } }), 1);
  } finally { await restarted.close(); }
});

test('a product turning unavailable mid-burst: every order created holds an available-at-the-time product, none after the flip, no 5xx', async () => {
  const p = await product(61_000);
  const users10 = Array.from({ length: 10 }, () => freshUser());
  const burst = users10.map(u => call('POST', '/orders', u, orderBody(p, 1)));
  const flip = db.product.update({ where: { id: p.id }, data: { isAvailable: false } });
  const res = await Promise.all([...burst, flip]).then(all => all.slice(0, 10) as Awaited<(typeof burst)[number]>[]);
  await assertBurst(res, new Map());
  assert.ok(res.filter(r => r.statusCode === 409).every(r => r.json().error === 'MAHSULOT_MAVJUD_EMAS'));
  const after = await call('POST', '/orders', freshUser(), orderBody(p, 1));
  assert.equal(after.statusCode, 409);
  assert.equal(after.json().error, 'MAHSULOT_MAVJUD_EMAS');
});

test('price changing mid-burst: no order is ever created at a total the customer did not see', async () => {
  const p = await product(70_000);
  const res = await Promise.all([
    ...Array.from({ length: 10 }, () => call('POST', '/orders', freshUser(), orderBody(p, 1))),
    db.product.update({ where: { id: p.id }, data: { priceSom: 80_000 } }),
  ]).then(all => all.slice(0, 10) as Awaited<ReturnType<typeof call>>[]);
  await assertBurst(res, new Map());
  for (const r of res.filter(x => x.statusCode === 201)) assert.equal(r.json().order.foodTotalSom, 70_000, 'created at the price the customer confirmed');
  for (const r of res.filter(x => x.statusCode === 409)) assert.equal(r.json().error, 'NARX_OZGARGAN');
  const stale = await call('POST', '/orders', freshUser(), orderBody({ id: p.id, priceSom: 70_000 }, 1));
  assert.equal(stale.json().error, 'NARX_OZGARGAN');
});

test('restaurant pausing mid-burst: refused cleanly afterwards, and orders already created are untouched', async () => {
  const p = await product(15_500);
  const res = await Promise.all([
    ...Array.from({ length: 10 }, () => call('POST', '/orders', freshUser(), orderBody(p, 1))),
    db.restaurant.update({ where: { id: restaurantId }, data: { isPaused: true } }),
  ]).then(all => all.slice(0, 10) as Awaited<ReturnType<typeof call>>[]);
  try {
    const created = await assertBurst(res, new Map());
    assert.ok(res.filter(r => r.statusCode === 409).every(r => r.json().error === 'RESTORAN_BUYURTMA_QABUL_QILMAYDI'));
    assert.equal((await call('POST', '/orders', freshUser(), orderBody(p, 1))).json().error, 'RESTORAN_BUYURTMA_QABUL_QILMAYDI');
    for (const o of created) assert.equal((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status, 'PAYMENT_PENDING');
  } finally { await db.restaurant.update({ where: { id: restaurantId }, data: { isPaused: false } }); }
});

test('two devices of one customer read the same order state concurrently and agree', async () => {
  const u = freshUser();
  const p = await product(18_000);
  const id = (await call('POST', '/orders', u, orderBody(p, 1))).json().order.id as string;
  const reads = await Promise.all(Array.from({ length: 8 }, () => call('GET', `/orders/${id}`, u)));
  const strip = (r: { json: () => any }) => { const o = r.json().order; delete o.serverNow; if (o.prep) delete o.prep.remainingSeconds; return JSON.stringify(o); };
  assert.ok(reads.every(r => r.statusCode === 200));
  assert.equal(new Set(reads.map(strip)).size, 1);
  // concurrent pay (device 1) and cancel (device 2): exactly one wins, never a cancelled order that is also cooking
  const [pay, cancel] = await Promise.all([call('POST', `/orders/${id}/mock-payment`, u), call('POST', `/orders/${id}/cancel`, u, {})]);
  const final = await db.order.findUniqueOrThrow({ where: { id }, include: { payment: true } });
  console.log(`[info] pay/cancel race: pay ${pay.statusCode}, cancel ${cancel.statusCode}, final ${final.status}/${final.payment?.status}`);
  assert.ok(['PREPARING', 'CANCELLED', 'CUSTOMER_CANCELLED', 'CANCELLATION_REQUESTED'].includes(final.status), final.status);
  if (final.status === 'PREPARING') assert.equal(final.payment?.status, 'CONFIRMED_MANUAL');
  else assert.notEqual(final.payment?.status, 'CONFIRMED_MANUAL', 'a cancelled order must not carry a confirmed payment without a refund path');
});

// ------------------------------------------------------------------------------------------------ Phase 3/4: money and dispatch
async function paidMockOrder(): Promise<{ user: string; orderId: string; dispatchId: string }> {
  const user = freshUser();
  const p = await product(randomInt(10, 90) * 1_000 + randomInt(1, 9) * 100);
  const orderId = (await call('POST', '/orders', user, orderBody(p, 1))).json().order.id as string;
  assert.equal((await call('POST', `/orders/${orderId}/mock-payment`, user)).statusCode, 200);
  const d = await db.taxiDispatch.findFirstOrThrow({ where: { orderId } });
  return { user, orderId, dispatchId: d.id };
}

test('delivery: five simultaneous "delivered" callbacks complete the order once; MOCK earns no commission; history is complete', async () => {
  const { orderId, dispatchId } = await paidMockOrder();
  await db.order.update({ where: { id: orderId }, data: { status: 'READY', readyAt: new Date() } });
  await db.taxiDispatch.update({ where: { id: dispatchId }, data: { status: 'ASSIGNED', dispatchedAt: new Date() } });
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => completeDelivery({ actorTelegramId: operatorTg, dispatchId })));
  const ok = results.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof completeDelivery>>>).value);
  assert.equal(ok.length, 5, 'repeats are no-ops, not errors');
  assert.equal(ok.filter(r => r.changed).length, 1);
  assert.equal(await db.orderEvent.count({ where: { orderId, action: 'DELIVERY_CONFIRMED' } }), 1);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status, 'COMPLETED');
  assert.equal(await db.commissionEntry.count({ where: { orderId } }), 0, 'MOCK/test orders never earn commission');
});

test('delivery: a cancelled order can never become delivered, and an unauthorized operator is refused', async () => {
  const { orderId, dispatchId } = await paidMockOrder();
  await db.order.update({ where: { id: orderId }, data: { status: 'READY', readyAt: new Date() } });
  await db.taxiDispatch.update({ where: { id: dispatchId }, data: { status: 'ASSIGNED', dispatchedAt: new Date() } });
  await assert.rejects(completeDelivery({ actorTelegramId: strangerTg, dispatchId }), /TAKSI_OPERATOR_RUXSAT_YOQ/);
  await assert.rejects(completeDelivery({ actorTelegramId: operatorTg, dispatchId: 'nope' }), /TAKSI_SOROVI_TOPILMADI/);
  await db.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } });
  await assert.rejects(completeDelivery({ actorTelegramId: operatorTg, dispatchId }), /BUYURTMA_BEKOR_QILINGAN/);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status, 'CANCELLED');
  assert.equal((await db.taxiDispatch.findUniqueOrThrow({ where: { id: dispatchId } })).status, 'ASSIGNED');
  assert.equal(await db.commissionEntry.count({ where: { orderId } }), 0);
});

test('delivery: an unpaid / not-yet-ready / not-yet-sent order cannot be completed', async () => {
  const { orderId, dispatchId } = await paidMockOrder();
  await assert.rejects(completeDelivery({ actorTelegramId: operatorTg, dispatchId }), /TAKSI_HALI_YUBORILMAGAN/);
  await db.taxiDispatch.update({ where: { id: dispatchId }, data: { status: 'ASSIGNED' } });
  await assert.rejects(completeDelivery({ actorTelegramId: operatorTg, dispatchId }), /BUYURTMA_HALI_TAYYOR_EMAS/);
  await db.order.update({ where: { id: orderId }, data: { status: 'READY', readyAt: new Date() } });
  await db.payment.updateMany({ where: { orderId }, data: { status: 'AWAITING' } });
  await assert.rejects(completeDelivery({ actorTelegramId: operatorTg, dispatchId }), /TOLOV_TASDIQLANMAGAN/);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status, 'READY');
});

test('taxi: two operator "accept" callbacks together change the dispatch once; a stranger cannot act; a late "sent" after delivery is stale', async () => {
  const { orderId, dispatchId } = await paidMockOrder();
  await db.order.update({ where: { id: orderId }, data: { status: 'READY', readyAt: new Date() } });
  await db.taxiDispatch.update({ where: { id: dispatchId }, data: { status: 'REQUESTED' } });
  await assert.rejects(respondToTaxi({ actorTelegramId: strangerTg, dispatchId, action: 'ACCEPT' }), /TAKSI_OPERATOR_RUXSAT_YOQ/);
  const acc = await Promise.all([1, 2].map(() => respondToTaxi({ actorTelegramId: operatorTg, dispatchId, action: 'ACCEPT' })));
  assert.deepEqual(acc.map(a => a.changed).sort(), [false, true]);
  assert.equal(await db.orderEvent.count({ where: { orderId, action: 'TAXI_ACCEPTED' } }), 1, 'audited once');
  const sent = await Promise.all([1, 2].map(() => respondToTaxi({ actorTelegramId: operatorTg, dispatchId, action: 'SENT' })));
  assert.deepEqual(sent.map(a => a.changed).sort(), [false, true]);
  assert.equal(await db.taxiDispatch.count({ where: { orderId, status: { in: ['REQUESTED', 'ACCEPTED', 'ASSIGNED', 'NEEDS_HELP', 'CANCELLATION_PENDING'] } } }), 1, 'one active dispatch');
  await completeDelivery({ actorTelegramId: operatorTg, dispatchId });
  const late = await respondToTaxi({ actorTelegramId: operatorTg, dispatchId, action: 'SENT' });
  assert.equal(late.changed, false);
  assert.equal(late.finalStatus, 'STALE');
});

// ------------------------------------------------------------------------------------------------ Phase 5: API security
test('proxy headers: with TRUST_PROXY off, a spoofed X-Forwarded-For cannot dodge the throttle or impersonate another client', async () => {
  const codes: number[] = [];
  for (let i = 0; i < 40; i++) {
    const r = await app.inject({ method: 'GET', url: '/api/v1/miniapp/me', remoteAddress: '10.77.0.5',
      headers: { authorization: 'tma nope', 'x-forwarded-for': `203.0.113.${i + 1}`, 'x-real-ip': `198.51.100.${i + 1}` } });
    codes.push(r.statusCode);
  }
  assert.ok(codes.includes(429), `rotating X-Forwarded-For must not give a fresh budget: ${codes.join(',')}`);
  // a different real peer is unaffected by that block
  const other = await app.inject({ method: 'GET', url: '/api/v1/miniapp/me', remoteAddress: '10.77.0.6', headers: { authorization: 'tma nope' } });
  assert.equal(other.statusCode, 401);
});

test('malformed bodies: 400 (never 500) on invalid JSON, wrong shapes and oversize payloads; nothing is created', async () => {
  const u = freshUser();
  const before = await db.order.count({ where: { restaurantId } });
  const hdr = { authorization: `tma ${initFor(u)}`, 'content-type': 'application/json' };
  const post = (payload: string | Buffer, headers: Record<string, string> = hdr) => app.inject({ method: 'POST', url: '/api/v1/miniapp/orders', payload, headers });
  assert.equal((await post('{"checkoutKey":')).statusCode, 400, 'truncated JSON');
  assert.equal((await post('not json at all')).statusCode, 400);
  assert.equal((await post('[]')).statusCode, 400, 'array body');
  assert.equal((await post('null')).statusCode, 400);
  assert.equal((await post('"string"')).statusCode, 400);
  assert.equal((await post('{}')).statusCode, 400, 'empty object');
  assert.equal((await post(JSON.stringify({ ...orderBody({ id: 'x', priceSom: 1 }), items: [{ productId: 'x', quantity: -1 }] }))).statusCode, 400, 'negative quantity');
  assert.equal((await post(JSON.stringify({ ...orderBody({ id: 'x', priceSom: 1 }), items: [{ productId: 'x', quantity: 1.5 }] }))).statusCode, 400, 'fractional quantity');
  assert.equal((await post(JSON.stringify({ ...orderBody({ id: 'x', priceSom: 1 }), items: [] }))).statusCode, 400, 'no items');
  assert.equal((await post(JSON.stringify({ a: 'x'.repeat(40_000) }))).statusCode, 413, 'over the 32 KiB body limit');
  const text = await post('checkoutKey=1', { ...hdr, 'content-type': 'text/plain' });
  assert.ok([400, 415].includes(text.statusCode), String(text.statusCode));
  assert.equal(await db.order.count({ where: { restaurantId } }), before);
  for (const r of [await post('{"a":'), await post('[]')]) assert.ok(!/at .*\.(ts|js):\d+/.test(r.body), 'no stack trace leaks');
});

test('internal API: missing, wrong and wrong-length keys are 401; malformed query input is 4xx not 500', async () => {
  for (const headers of [{}, { 'x-internal-api-key': 'wrong' }, { 'x-internal-api-key': 'x'.repeat(200) }, { 'x-internal-api-key': '' }]) {
    const r = await app.inject({ method: 'GET', url: '/api/v1/internal/orders', headers });
    assert.ok([401, 404].includes(r.statusCode), `${r.statusCode} ${JSON.stringify(headers).slice(0, 40)}`);
  }
  const post = await app.inject({ method: 'POST', url: '/api/v1/internal/orders', payload: { restaurantId, items: [] } });
  assert.equal(post.statusCode, 401, 'no key, no write');
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/miniapp/orders/%00%2e%2e' , headers: { authorization: `tma ${initFor(freshUser())}` } })).statusCode < 500, true);
});

test('cross-customer isolation under load: 20 customers each read only their own order; every foreign read is 404', async () => {
  const mine = await Promise.all(Array.from({ length: 20 }, async () => {
    const user = freshUser();
    const p = await product(randomInt(10, 90) * 1_000 + randomInt(1, 9) * 100);
    return { user, id: (await call('POST', '/orders', user, orderBody(p, 1))).json().order.id as string };
  }));
  const checks = await Promise.all(mine.flatMap((a, i) => {
    const b = mine[(i + 1) % mine.length]!;
    return [call('GET', `/orders/${a.id}`, a.user), call('GET', `/orders/${a.id}`, b.user), call('POST', `/orders/${a.id}/cancel`, b.user, {})];
  }));
  checks.forEach((r, i) => assert.equal(r.statusCode, i % 3 === 0 ? 200 : 404, `check ${i}`));
  for (const a of mine) assert.equal((await db.order.findUniqueOrThrow({ where: { id: a.id } })).status, 'PAYMENT_PENDING', 'foreign cancel changed nothing');
});
