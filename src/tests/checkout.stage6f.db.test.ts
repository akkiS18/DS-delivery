import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { CheckoutError, placeOrder } from '../modules/orders/service.js';
import { checkoutRequestSchema, customerCancelRequestSchema, quoteCheckout, quoteRequestSchema, toPlaceOrderInput } from '../modules/orders/contract.js';
import { attemptKey, setRestaurantPassword } from '../modules/restaurant-auth/service.js';
import { autoAdvanceMockOrders } from '../modules/restaurant-orders/auto.js';
import { prepClock } from '../modules/restaurant-orders/service.js';
import { takeStaffAction } from '../modules/restaurant/service.js';
import { cancelUnpaidOrder, markRefundSent, requestCancellation } from '../modules/refunds/service.js';
import { db as appDb } from '../lib/db.js';

// Stage 6F default flow: NO manual acceptance. Everything here runs against ds_delivery_test with MOCK payments or a
// local engine (no Telegram, no real money, no taxi message is ever sent: the taxi worker is not running).
delete process.env.RESTAURANT_MANUAL_ACCEPTANCE;
delete process.env.LEGACY_PRICE_PROPOSALS;
process.env.RESTAURANT_LOGIN_MAX_FAILURES = '50';
process.env.RESTAURANT_LOGIN_IP_MAX_FAILURES = '1000';

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const app = buildApp(engine);
const nonce = randomUUID().slice(0, 8);
const slugA = `f6-a-${nonce}`;
const slugB = `f6-b-${nonce}`;
const PW_A = `Alpha-${randomUUID()}`;
const PW_B = `Bravo-${randomUUID()}`;
const customerTg = String(randomInt(700000000001, 800000000000));
const operatorTg = String(randomInt(900000000001, 990000000000));
const ids: Record<string, string> = {};
const ips: string[] = [];
const cardsLast4: string[] = [];
let realLast4 = '';
let mockLast4 = '';
let taxiId = '';
let ta = '';
let tb = '';

const ip = () => { const v = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`; ips.push(v); return v; };
async function loginToken(slug: string, password: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/v1/restaurant/auth/login', payload: { slug, password }, remoteAddress: ip() });
  assert.equal(r.statusCode, 200);
  return r.json().accessToken;
}
const call = (method: 'GET' | 'POST', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1/restaurant${url}`, payload: payload as object | undefined, headers: { authorization: `Bearer ${token}` } });
async function product(over: { price?: number; restaurant?: string; available?: boolean } = {}) {
  return db.product.create({ data: {
    restaurantId: over.restaurant ?? ids.a!, name: `P${randomUUID().slice(0, 6)}`, priceSom: over.price ?? randomInt(10_000, 900_000), isAvailable: over.available ?? true,
  } });
}
async function order(mode: 'MOCK' | 'REAL', over: Partial<Parameters<typeof placeOrder>[1]> = {}, price?: number) {
  const p = await product(price === undefined ? {} : { price });
  const o = await placeOrder(engine, {
    restaurantId: ids.a!, telegramUserId: customerTg, customerName: 'Tester', phone: '+998901234567', addressText: 'Test manzil',
    taxiCompanyId: taxiId, checkoutKey: randomUUID(), createdViaBot: true, paymentMode: mode, items: [{ productId: p.id, quantity: 2 }], ...over,
  });
  return { o: o!, p };
}
const row = (id: string) => db.order.findUniqueOrThrow({ where: { id } });
const events = async (id: string) => (await db.orderEvent.findMany({ where: { orderId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(e => e.action);
const gmailMatch = (orderId: string) => db.payment.findFirstOrThrow({ where: { orderId } }).then(p => engine.ingestGmail(`f6-${randomUUID()}`, {
  cardLast4: realLast4, amountTiyin: p.amountTiyin, occurredAt: new Date(), emailReceivedAt: new Date(), minutePrecision: false, trustedSender: true }));
const counts = async () => ({ orders: await db.order.count({ where: { restaurantId: { in: Object.values(ids) } } }), payments: await db.payment.count({ where: { restaurantId: { in: Object.values(ids) } } }) });

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  ids.a = (await db.restaurant.create({ data: { slug: slugA, name: `F6 A ${nonce}`, pickupAddress: 'Pickup 1', pickupPhone: '+998900000001', defaultPrepMinutes: 35 } })).id;
  ids.b = (await db.restaurant.create({ data: { slug: slugB, name: `F6 B ${nonce}`, pickupAddress: 'Pickup 2' } })).id;
  await setRestaurantPassword({ slug: slugA, password: PW_A });
  await setRestaurantPassword({ slug: slugB, password: PW_B });
  taxiId = (await db.taxiCompany.create({ data: { name: `F6 Taxi ${randomUUID()}`, operatorTelegramUserId: operatorTg, isActive: true } })).id;
  for (const test of [false, true]) {
    for (;;) {
      const c = String(randomInt(1000, 9999));
      if (cardsLast4.includes(c) || await db.card.findUnique({ where: { last4: c } })) continue;
      cardsLast4.push(c); await engine.addCard(c, test, ids.a!);
      if (test) mockLast4 = c; else realLast4 = c;
      break;
    }
  }
  ta = await loginToken(slugA, PW_A);
  tb = await loginToken(slugB, PW_B);
});
after(async () => {
  const rids = Object.values(ids);
  const orders = (await db.order.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(o => o.id);
  await db.notificationLog.deleteMany({ where: { orderId: { in: orders } } });
  await db.refundRequest.deleteMany({ where: { orderId: { in: orders } } });
  const pays = await db.payment.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } });
  await db.incomingTransaction.deleteMany({ where: { OR: [{ matchedPaymentId: { in: pays.map(p => p.id) } }, { cardLast4: { in: cardsLast4 } }] } });
  await db.restaurantLoginAttempt.deleteMany({ where: { keyHash: { in: [slugA, slugB].map(s => attemptKey('slug', s)).concat(ips.map(i => attemptKey('ip', i))) } } });
  await db.taxiDispatch.deleteMany({ where: { orderId: { in: orders } } });
  await db.payment.deleteMany({ where: { id: { in: pays.map(p => p.id) } } });
  const cards = await db.card.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } });
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards.map(c => c.id) } } });
  await db.card.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.order.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.customer.deleteMany({ where: { telegramUserId: customerTg } });
  await db.product.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.restaurant.deleteMany({ where: { id: { in: rids } } });
  await db.taxiCompany.deleteMany({ where: { id: taxiId } });
  await app.close();
  await db.$disconnect();
  await appDb.$disconnect();
});

// ------------------------------------------------------------------------------------------------ creation
test('automatic creation: validated order starts as PAYMENT_PENDING with exactly one payment attempt - not paid, not waiting for anyone', async () => {
  for (const mode of ['MOCK', 'REAL'] as const) {
    const { o, p } = await order(mode);
    const r = await row(o.id);
    assert.equal(r.status, 'PAYMENT_PENDING', mode);
    assert.equal(r.restaurantDeadlineAt, null, 'no restaurant response window');
    assert.equal(r.paymentVerifiedAt, null);
    assert.equal(r.estimatedPrepMinutes, 35, 'the restaurant default is what the customer is told');
    assert.equal(r.paymentIsTest, mode === 'MOCK');
    const pays = await db.payment.findMany({ where: { orderId: o.id }, include: { card: true } });
    assert.equal(pays.length, 1);
    assert.equal(pays[0]!.status, 'AWAITING');
    assert.equal(pays[0]!.isTest, mode === 'MOCK');
    assert.equal(pays[0]!.card!.isTest, mode === 'MOCK', 'MOCK and REAL never share a card');
    assert.equal(pays[0]!.amountTiyin, BigInt(p.priceSom * 2) * 100n);
    assert.ok(!(await events(o.id)).includes('ACCEPT'), 'no acceptance step');
  }
  // idempotent: the same checkoutKey returns the first order and creates nothing
  const key = randomUUID();
  const first = (await order('MOCK', { checkoutKey: key })).o;
  const before = await counts();
  const again = await placeOrder(engine, { restaurantId: ids.a!, telegramUserId: customerTg, phone: '+998901234567', addressText: 'Test manzil', taxiCompanyId: taxiId,
    checkoutKey: key, createdViaBot: true, paymentMode: 'MOCK', items: [{ productId: (await db.orderItem.findFirstOrThrow({ where: { orderId: first.id } })).productId!, quantity: 2 }] });
  assert.equal(again!.id, first.id);
  assert.deepEqual(await counts(), before);
});

test('checkout validation: closed restaurant, unavailable/foreign products and changed prices refuse the order and create nothing', async () => {
  const p = await product();
  const base = { restaurantId: ids.a!, telegramUserId: customerTg, phone: '+998901234567', addressText: 'Test manzil', taxiCompanyId: taxiId, createdViaBot: true, paymentMode: 'MOCK' as const };
  const before = await counts();
  const refuse = (extra: Record<string, unknown>, code: string) => assert.rejects(
    placeOrder(engine, { ...base, checkoutKey: randomUUID(), items: [{ productId: p.id, quantity: 1 }], ...extra } as never),
    (e: Error) => e.message === code);
  // price/total the customer saw is no longer current
  await refuse({ expectedTotalSom: p.priceSom - 1 }, 'NARX_OZGARGAN');
  await refuse({ expectedUnitPrices: { [p.id]: p.priceSom + 500 } }, 'NARX_OZGARGAN');
  // unavailable product
  const off = await product({ available: false });
  await refuse({ items: [{ productId: off.id, quantity: 1 }] }, 'MAHSULOT_MAVJUD_EMAS');
  // another restaurant's product
  const foreign = await product({ restaurant: ids.b! });
  await refuse({ items: [{ productId: foreign.id, quantity: 1 }] }, 'MAHSULOT_MAVJUD_EMAS');
  // the refusal carries what the client needs to re-confirm
  const err = await placeOrder(engine, { ...base, checkoutKey: randomUUID(), items: [{ productId: p.id, quantity: 3 }], expectedTotalSom: 1 }).catch(e => e) as CheckoutError;
  assert.equal(err.statusCode, 409);
  assert.equal((err.details as { currentTotalSom: number }).currentTotalSom, p.priceSom * 3);
  // paused restaurant
  await db.restaurant.update({ where: { id: ids.a! }, data: { isPaused: true } });
  try { await refuse({}, 'RESTORAN_BUYURTMA_QABUL_QILMAYDI'); } finally { await db.restaurant.update({ where: { id: ids.a! }, data: { isPaused: false } }); }
  assert.deepEqual(await counts(), before, 'no order and no payment attempt was created by any refusal');
  // exact expectations succeed
  const ok = await placeOrder(engine, { ...base, checkoutKey: randomUUID(), items: [{ productId: p.id, quantity: 2 }],
    expectedTotalSom: p.priceSom * 2, expectedUnitPrices: { [p.id]: p.priceSom } });
  assert.equal(ok!.totalSom, p.priceSom * 2);
});

test('REAL order needs a pickup address (taxi dispatch would otherwise fail later)', async () => {
  await db.restaurant.update({ where: { id: ids.a! }, data: { pickupAddress: null } });
  try {
    await assert.rejects(order('REAL'), (e: Error) => e.message === 'RESTORAN_OLIB_KETISH_MANZILI_YOQ');
    assert.ok((await order('MOCK')).o.id, 'MOCK stays possible');
  } finally { await db.restaurant.update({ where: { id: ids.a! }, data: { pickupAddress: 'Pickup 1' } }); }
});

test('prices are frozen: later menu changes never touch an existing order, its lines or its payment amount', async () => {
  const { o, p } = await order('MOCK');
  const pay = await db.payment.findFirstOrThrow({ where: { orderId: o.id } });
  await db.product.update({ where: { id: p.id }, data: { priceSom: p.priceSom + 5_000 } });
  await db.product.update({ where: { id: p.id }, data: { isAvailable: false } });
  const line = await db.orderItem.findFirstOrThrow({ where: { orderId: o.id } });
  assert.equal(line.unitSom, p.priceSom);
  assert.equal(line.subtotalSom, p.priceSom * 2);
  assert.equal((await row(o.id)).totalSom, p.priceSom * 2);
  assert.equal((await db.payment.findUniqueOrThrow({ where: { id: pay.id } })).amountTiyin, BigInt(p.priceSom * 2) * 100n);
  const detail = (await call('GET', `/orders/${o.id}`, ta)).json();
  assert.equal(detail.totalSom, p.priceSom * 2);
  assert.equal(detail.priceChange, null, 'only legacy waiting orders ever show a price drift');
});

// ------------------------------------------------------------------------------------------------ payment pending vs verified
test('unpaid orders are not "new" for the kitchen and are never cooked; the MOCK sweep ignores them', async () => {
  const { o } = await order('MOCK');
  await autoAdvanceMockOrders();
  assert.equal((await row(o.id)).status, 'PAYMENT_PENDING');
  const toCook = (await call('GET', '/orders?filter=toCook&limit=50', ta)).json();
  assert.ok(!toCook.orders.some((x: { id: string }) => x.id === o.id));
  const incoming = (await call('GET', '/orders?filter=incoming&limit=50', ta)).json();
  assert.ok(!incoming.orders.some((x: { id: string }) => x.id === o.id));
  assert.deepEqual((await call('GET', `/orders/${o.id}`, ta)).json().allowedActions, [], 'nothing to press on an unpaid order');
  assert.equal((await call('POST', `/orders/${o.id}/preparing`, ta, {})).statusCode, 409);
  assert.equal((await call('POST', `/orders/${o.id}/ready`, ta, {})).statusCode, 409);
});

test('MOCK: a safe test payment moves on to cooking by itself with the default preparation time; taxi is scheduled once; READY stays manual', async () => {
  const { o } = await order('MOCK');
  await engine.ingestMock(BigInt(o.totalSom) * 100n, mockLast4);
  assert.equal((await row(o.id)).status, 'PAYMENT_MATCHED_UNVERIFIED');
  const ids1 = await Promise.all([autoAdvanceMockOrders(), autoAdvanceMockOrders(), autoAdvanceMockOrders()]);
  void ids1;
  const r = await row(o.id);
  assert.equal(r.status, 'PREPARING');
  assert.equal(r.prepMinutes, 35, 'defaultPrepMinutes, no question asked');
  assert.ok(r.preparingStartedAt);
  assert.equal(r.readyAt, null, 'never auto-READY');
  assert.deepEqual((await events(o.id)).filter(a => a === 'VERIFY_PAYMENT' || a === 'START_PREPARING'), ['VERIFY_PAYMENT', 'START_PREPARING']);
  const d = await db.taxiDispatch.findMany({ where: { orderId: o.id } });
  assert.equal(d.length, 1);
  assert.equal(d[0]!.status, 'SCHEDULED');
  assert.equal(d[0]!.taxiCompanyId, taxiId);
  const view = (await call('GET', `/orders/${o.id}`, ta)).json();
  assert.deepEqual(view.allowedActions.filter((a: string) => a !== 'CANCEL_ORDER'), ['MARK_READY']);
  const toCook = (await call('GET', '/orders?filter=toCook&limit=50', ta)).json();
  assert.ok(toCook.orders.some((x: { id: string }) => x.id === o.id), 'it is announced to the kitchen');
});

test('REAL: a Gmail match never verifies; only the restaurant\'s explicit verification does, then cooking starts by itself', async () => {
  const { o } = await order('REAL');
  const m = await gmailMatch(o.id);
  assert.equal(m.status, 'MATCHED_UNVERIFIED');
  assert.equal((await row(o.id)).status, 'PAYMENT_MATCHED_UNVERIFIED');
  await autoAdvanceMockOrders();
  await autoAdvanceMockOrders();
  assert.equal((await row(o.id)).status, 'PAYMENT_MATCHED_UNVERIFIED', 'no automation touches real money');
  await assert.rejects(takeStaffAction({ actorSystemId: 'mock-auto', orderId: o.id, action: 'VERIFY_PAYMENT' }), /RUXSAT_YOQ/);
  assert.equal((await call('POST', `/orders/${o.id}/verify-payment`, ta, {})).statusCode, 400, 'explicit confirmation required');
  assert.equal((await call('POST', `/orders/${o.id}/verify-payment`, tb, { confirmReceived: true })).statusCode, 404, 'another restaurant cannot verify');
  assert.equal((await row(o.id)).status, 'PAYMENT_MATCHED_UNVERIFIED');
  const rs = await Promise.all([1, 2].map(() => call('POST', `/orders/${o.id}/verify-payment`, ta, { confirmReceived: true })));
  assert.equal(rs.filter(r => r.statusCode === 200).length, 1);
  const r = await row(o.id);
  assert.equal(r.status, 'PREPARING');
  assert.equal(r.prepMinutes, 35);
  assert.equal(r.paymentVerifiedBy, `restaurant-api:${ids.a}`);
  assert.equal(await db.taxiDispatch.count({ where: { orderId: o.id } }), 1);
});

// ------------------------------------------------------------------------------------------------ cancellation
test('cancellation: unpaid needs no refund; paid keeps truthful manual refund tracking; the customer is never asked for bank data', async () => {
  const unpaid = (await order('MOCK')).o;
  const c = await cancelUnpaidOrder(engine, { telegramUserId: customerTg, orderId: unpaid.id });
  assert.equal(c.result, 'CANCELLED');
  assert.equal((await row(unpaid.id)).status, 'CANCELLED');
  assert.equal(await db.refundRequest.count({ where: { orderId: unpaid.id } }), 0, 'nothing was paid, nothing to refund');
  assert.notEqual((await db.payment.findFirstOrThrow({ where: { orderId: unpaid.id } })).status, 'AWAITING');
  assert.equal((await cancelUnpaidOrder(engine, { telegramUserId: customerTg, orderId: unpaid.id })).result !== 'CANCELLED', true, 'repeat is harmless');

  const paid = (await order('REAL')).o;
  await gmailMatch(paid.id);
  // the customer supplies only a reason code
  const req = await requestCancellation({ actorType: 'CUSTOMER', actorTelegramId: customerTg, orderId: paid.id, reasonCode: 'CHANGED_MIND' });
  assert.equal(req.result, 'REQUESTED');
  const refund = await db.refundRequest.findFirstOrThrow({ where: { orderId: paid.id } });
  assert.equal(refund.status, 'REQUESTED');
  assert.equal(refund.bankReference, null);
  assert.equal(refund.sentAt, null, 'nothing is marked as sent by asking');
  assert.equal((await row(paid.id)).status, 'CANCELLATION_REQUESTED');
  // the restaurant approves; still not "sent" - money moves only when the restaurant says so, with its own proof
  assert.equal((await call('POST', `/orders/${paid.id}/refund/approve`, ta, {})).statusCode, 200);
  const approved = await db.refundRequest.findUniqueOrThrow({ where: { id: refund.id } });
  assert.equal(approved.status, 'APPROVED');
  assert.equal(approved.sentAt, null);
  assert.equal((await call('GET', `/orders/${paid.id}`, ta)).json().refund.status, 'APPROVED');
  await assert.rejects(markRefundSent({ actorTelegramId: 'x', restaurantId: ids.a!, refundId: refund.id, bankReference: '' }), /BANK_REFERENCE_NOTOGRI/);
  assert.equal((await call('POST', `/orders/${paid.id}/refund/sent`, tb, { bankReference: 'TRX-1111-2222' })).statusCode, 404);
  assert.equal((await call('POST', `/orders/${paid.id}/refund/sent`, ta, { bankReference: 'TRX-1111-2222' })).json().refund.status, 'SENT');
  // the customer contract has no bank fields at all
  assert.equal(customerCancelRequestSchema.safeParse({ reasonCode: 'CHANGED_MIND' }).success, true);
  assert.equal(customerCancelRequestSchema.safeParse({}).success, true);
  for (const extra of [{ bankReference: 'TRX-1' }, { cardNumber: '8600123412341234' }, { bankAccount: '2020' }]) {
    assert.equal(customerCancelRequestSchema.safeParse(extra).success, false, JSON.stringify(extra));
  }
});

// ------------------------------------------------------------------------------------------------ countdown, overdue, READY
test('server-time countdown: estimated ready time, remaining seconds and overdue minutes; READY is never automatic', async () => {
  const start = new Date('2026-10-18T10:00:00Z');
  const base = { status: 'PREPARING' as const, preparingStartedAt: start, prepMinutes: 25, estimatedPrepMinutes: 25, readyAt: null, restaurant: { defaultPrepMinutes: 35 } };
  const early = prepClock(base, new Date('2026-10-18T10:10:30Z'));
  assert.equal(early.estimatedReadyAt, '2026-10-18T10:25:00.000Z');
  assert.equal(early.remainingSeconds, 14 * 60 + 30);
  assert.equal(early.isOverdue, false);
  assert.equal(early.overdueMinutes, 0);
  const late = prepClock(base, new Date('2026-10-18T10:40:10Z'));
  assert.equal(late.isOverdue, true);
  assert.equal(late.overdueMinutes, 15);
  assert.equal(prepClock({ ...base, status: 'READY' as never, readyAt: new Date() }, new Date()).remainingSeconds, null, 'no countdown once READY');
  assert.equal(prepClock({ ...base, status: 'PAYMENT_PENDING' as never, preparingStartedAt: null }, new Date()).estimatedReadyAt, null);

  // end to end: an overdue order reports the overdue time from the SERVER clock and still is not READY
  const { o } = await order('MOCK');
  await engine.ingestMock(BigInt(o.totalSom) * 100n, mockLast4);
  await autoAdvanceMockOrders();
  await db.order.update({ where: { id: o.id }, data: { preparingStartedAt: new Date(Date.now() - 50 * 60_000) } });
  await autoAdvanceMockOrders();
  const v = (await call('GET', `/orders/${o.id}`, ta)).json();
  assert.equal(v.status, 'PREPARING', 'overdue never marks READY');
  assert.equal(v.prep.isOverdue, true);
  assert.ok(v.prep.overdueMinutes >= 14 && v.prep.overdueMinutes <= 16, `overdue ${v.prep.overdueMinutes}`);
  assert.ok(Math.abs(new Date(v.serverNow).getTime() - Date.now()) < 5_000);
  assert.equal(v.prep.estimatedReadyAt, new Date(new Date(v.prep.startedAt).getTime() + 35 * 60_000).toISOString());
});

test('READY: tap-safe - concurrent and repeated requests succeed, record one event and never move the order twice', async () => {
  const { o } = await order('MOCK');
  await engine.ingestMock(BigInt(o.totalSom) * 100n, mockLast4);
  await autoAdvanceMockOrders();
  assert.equal((await call('POST', `/orders/${o.id}/ready`, tb, {})).statusCode, 404, 'tenant isolated');
  const rs = await Promise.all(Array.from({ length: 6 }, () => call('POST', `/orders/${o.id}/ready`, ta, {})));
  assert.ok(rs.every(r => r.statusCode === 200));
  assert.ok(rs.every(r => r.json().status === 'READY'));
  assert.equal((await events(o.id)).filter(a => a === 'MARK_READY').length, 1);
  const readyAt = (await row(o.id)).readyAt;
  assert.ok(readyAt);
  assert.equal((await call('POST', `/orders/${o.id}/ready`, ta, {})).statusCode, 200);
  assert.deepEqual((await row(o.id)).readyAt, readyAt, 'the original READY time is kept');
  assert.equal((await call('POST', `/orders/${o.id}/ready`, ta, { expectedStatus: 'PREPARING' })).statusCode, 409, 'a stale screen is still told');
});

// ------------------------------------------------------------------------------------------------ tenant isolation & contract
test('tenant isolation on the new surfaces', async () => {
  const { o } = await order('REAL');
  await gmailMatch(o.id);
  for (const [m, u, body] of [['GET', `/orders/${o.id}`], ['POST', `/orders/${o.id}/verify-payment`, { confirmReceived: true }], ['POST', `/orders/${o.id}/preparing`, {}],
    ['POST', `/orders/${o.id}/ready`, {}], ['POST', `/orders/${o.id}/cancel`, { reason: 'CLOSED' }]] as const) {
    assert.equal((await call(m, u, tb, body)).statusCode, 404, `${m} ${u}`);
  }
  const listB = (await call('GET', '/orders?filter=all&limit=50', tb)).json();
  assert.ok(!listB.orders.some((x: { id: string }) => x.id === o.id));
  assert.equal((await row(o.id)).status, 'PAYMENT_MATCHED_UNVERIFIED');
});

test('Mini App contract: strict schemas, identity only from the caller, quote = same validation as order creation', async () => {
  const p = await product({ price: 12_000 });
  const good = { checkoutKey: randomUUID(), restaurantId: ids.a!, items: [{ productId: p.id, quantity: 2 }], expectedTotalSom: 24_000, address: { addressText: 'Manzil 1' }, phone: '+998901234567' };
  assert.equal(checkoutRequestSchema.safeParse(good).success, true);
  assert.equal(checkoutRequestSchema.safeParse({ ...good, address: undefined, addressId: 'saved1' }).success, true);
  for (const bad of [{ telegramUserId: '1' }, { customerId: 'x' }, { paymentMode: 'MOCK' }, { totalSom: 1 }, { cardNumber: '8600' }, { taxiCompanyId: 'x' }, { checkoutKey: 'not-a-uuid' }, { expectedTotalSom: undefined }, { phone: '901234567' },
    { addressId: 'both' }, { address: undefined }]) {
    assert.equal(checkoutRequestSchema.safeParse({ ...good, ...bad }).success, false, JSON.stringify(bad));
  }
  assert.equal(quoteRequestSchema.safeParse({ restaurantId: ids.a!, items: good.items, telegramUserId: '1' }).success, false);
  const q = await quoteCheckout({ restaurantId: ids.a!, items: good.items });
  assert.ok(q.ok);
  if (q.ok) { assert.equal(q.totalSom, 24_000); assert.equal(q.estimatedPrepMinutes, 35); }
  const off = await product({ available: false });
  const bad = await quoteCheckout({ restaurantId: ids.a!, items: [{ productId: off.id, quantity: 1 }] });
  assert.ok(!bad.ok && bad.issues.some(i => i.kind === 'PRODUCT_UNAVAILABLE'));
  const before = await counts();
  const input = toPlaceOrderInput(customerTg, 'Mini', { phone: '+998901234567', addressText: 'Manzil 1' }, checkoutRequestSchema.parse(good), 'MOCK');
  assert.equal(input.telegramUserId, customerTg);
  assert.equal(input.autoTaxi, true);
  const placed = await placeOrder(engine, input);
  assert.equal(placed!.totalSom, 24_000);
  assert.equal((await counts()).orders, before.orders + 1);
  const stale = await placeOrder(engine, toPlaceOrderInput(customerTg, 'Mini', { phone: '+998901234567', addressText: 'Manzil 1' }, checkoutRequestSchema.parse({ ...good, checkoutKey: randomUUID(), expectedTotalSom: 20_000 }), 'MOCK')).catch(e => e);
  assert.ok(stale instanceof CheckoutError && stale.message === 'NARX_OZGARGAN');
});
