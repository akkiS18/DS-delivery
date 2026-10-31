import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { placeOrder } from '../modules/orders/service.js';
import { checkoutRequestSchema } from '../modules/orders/contract.js';
import { performOrderAction } from '../modules/restaurant-orders/service.js';
import { autoConfirmRealOrders } from '../modules/restaurant-orders/auto.js';
import { completeSelfDelivery } from '../modules/orders/self-delivery.js';
import { customerOrderView, loadCustomerOrder } from '../modules/miniapp/views.js';

// Walking / self delivery: the customer's wish (WALK_OK), the restaurant's decision at "Tayyor", no taxi for a self-delivered order, completion by the
// restaurant with the commission accrued once. ds_delivery_test only; rows are deleted by id in after().
delete process.env.GMAIL_AUTO_CONFIRM;
process.env.MAX_OPEN_UNPAID_ORDERS = '0';

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const nonce = randomUUID().slice(0, 8);
const customerTg = String(randomInt(700000000001, 800000000000));
const operatorTg = String(randomInt(900000000001, 990000000000));
let restaurantId = '';
let otherRestaurantId = '';
let taxiId = '';
let last4 = '';

async function paidOrder(deliveryPreference?: 'TAXI' | 'WALK_OK') {
  // one card per restaurant: earlier tests' open payments would queue this one behind them
  await db.payment.updateMany({ where: { restaurantId, status: { in: ['AWAITING', 'QUEUED'] } }, data: { status: 'CANCELLED' } });
  const p = await db.product.create({ data: { restaurantId, name: `P${randomUUID().slice(0, 6)}`, priceSom: randomInt(10_000, 900_000), isAvailable: true } });
  const o = await placeOrder(engine, {
    restaurantId, telegramUserId: customerTg, customerName: 'T', phone: '+998901234567', addressText: 'Manzil', deliveryLat: 41.3, deliveryLng: 69.2,
    taxiCompanyId: taxiId, checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'REAL', items: [{ productId: p.id, quantity: 1 }],
    ...(deliveryPreference ? { deliveryPreference } : {}),
  });
  const pay = await db.payment.findFirstOrThrow({ where: { orderId: o!.id } });
  const m = await engine.ingestGmail(`sd-${randomUUID()}`, { cardLast4: last4, amountTiyin: pay.amountTiyin, occurredAt: new Date(), emailReceivedAt: new Date(Date.now() + 1000), minutePrecision: true, trustedSender: true });
  assert.equal(m.status, 'MATCHED_UNVERIFIED', String(m.reason));
  assert.ok((await autoConfirmRealOrders(100)).confirmed.includes(o!.id));
  assert.equal((await order(o!.id)).status, 'PREPARING');
  return o!.id;
}
const order = (id: string) => db.order.findUniqueOrThrow({ where: { id } });
const dispatches = (id: string) => db.taxiDispatch.findMany({ where: { orderId: id } });
const ready = (id: string, delivery?: 'TAXI' | 'SELF') => performOrderAction(engine, restaurantId, id, 'MARK_READY', delivery ? { delivery } : {});
const customerView = async (id: string) => customerOrderView((await loadCustomerOrder(customerTg, id))!);

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  restaurantId = (await db.restaurant.create({ data: { slug: `sd-${nonce}`, name: `SD ${nonce}`, pickupAddress: 'P', walkingDeliveryEnabled: true } })).id;
  otherRestaurantId = (await db.restaurant.create({ data: { slug: `sd2-${nonce}`, name: `SD2 ${nonce}`, pickupAddress: 'P' } })).id;
  taxiId = (await db.taxiCompany.create({ data: { name: `SD Taxi ${randomUUID()}`, operatorTelegramUserId: operatorTg, isActive: true } })).id;
  for (;;) { last4 = String(randomInt(1000, 10000)); if (!(await db.card.findUnique({ where: { last4 } }))) break; }
  await db.card.create({ data: { restaurantId, last4, isTest: false } });
});

after(async () => {
  const rids = [restaurantId, otherRestaurantId];
  const orders = (await db.order.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(o => o.id);
  const pays = await db.payment.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } });
  const cards = await db.card.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } });
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('ds.ledger_cleanup', 'on', true)`;
    await tx.commissionEvent.deleteMany({ where: { entry: { restaurantId: { in: rids } } } });
    await tx.commissionEntry.deleteMany({ where: { restaurantId: { in: rids } } });
  });
  await db.notificationLog.deleteMany({ where: { orderId: { in: orders } } });
  await db.taxiDispatch.deleteMany({ where: { orderId: { in: orders } } });
  await db.refundRequest.deleteMany({ where: { orderId: { in: orders } } });
  await db.paymentEvent.deleteMany({ where: { paymentId: { in: pays.map(p => p.id) } } });
  await db.payment.deleteMany({ where: { id: { in: pays.map(p => p.id) } } });
  await db.incomingTransaction.deleteMany({ where: { cardLast4: last4 } });
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards.map(c => c.id) } } });
  await db.card.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.order.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.customer.deleteMany({ where: { telegramUserId: customerTg } });
  await db.product.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.restaurant.deleteMany({ where: { id: { in: rids } } });
  await db.taxiCompany.deleteMany({ where: { id: taxiId } });
  await db.$disconnect();
});

test('the checkout wish is stored; it defaults to TAXI and only the two known values are accepted', async () => {
  const taxi = await paidOrder();
  assert.equal((await order(taxi)).deliveryPreference, 'TAXI');
  const walk = await paidOrder('WALK_OK');
  assert.deepEqual([(await order(walk)).deliveryPreference, (await order(walk)).deliveryMode], ['WALK_OK', 'TAXI']);
  const base = { checkoutKey: randomUUID(), restaurantId: 'r1', items: [{ productId: 'p1', quantity: 1 }], expectedTotalSom: 1000, address: { addressText: 'Manzil bor' } };
  assert.equal(checkoutRequestSchema.safeParse({ ...base, deliveryPreference: 'WALK_OK' }).success, true);
  assert.equal(checkoutRequestSchema.safeParse(base).success, true, 'older apps send nothing');
  assert.equal(checkoutRequestSchema.safeParse({ ...base, deliveryPreference: 'SELF' }).success, false, 'SELF is never a customer choice');
});

test('a TAXI order is unchanged: its taxi is parked while cooking and SELF is refused for it', async () => {
  const id = await paidOrder();
  assert.equal((await dispatches(id)).length, 1, 'parked dispatch exists as before');
  const refused = await ready(id, 'SELF');
  assert.deepEqual([refused.ok, refused.ok ? 0 : refused.httpStatus, refused.ok ? '' : refused.error], [false, 400, 'YETKAZISH_USULI_NOTOGRI']);
  assert.equal((await order(id)).status, 'PREPARING');
  assert.equal((await order(id)).deliveryMode, 'TAXI');
  const ok = await ready(id); // no choice: the taxi path as always
  assert.equal(ok.ok, true);
  assert.equal((await order(id)).status, 'READY');
  assert.equal((await dispatches(id)).length, 1);
});

test('a WALK_OK order books no taxi while cooking; "Tayyor" with no choice or with TAXI requests one at once', async () => {
  for (const choice of [undefined, 'TAXI'] as const) {
    const id = await paidOrder('WALK_OK');
    assert.equal((await dispatches(id)).length, 0, 'nothing booked before the restaurant decides');
    assert.equal((await ready(id, choice)).ok, true);
    const o = await order(id);
    assert.deepEqual([o.status, o.deliveryMode], ['READY', 'TAXI']);
    const d = await dispatches(id);
    assert.equal(d.length, 1);
    assert.equal(d[0]!.status, 'SCHEDULED');
    assert.ok(d[0]!.dueAt.getTime() <= Date.now() + 1000, 'due now, not held');
    assert.equal(await db.orderEvent.count({ where: { orderId: id, action: 'MARK_READY' } }), 1);
  }
});

test('self delivery: no taxi, the customer is told, the restaurant completes it once, the commission is accrued once', async () => {
  const id = await paidOrder('WALK_OK');
  const r = await ready(id, 'SELF');
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && [r.order.delivery.preference, r.order.delivery.mode], ['WALK_OK', 'SELF']);
  assert.deepEqual(r.ok && r.order.delivery.location, { lat: 41.3, lng: 69.2 }, 'only a WALK_OK order shares the map point');
  assert.deepEqual(r.ok && r.order.allowedActions, ['SELF_DELIVERED']);
  assert.equal((await dispatches(id)).length, 0);
  const v = await customerView(id);
  assert.equal(v.stage, 'SELF_DELIVERY');
  assert.equal(v.deliveryMode, 'SELF');
  assert.equal(v.canConfirmReceived, false, 'not before the restaurant says it is delivered');

  const results = await Promise.all([1, 2, 3, 4, 5].map(() => performOrderAction(engine, restaurantId, id, 'SELF_DELIVERED', {})));
  assert.ok(results.every(x => x.ok || x.httpStatus === 409), JSON.stringify(results.map(x => x.ok)));
  assert.equal(results.filter(x => x.ok).length >= 1, true);
  const done = await order(id);
  assert.equal(done.status, 'COMPLETED');
  assert.ok(done.selfDeliveredAt);
  assert.equal(await db.orderEvent.count({ where: { orderId: id, action: 'SELF_DELIVERY_CONFIRMED' } }), 1);
  assert.equal(await db.commissionEntry.count({ where: { orderId: id } }), 1, 'a delivered order owes its commission exactly once');
  const after = await customerView(id);
  assert.equal(after.stage, 'DELIVERED');
  assert.equal(after.canConfirmReceived, true);
  assert.equal(after.deliveredAt, done.selfDeliveredAt!.toISOString());
  assert.equal(await completeSelfDelivery({ restaurantId, orderId: id, actorLabel: 'x' }), 'ALREADY');
});

test('self delivery can be completed only by the restaurant that owns the order, only from READY, and not while a refund is open', async () => {
  const id = await paidOrder('WALK_OK');
  assert.equal((await ready(id, 'SELF')).ok, true);
  assert.equal(await completeSelfDelivery({ restaurantId: otherRestaurantId, orderId: id, actorLabel: 'x' }), 'NOT_FOUND', 'a stranger sees nothing');
  assert.equal((await order(id)).status, 'READY');

  const pay = await db.payment.findFirstOrThrow({ where: { orderId: id } });
  const refund = await db.refundRequest.create({ data: { orderId: id, paymentId: pay.id, kind: 'CUSTOMER_CANCEL', status: 'REQUESTED', reasonCode: 'POLICY', requestedBy: 'test', requestedByType: 'CUSTOMER', paidAmountTiyin: pay.amountTiyin, orderStatusBefore: 'READY', paymentStatusAtRequest: pay.status } });
  await assert.rejects(() => completeSelfDelivery({ restaurantId, orderId: id, actorLabel: 'x' }), /QAYTARISH_JARAYONIDA/);
  const blocked = await performOrderAction(engine, restaurantId, id, 'SELF_DELIVERED', {});
  assert.equal(blocked.ok, false);
  assert.equal((await order(id)).status, 'READY');
  await db.refundRequest.delete({ where: { id: refund.id } });

  const notSelf = await paidOrder('WALK_OK');
  assert.equal((await ready(notSelf, 'TAXI')).ok, true);
  assert.equal(await completeSelfDelivery({ restaurantId, orderId: notSelf, actorLabel: 'x' }), 'STALE', 'a taxi order is never completed this way');
  const cooking = await paidOrder('WALK_OK');
  assert.equal(await completeSelfDelivery({ restaurantId, orderId: cooking, actorLabel: 'x' }), 'STALE');
});

test('the database itself refuses the contradictions: SELF without consent, a taxi for a self-delivered order, a delivery time without SELF', async () => {
  const taxiOrder = await paidOrder();
  await assert.rejects(() => db.order.update({ where: { id: taxiOrder }, data: { deliveryMode: 'SELF' } }), /Order_self_needs_consent|check/i);
  await assert.rejects(() => db.order.update({ where: { id: taxiOrder }, data: { selfDeliveredAt: new Date() } }), /Order_self_delivered_only_self|check/i);
  await assert.rejects(() => db.order.update({ where: { id: taxiOrder }, data: { deliveryPreference: 'EVERYTHING' } }), /Order_deliveryPreference_valid|check/i);

  const id = await paidOrder('WALK_OK');
  assert.equal((await ready(id, 'SELF')).ok, true);
  await assert.rejects(() => db.taxiDispatch.create({ data: { orderId: id, taxiCompanyId: taxiId, attemptNo: 1, dueAt: new Date(), status: 'SCHEDULED' } }), /self-delivered|check/i);
  assert.equal((await dispatches(id)).length, 0);
});
