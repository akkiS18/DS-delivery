import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { placeOrder } from '../modules/orders/service.js';
import { acceptOrder, expireWaitingOrders } from '../modules/restaurant/acceptance.js';
import { cancelWaitingOrder, expireConsents, proposePriceRevision, respondToRevision } from '../modules/restaurant/price-consent.js';
import { db as appDb } from '../lib/db.js';

// Legacy accept-first flow (RESTAURANT_MANUAL_ACCEPTANCE) and legacy price-consent; the 6F default has its own suite.
process.env.RESTAURANT_MANUAL_ACCEPTANCE = 'true';
process.env.LEGACY_PRICE_PROPOSALS = 'true';
const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const staffId = String(randomInt(100000000000, 400000000000));
const customerTg = String(randomInt(400000000001, 700000000000));
const strangerTg = String(randomInt(700000000001, 800000000000));
let restaurantId = '';
let taxiId = '';
let realLast4 = '';
const productIds: string[] = [];

/** A fresh product (own price, so its own payment amount) per order keeps the single test card free. */
async function newProduct(priceSom: number): Promise<string> {
  const id = (await db.product.create({ data: { restaurantId, name: `P${productIds.length}`, priceSom } })).id;
  productIds.push(id);
  return id;
}
async function place(pid?: string) {
  const productId = pid ?? await newProduct(randomInt(10_000, 900_000));
  const o = (await placeOrder(engine, {
    restaurantId, telegramUserId: customerTg, customerName: 'T', phone: '+998901234567', addressText: 'Test manzil',
    taxiCompanyId: taxiId, checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'REAL',
    items: [{ productId, quantity: 2 }],
  }))!;
  return { o, productId };
}
const accept = (orderId: string) => acceptOrder(engine, { actorTelegramId: staffId, orderId, prepMinutes: 15 });
const row = (id: string) => db.order.findUniqueOrThrow({ where: { id } });
const pays = (orderId: string) => db.payment.findMany({ where: { orderId } });
const actions = async (orderId: string) =>
  (await db.orderEvent.findMany({ where: { orderId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(e => e.action);
const respond = (revisionId: string, accept: boolean, telegramUserId = customerTg) =>
  respondToRevision(engine, { telegramUserId, revisionId, accept });
const propose = (orderId: string) => proposePriceRevision({ actorTelegramId: staffId, orderId, prepMinutes: 20 });

before(async () => {
  await db.$connect();
  restaurantId = (await db.restaurant.create({ data: { slug: `accept2-${randomUUID()}`, name: 'Accept2', staffTelegramUserId: staffId } })).id;
  taxiId = (await db.taxiCompany.create({ data: {
    name: `Taxi ${randomUUID()}`, operatorTelegramUserId: String(randomInt(900000000001, 990000000000)), isActive: true } })).id;
  for (;;) {
    const a = String(randomInt(1000, 9999));
    if (!await db.card.findUnique({ where: { last4: a } })) { realLast4 = a; break; }
  }
  await engine.addCard(realLast4, false, restaurantId);
});
after(async () => {
  const ids = (await db.payment.findMany({ where: { restaurantId }, select: { id: true } })).map(p => p.id);
  await db.incomingTransaction.deleteMany({ where: { OR: [{ matchedPaymentId: { in: ids } }, { cardLast4: realLast4 }] } });
  await db.payment.deleteMany({ where: { id: { in: ids } } });
  const cards = await db.card.findMany({ where: { restaurantId }, select: { id: true } });
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards.map(c => c.id) } } });
  await db.card.deleteMany({ where: { restaurantId } });
  await db.order.deleteMany({ where: { restaurantId } });
  await db.product.deleteMany({ where: { restaurantId } });
  await db.customer.deleteMany({ where: { telegramUserId: { in: [customerTg, strangerTg] } } });
  await db.taxiCompany.delete({ where: { id: taxiId } });
  await db.restaurant.delete({ where: { id: restaurantId } });
  await db.$disconnect();
  await appDb.$disconnect();
});

test('REAL orders outside the bot are refused up front (nothing is created)', async () => {
  const productId = await newProduct(10_000);
  const count = await db.order.count({ where: { restaurantId } });
  await assert.rejects(placeOrder(engine, {
    restaurantId, telegramUserId: customerTg, addressText: 'Test manzil', createdViaBot: false, paymentMode: 'REAL',
    items: [{ productId, quantity: 1 }],
  }), /Telegram bot/);
  assert.equal(await db.order.count({ where: { restaurantId } }), count);
});

test('customer cancellation: authorized, audited, blocks later acceptance, no payment', async () => {
  const { o } = await place();
  assert.deepEqual(await cancelWaitingOrder({ telegramUserId: strangerTg, orderId: o.id }), { result: 'NOT_FOUND' });
  assert.equal((await row(o.id)).status, 'WAITING_RESTAURANT');
  assert.deepEqual(await cancelWaitingOrder({ telegramUserId: customerTg, orderId: o.id }), { result: 'CANCELLED' });
  assert.deepEqual(await cancelWaitingOrder({ telegramUserId: customerTg, orderId: o.id }), { result: 'TOO_LATE' });
  assert.deepEqual(await accept(o.id), { result: 'STALE' });
  const r = await row(o.id);
  assert.equal(r.status, 'CUSTOMER_CANCELLED');
  assert.equal(r.cancelledBy, customerTg);
  assert.equal(r.cancelReason, 'CUSTOMER_REQUEST');
  assert.equal((await pays(o.id)).length, 0);
  assert.deepEqual(await actions(o.id), ['PLACED', 'CANCEL']);
});

test('acceptance vs cancellation race: exactly one wins, payment exists only if accepted', async () => {
  for (let i = 0; i < 4; i++) {
    const { o } = await place();
    const cancel = () => cancelWaitingOrder({ telegramUserId: customerTg, orderId: o.id });
    const rs = await Promise.all([accept(o.id), cancel(), accept(o.id), cancel()]);
    const accepted = rs.filter(r => r.result === 'ACCEPTED').length;
    const cancelled = rs.filter(r => r.result === 'CANCELLED').length;
    assert.equal(accepted + cancelled, 1);
    assert.equal((await row(o.id)).status, accepted ? 'PAYMENT_PENDING' : 'CUSTOMER_CANCELLED');
    assert.equal((await pays(o.id)).length, accepted);
  }
});

test('after acceptance the customer cannot cancel through this path (money may be in flight)', async () => {
  const { o } = await place();
  assert.equal((await accept(o.id)).result, 'ACCEPTED');
  assert.deepEqual(await cancelWaitingOrder({ telegramUserId: customerTg, orderId: o.id }), { result: 'TOO_LATE' });
  assert.equal((await row(o.id)).status, 'PAYMENT_PENDING');
  assert.equal((await pays(o.id)).length, 1);
});

test('paused or inactive restaurant cannot accept or propose; nothing is created', async () => {
  const { o } = await place();
  for (const data of [{ isPaused: true }, { isActive: false }]) {
    await db.restaurant.update({ where: { id: restaurantId }, data });
    try {
      assert.deepEqual(await accept(o.id), { result: 'RESTAURANT_CLOSED' });
      assert.equal((await propose(o.id)).result, 'RESTAURANT_CLOSED');
    } finally {
      await db.restaurant.update({ where: { id: restaurantId }, data: { isPaused: false, isActive: true } });
    }
  }
  assert.equal((await row(o.id)).status, 'WAITING_RESTAURANT');
  assert.equal((await pays(o.id)).length, 0);
  assert.deepEqual((await actions(o.id)).slice(0, 2), ['PLACED', 'ACCEPT_REFUSED']);
  assert.equal((await accept(o.id)).result, 'ACCEPTED'); // a reopened restaurant can accept
});

test('unavailable product blocks acceptance and cannot be turned into a price revision', async () => {
  const { o, productId } = await place();
  await db.product.update({ where: { id: productId }, data: { isAvailable: false } });
  assert.equal((await accept(o.id)).result, 'PROBLEMS');
  assert.equal((await propose(o.id)).result, 'NOT_REVISABLE');
  assert.equal((await pays(o.id)).length, 0);
  assert.equal((await row(o.id)).status, 'WAITING_RESTAURANT');
});

test('changed price: never charged without consent; consent creates ONE payment at the new amount; history kept', async () => {
  const { o, productId } = await place(await newProduct(10_000));
  await db.product.update({ where: { id: productId }, data: { priceSom: 12_000 } });
  assert.equal((await accept(o.id)).result, 'PROBLEMS');
  assert.equal((await pays(o.id)).length, 0);
  const p = await propose(o.id);
  assert.equal(p.result, 'PROPOSED');
  if (p.result !== 'PROPOSED') return;
  assert.deepEqual([p.oldTotal, p.newTotal], [20_000, 24_000]);
  assert.equal((await row(o.id)).status, 'WAITING_CUSTOMER_CONSENT');
  assert.equal((await pays(o.id)).length, 0); // still no payment
  assert.equal((await accept(o.id)).result, 'STALE');
  assert.equal((await propose(o.id)).result, 'STALE');
  // another Telegram account cannot answer, even with the right revision id
  assert.deepEqual(await respond(p.revisionId, true, strangerTg), { result: 'NOT_FOUND' });
  // duplicate / parallel consent: exactly one payment
  const rs = await Promise.all(Array.from({ length: 5 }, () => respond(p.revisionId, true)));
  assert.equal(rs.filter(r => r.result === 'ACCEPTED').length, 1);
  assert.equal(rs.filter(r => r.result === 'STALE').length, 4);
  const all = await pays(o.id);
  assert.equal(all.length, 1);
  assert.equal(all[0]!.amountTiyin, 2_400_000n);
  const r = await row(o.id);
  assert.equal(r.status, 'PAYMENT_PENDING');
  assert.equal(r.totalSom, 24_000);
  assert.equal(r.estimatedPrepMinutes, 20);
  // snapshots: old lines kept (superseded), new lines active; the DB blocks rewriting history
  const items = await db.orderItem.findMany({ where: { orderId: o.id } });
  assert.equal(items.length, 2);
  const old = items.find(i => i.supersededAt)!;
  const cur = items.find(i => !i.supersededAt)!;
  assert.deepEqual([old.unitSom, cur.unitSom], [10_000, 12_000]);
  await assert.rejects(db.orderItem.update({ where: { id: old.id }, data: { supersededAt: null } }));
  await assert.rejects(db.orderItem.update({ where: { id: cur.id }, data: { unitSom: 1 } }));
  assert.deepEqual(await actions(o.id), ['PLACED', 'ACCEPT_REFUSED', 'PRICE_PROPOSED', 'PRICE_CONSENT']);
  assert.equal((await db.orderPriceRevision.findUniqueOrThrow({ where: { id: p.revisionId } })).status, 'ACCEPTED');
  // Stage 4A still applies to the revised amount: a mail for the old amount is only reviewed; the new one only signals
  if (all[0]!.status === 'AWAITING') {
    const mail = (tiyin: bigint) => engine.ingestGmail(`acc2-${randomUUID()}`, {
      cardLast4: realLast4, amountTiyin: tiyin, occurredAt: new Date(), emailReceivedAt: new Date(),
      minutePrecision: false, trustedSender: true });
    assert.equal((await mail(2_000_000n)).status, 'REVIEW_REQUIRED');
    assert.equal((await mail(2_400_000n)).status, 'MATCHED_UNVERIFIED');
    assert.equal((await row(o.id)).status, 'PAYMENT_MATCHED_UNVERIFIED');
  }
});

test('declining, cancelling or letting the price proposal expire closes the order without any payment', async () => {
  const mk = async () => {
    const { o, productId } = await place(await newProduct(10_000));
    await db.product.update({ where: { id: productId }, data: { priceSom: 11_000 } });
    const p = await propose(o.id);
    assert.equal(p.result, 'PROPOSED');
    return { o, rid: p.result === 'PROPOSED' ? p.revisionId : '' };
  };
  const a = await mk();
  assert.equal((await respond(a.rid, false)).result, 'DECLINED');
  assert.equal((await respond(a.rid, true)).result, 'STALE');
  assert.equal((await row(a.o.id)).cancelReason, 'PRICE_DECLINED');
  const b = await mk();
  assert.equal((await cancelWaitingOrder({ telegramUserId: customerTg, orderId: b.o.id })).result, 'CANCELLED');
  assert.equal((await db.orderPriceRevision.findUniqueOrThrow({ where: { id: b.rid } })).status, 'VOID');
  assert.equal((await respond(b.rid, true)).result, 'STALE');
  const c = await mk();
  await db.orderPriceRevision.update({ where: { id: c.rid }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await respond(c.rid, true)).result, 'EXPIRED');
  await Promise.all([expireConsents(), expireConsents()]);
  assert.equal((await row(c.o.id)).status, 'CUSTOMER_CANCELLED');
  assert.equal((await row(c.o.id)).cancelReason, 'CONSENT_TIMEOUT');
  assert.equal((await actions(c.o.id)).filter(x => x === 'CANCEL').length, 1);
  for (const x of [a, b, c]) assert.equal((await pays(x.o.id)).length, 0);
});

test('menu changing again after the proposal voids the consent instead of charging a different amount', async () => {
  const { o, productId } = await place(await newProduct(10_000));
  await db.product.update({ where: { id: productId }, data: { priceSom: 11_000 } });
  const p = await propose(o.id);
  assert.equal(p.result, 'PROPOSED');
  await db.product.update({ where: { id: productId }, data: { priceSom: 13_000 } });
  assert.equal((await respond(p.result === 'PROPOSED' ? p.revisionId : '', true)).result, 'MENU_CHANGED');
  assert.equal((await row(o.id)).cancelReason, 'MENU_CHANGED');
  assert.equal((await pays(o.id)).length, 0);
});

test('expired orders cannot be accepted and the DB refuses early or second payment attempts', async () => {
  const { o } = await place();
  await db.order.update({ where: { id: o.id }, data: { restaurantDeadlineAt: new Date(Date.now() - 1000) } });
  assert.deepEqual(await accept(o.id), { result: 'TIMED_OUT' });
  assert.equal((await propose(o.id)).result, 'STALE');
  await expireWaitingOrders();
  assert.equal((await row(o.id)).status, 'RESTAURANT_EXPIRED');
  const attempt = (orderId: string) => db.payment.create({ data: { orderId, restaurantId, amountTiyin: 100_000n, status: 'QUEUED' } });
  await assert.rejects(attempt(o.id), /accepted order/);
  const { o: o2 } = await place();
  await accept(o2.id);
  await assert.rejects(attempt(o2.id)); // Payment.orderId is UNIQUE
  assert.equal((await pays(o2.id)).length, 1);
  const { o: o3 } = await place();
  await cancelWaitingOrder({ telegramUserId: customerTg, orderId: o3.id });
  await assert.rejects(attempt(o3.id), /accepted order/);
});
