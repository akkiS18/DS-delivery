import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { placeOrder } from '../modules/orders/service.js';
import { acceptOrder, expireWaitingOrders, rejectOrder } from '../modules/restaurant/acceptance.js';
import { takeStaffAction } from '../modules/restaurant/service.js';
import { db as appDb } from '../lib/db.js';

// Legacy manual-acceptance flow (the pre-6F default) is what this file exercises; the 6F default has its own suite.
process.env.RESTAURANT_MANUAL_ACCEPTANCE = 'true';
const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const staffId = String(randomInt(100000000000, 400000000000));
const otherStaffId = String(randomInt(400000000001, 700000000000));
const customerTg = String(randomInt(700000000001, 900000000000));
let restaurantId = '';
let otherRestaurantId = '';
let taxiId = '';
let productId = '';
let product2Id = '';
let realLast4 = '';
let testLast4 = '';
const price = 21_000;

const place = (paymentMode: 'REAL' | 'MOCK' = 'REAL', createdViaBot = true, product = productId) => placeOrder(engine, {
  restaurantId, telegramUserId: customerTg, customerName: 'Test', phone: '+998901234567', addressText: 'Test manzil',
  taxiCompanyId: taxiId, checkoutKey: randomUUID(), createdViaBot, paymentMode,
  items: [{ productId: product, quantity: 1 }],
}).then(o => o!);
const accept = (orderId: string, actor = staffId) => acceptOrder(engine, { actorTelegramId: actor, orderId, prepMinutes: 20 });
const orderRow = (id: string) => db.order.findUniqueOrThrow({ where: { id } });
const payments = (orderId: string) => db.payment.findMany({ where: { orderId } });
const actions = async (orderId: string) => (await db.orderEvent.findMany({ where: { orderId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(e => e.action);

before(async () => {
  await db.$connect();
  restaurantId = (await db.restaurant.create({ data: { slug: `accept-${randomUUID()}`, name: 'Accept test', staffTelegramUserId: staffId } })).id;
  otherRestaurantId = (await db.restaurant.create({ data: { slug: `accept-o-${randomUUID()}`, name: 'Other', staffTelegramUserId: otherStaffId } })).id;
  taxiId = (await db.taxiCompany.create({ data: { name: `Taxi ${randomUUID()}`, operatorTelegramUserId: String(randomInt(900000000001, 990000000000)), isActive: true } })).id;
  productId = (await db.product.create({ data: { restaurantId, name: 'Burger', priceSom: price } })).id;
  product2Id = (await db.product.create({ data: { restaurantId, name: 'Soda', priceSom: 22_000 } })).id;
  for (;;) {
    const a = String(randomInt(1000, 4999)); const b = String(randomInt(5000, 9999));
    if (await db.card.findFirst({ where: { last4: { in: [a, b] } } })) continue;
    realLast4 = a; testLast4 = b; break;
  }
  await engine.addCard(realLast4, false, restaurantId);
  await engine.addCard(testLast4, true, restaurantId);
});
after(async () => {
  delete process.env.RESTAURANT_MANUAL_ACCEPTANCE;
  const ids = (await db.payment.findMany({ where: { restaurantId }, select: { id: true } })).map(p => p.id);
  await db.incomingTransaction.deleteMany({ where: { OR: [{ matchedPaymentId: { in: ids } }, { cardLast4: { in: [realLast4, testLast4] } }] } });
  await db.payment.deleteMany({ where: { id: { in: ids } } });
  const cards = await db.card.findMany({ where: { restaurantId }, select: { id: true } });
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards.map(c => c.id) } } });
  await db.card.deleteMany({ where: { restaurantId } });
  await db.order.deleteMany({ where: { restaurantId } });
  await db.product.deleteMany({ where: { restaurantId } });
  await db.customer.deleteMany({ where: { telegramUserId: customerTg } });
  await db.taxiCompany.delete({ where: { id: taxiId } });
  await db.restaurant.deleteMany({ where: { id: { in: [restaurantId, otherRestaurantId] } } });
  await db.$disconnect();
  await appDb.$disconnect();
});

test('REAL checkout creates a WAITING_RESTAURANT order with no payment, a deadline and a PLACED event', async () => {
  const o = await place();
  const row = await orderRow(o.id);
  assert.equal(row.status, 'WAITING_RESTAURANT');
  assert.equal(o.payment, null);
  assert.equal((await payments(o.id)).length, 0);
  assert.equal(row.paymentIsTest, false);
  assert.ok(row.restaurantDeadlineAt && row.restaurantDeadlineAt.getTime() > Date.now());
  assert.deepEqual(await actions(o.id), ['PLACED']);
  assert.equal(await db.card.count({ where: { restaurantId, last4: realLast4 } }), 1);
});

test('no real money can be matched before acceptance; after acceptance the 4A signal-only rule still holds', async () => {
  const o = await place();
  const before = await engine.ingestGmail(`accept-${randomUUID()}`, {
    cardLast4: realLast4, amountTiyin: BigInt(price) * 100n, occurredAt: new Date(), emailReceivedAt: new Date(),
    minutePrecision: false, trustedSender: true });
  assert.equal(before.status, 'REVIEW_REQUIRED');
  assert.equal((await orderRow(o.id)).status, 'WAITING_RESTAURANT');
  const r = await accept(o.id);
  assert.equal(r.result, 'ACCEPTED');
  const [p] = await payments(o.id);
  assert.equal(p!.status, 'AWAITING');
  assert.equal(p!.amountTiyin, BigInt(price) * 100n);
  const m = await engine.ingestGmail(`accept-${randomUUID()}`, {
    cardLast4: realLast4, amountTiyin: p!.amountTiyin, occurredAt: new Date(), emailReceivedAt: new Date(),
    minutePrecision: false, trustedSender: true });
  assert.equal(m.status, 'MATCHED_UNVERIFIED');
  const row = await orderRow(o.id);
  assert.equal(row.status, 'PAYMENT_MATCHED_UNVERIFIED');
  assert.equal(row.paymentVerifiedAt, null);
  // only the restaurant staff confirms
  await assert.rejects(takeStaffAction({ actorTelegramId: otherStaffId, orderId: o.id, action: 'VERIFY_PAYMENT' }), /RUXSAT_YOQ/);
  assert.equal((await takeStaffAction({ actorTelegramId: staffId, orderId: o.id, action: 'VERIFY_PAYMENT' })).status, 'PAYMENT_CONFIRMED');
});

test('only the order\'s restaurant staff can accept or reject', async () => {
  const o = await place();
  await assert.rejects(accept(o.id, otherStaffId), /RUXSAT_YOQ/);
  await assert.rejects(accept(o.id, String(randomInt(1, 99999))), /RUXSAT_YOQ/);
  await assert.rejects(rejectOrder({ actorTelegramId: otherStaffId, orderId: o.id, reason: 'OTHER' }), /RUXSAT_YOQ/);
  assert.equal((await orderRow(o.id)).status, 'WAITING_RESTAURANT');
  assert.equal((await payments(o.id)).length, 0);
});

test('parallel accepts create exactly one payment and one ACCEPT event', async () => {
  const o = await place();
  const rs = await Promise.all(Array.from({ length: 6 }, () => accept(o.id)));
  assert.equal(rs.filter(r => r.result === 'ACCEPTED').length, 1);
  assert.equal(rs.filter(r => r.result === 'STALE').length, 5);
  assert.equal((await payments(o.id)).length, 1);
  const row = await orderRow(o.id);
  assert.equal(row.status, 'PAYMENT_PENDING');
  assert.equal(row.acceptedBy, staffId);
  assert.ok(row.acceptedAt);
  assert.equal(row.estimatedPrepMinutes, 20);
  assert.deepEqual(await actions(o.id), ['PLACED', 'ACCEPT']);
});

test('accept racing reject: exactly one wins and the payment exists only if accepted', async () => {
  for (let i = 0; i < 3; i++) {
    const o = await place();
    const rs = await Promise.all([accept(o.id), rejectOrder({ actorTelegramId: staffId, orderId: o.id, reason: 'CLOSED' }), accept(o.id),
      rejectOrder({ actorTelegramId: staffId, orderId: o.id, reason: 'OTHER' })]);
    const wins = rs.filter(r => r.result === 'ACCEPTED' || r.result === 'REJECTED');
    assert.equal(wins.length, 1);
    const row = await orderRow(o.id);
    if (wins[0]!.result === 'ACCEPTED') {
      assert.equal(row.status, 'PAYMENT_PENDING');
      assert.equal((await payments(o.id)).length, 1);
    } else {
      assert.equal(row.status, 'RESTAURANT_REJECTED');
      assert.equal((await payments(o.id)).length, 0);
      assert.ok(row.rejectedAt);
      assert.equal(row.rejectedBy, staffId);
    }
  }
});

test('rejection is audited; repeated rejection and later acceptance do nothing', async () => {
  const o = await place();
  assert.deepEqual(await rejectOrder({ actorTelegramId: staffId, orderId: o.id, reason: 'UNAVAILABLE' }), { result: 'REJECTED' });
  assert.deepEqual(await rejectOrder({ actorTelegramId: staffId, orderId: o.id, reason: 'UNAVAILABLE' }), { result: 'STALE' });
  assert.deepEqual(await accept(o.id), { result: 'STALE' });
  assert.equal((await orderRow(o.id)).rejectReason, 'UNAVAILABLE');
  assert.deepEqual(await actions(o.id), ['PLACED', 'REJECT']);
  assert.equal((await payments(o.id)).length, 0);
});

test('changed price or unavailable product blocks acceptance; the snapshot stays immutable', async () => {
  const o = await place();
  await db.product.update({ where: { id: productId }, data: { priceSom: price + 1_000 } });
  try {
    const r = await accept(o.id);
    assert.equal(r.result, 'PROBLEMS');
    if (r.result === 'PROBLEMS') assert.equal(r.problems[0]!.kind, 'PRICE_CHANGED');
    await db.product.update({ where: { id: productId }, data: { priceSom: price, isAvailable: false } });
    const r2 = await accept(o.id);
    assert.equal(r2.result === 'PROBLEMS' && r2.problems[0]!.kind, 'UNAVAILABLE');
  } finally {
    await db.product.update({ where: { id: productId }, data: { priceSom: price, isAvailable: true } });
  }
  assert.equal((await orderRow(o.id)).status, 'WAITING_RESTAURANT');
  assert.equal((await payments(o.id)).length, 0);
  assert.deepEqual(await actions(o.id), ['PLACED', 'ACCEPT_REFUSED', 'ACCEPT_REFUSED']);
  const items = await db.orderItem.findMany({ where: { orderId: o.id } });
  assert.equal(items[0]!.unitSom, price);
  // DB-level: order lines cannot be rewritten
  await assert.rejects(db.orderItem.update({ where: { id: items[0]!.id }, data: { unitSom: 1 } }));
  await assert.rejects(db.orderItem.update({ where: { id: items[0]!.id }, data: { quantity: 9 } }));
});

test('response timeout: late accept is refused and the order expires; the sweep is idempotent', async () => {
  const late = await place();
  await db.order.update({ where: { id: late.id }, data: { restaurantDeadlineAt: new Date(Date.now() - 1000) } });
  assert.deepEqual(await accept(late.id), { result: 'TIMED_OUT' });
  assert.equal((await orderRow(late.id)).status, 'RESTAURANT_EXPIRED');
  assert.equal((await payments(late.id)).length, 0);
  const o = await place();
  await db.order.update({ where: { id: o.id }, data: { restaurantDeadlineAt: new Date(Date.now() - 1000) } });
  const sweeps = await Promise.all([expireWaitingOrders(), expireWaitingOrders(), expireWaitingOrders()]);
  assert.equal(sweeps.flat().filter(id => id === o.id).length, 1);
  assert.equal((await orderRow(o.id)).status, 'RESTAURANT_EXPIRED');
  assert.deepEqual(await actions(o.id), ['PLACED', 'RESTAURANT_TIMEOUT']);
  assert.deepEqual(await accept(o.id), { result: 'STALE' });
  assert.deepEqual(await rejectOrder({ actorTelegramId: staffId, orderId: o.id, reason: 'OTHER' }), { result: 'STALE' });
});

test('database refuses a payment for an order that is waiting, rejected or expired', async () => {
  const o = await place();
  await assert.rejects(db.payment.create({ data: { orderId: o.id, restaurantId, amountTiyin: 2_100_000n, status: 'QUEUED' } }), /accepted order/);
  await rejectOrder({ actorTelegramId: staffId, orderId: o.id, reason: 'OTHER' });
  await assert.rejects(db.payment.create({ data: { orderId: o.id, restaurantId, amountTiyin: 2_100_000n, status: 'QUEUED' } }), /accepted order/);
  // a second attempt for an accepted order violates Payment.orderId UNIQUE
  const acc = await place();
  await accept(acc.id);
  await assert.rejects(db.payment.create({ data: { orderId: acc.id, restaurantId, amountTiyin: 2_100_000n, status: 'QUEUED' } }));
});

test('MOCK compatibility: immediate payment by default (Stage 6F), legacy acceptance flow when opted in', async () => {
  delete process.env.RESTAURANT_MANUAL_ACCEPTANCE;
  const legacy = await place('MOCK', false);
  assert.equal((await orderRow(legacy.id)).status, 'PAYMENT_PENDING');
  assert.equal((await payments(legacy.id)).length, 1);
  assert.equal((await payments(legacy.id))[0]!.isTest, true);
  process.env.RESTAURANT_MANUAL_ACCEPTANCE = 'true';
  try {
    const waiting = await place('MOCK', true, product2Id); // different amount: the test card is free
    assert.equal((await orderRow(waiting.id)).status, 'WAITING_RESTAURANT');
    assert.equal((await payments(waiting.id)).length, 0);
    assert.equal((await accept(waiting.id)).result, 'ACCEPTED');
    const [p] = await payments(waiting.id);
    assert.equal(p!.isTest, true); // a mock order never receives a real card
    assert.equal((await db.card.findUniqueOrThrow({ where: { id: p!.cardId! } })).isTest, true);
  } finally { process.env.RESTAURANT_MANUAL_ACCEPTANCE = 'true'; }
});
