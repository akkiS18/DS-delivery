import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { placeOrder } from '../modules/orders/service.js';
import { checkoutRequestSchema, quoteCheckout, toPlaceOrderInput } from '../modules/orders/contract.js';
import { performOrderAction } from '../modules/restaurant-orders/service.js';
import { autoConfirmRealOrders } from '../modules/restaurant-orders/auto.js';
import { PICKUP_ADDRESS_LABEL, PICKUP_OPEN_KEY, completePickup } from '../modules/orders/pickup.js';
import { customerOrderView, loadCustomerOrder } from '../modules/miniapp/views.js';
import { setCustomerPickup } from '../modules/restaurant-operations/service.js';

// "O‘zim olib ketaman" (owner request 2026-11-22): the customer collects the order. No taxi ever, the restaurant completes it with "Mijozga berildi",
// both switches (platform rollout + restaurant) gate new checkouts. ds_delivery_test only; rows are deleted by id in after(); the platform switch is
// put back to what it was.
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
let switchBefore: string | null = null;

const setOpen = async (open: boolean) => {
  await db.platformSetting.upsert({ where: { key: PICKUP_OPEN_KEY }, create: { key: PICKUP_OPEN_KEY, value: String(open), updatedBy: 'test' }, update: { value: String(open) } });
};
const product = (priceSom = randomInt(10_000, 400_000)) =>
  db.product.create({ data: { restaurantId, name: `P${randomUUID().slice(0, 6)}`, priceSom, isAvailable: true } });
const pickupInput = (productId: string, extra: Record<string, unknown> = {}) => ({
  restaurantId, telegramUserId: customerTg, customerName: 'T', phone: '+998901234567', checkoutKey: randomUUID(), createdViaBot: true,
  paymentMode: 'REAL' as const, items: [{ productId, quantity: 1 }], deliveryPreference: 'PICKUP' as const, ...extra,
});
const order = (id: string) => db.order.findUniqueOrThrow({ where: { id } });
const dispatches = (id: string) => db.taxiDispatch.findMany({ where: { orderId: id } });
const customerView = async (id: string) => customerOrderView((await loadCustomerOrder(customerTg, id))!);

/** A pickup card order, paid and cooking. */
async function paidPickup() {
  await db.payment.updateMany({ where: { restaurantId, status: { in: ['AWAITING', 'QUEUED'] } }, data: { status: 'CANCELLED' } });
  const p = await product();
  const o = await placeOrder(engine, pickupInput(p.id));
  const pay = await db.payment.findFirstOrThrow({ where: { orderId: o!.id } });
  const m = await engine.ingestGmail(`pk-${randomUUID()}`, { cardLast4: last4, amountTiyin: pay.amountTiyin, occurredAt: new Date(), emailReceivedAt: new Date(Date.now() + 1000), minutePrecision: true, trustedSender: true });
  assert.equal(m.status, 'MATCHED_UNVERIFIED', String(m.reason));
  assert.ok((await autoConfirmRealOrders(100)).confirmed.includes(o!.id));
  assert.equal((await order(o!.id)).status, 'PREPARING');
  return o!.id;
}

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  switchBefore = (await db.platformSetting.findUnique({ where: { key: PICKUP_OPEN_KEY } }))?.value ?? null;
  restaurantId = (await db.restaurant.create({ data: { slug: `pk-${nonce}`, name: `PK ${nonce}`, pickupAddress: 'Chilonzor 5' } })).id;
  otherRestaurantId = (await db.restaurant.create({ data: { slug: `pk2-${nonce}`, name: `PK2 ${nonce}`, pickupAddress: 'P' } })).id;
  taxiId = (await db.taxiCompany.create({ data: { name: `PK Taxi ${randomUUID()}`, operatorTelegramUserId: operatorTg, isActive: true } })).id;
  for (;;) { last4 = String(randomInt(1000, 10000)); if (!(await db.card.findUnique({ where: { last4 } }))) break; }
  await db.card.create({ data: { restaurantId, last4, isTest: false } });
  await setOpen(true);
});

after(async () => {
  if (switchBefore === null) await db.platformSetting.deleteMany({ where: { key: PICKUP_OPEN_KEY } });
  else await db.platformSetting.update({ where: { key: PICKUP_OPEN_KEY }, data: { value: switchBefore } });
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
  await db.refundEvent.deleteMany({ where: { refund: { orderId: { in: orders } } } });
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

test('the checkout contract: pickup sends no address and no taxi; delivery still needs exactly one address', () => {
  const base = { checkoutKey: randomUUID(), restaurantId: 'r1', items: [{ productId: 'p1', quantity: 1 }], expectedTotalSom: 1000 };
  assert.equal(checkoutRequestSchema.safeParse({ ...base, deliveryPreference: 'PICKUP' }).success, true);
  assert.equal(checkoutRequestSchema.safeParse({ ...base, deliveryPreference: 'PICKUP', address: { addressText: 'Manzil bor' } }).success, false);
  assert.equal(checkoutRequestSchema.safeParse({ ...base, deliveryPreference: 'PICKUP', taxiCompanyId: 't1' }).success, false);
  assert.equal(checkoutRequestSchema.safeParse(base).success, false, 'a delivery without an address');
  assert.equal(checkoutRequestSchema.safeParse({ ...base, address: { addressText: 'Manzil bor' } }).success, true, 'older apps unchanged');
  const input = toPlaceOrderInput('1', undefined, { phone: '+998901234567' }, { ...base, deliveryPreference: 'PICKUP' }, 'REAL');
  assert.equal(input.deliveryPreference, 'PICKUP');
  assert.equal(input.autoTaxi, undefined, 'no automatic taxi for a pickup');
  assert.equal(input.addressText, undefined);
});

test('both switches gate a new pickup checkout; the quote says whether it is offered and where', async () => {
  const p = await product();
  await setOpen(false);
  const closed = await quoteCheckout({ restaurantId, items: [{ productId: p.id, quantity: 1 }] });
  assert.deepEqual(closed.ok && [closed.pickupAvailable, closed.pickupAddress], [false, 'Chilonzor 5']);
  await assert.rejects(() => placeOrder(engine, pickupInput(p.id)), /OLIB_KETISH_MAVJUD_EMAS/);
  await setOpen(true);
  await setCustomerPickup(restaurantId, false);
  await assert.rejects(() => placeOrder(engine, pickupInput(p.id)), /OLIB_KETISH_MAVJUD_EMAS/);
  const off = await quoteCheckout({ restaurantId, items: [{ productId: p.id, quantity: 1 }] });
  assert.equal(off.ok && off.pickupAvailable, false);
  await setCustomerPickup(restaurantId, true);
  const on = await quoteCheckout({ restaurantId, items: [{ productId: p.id, quantity: 1 }] });
  assert.equal(on.ok && on.pickupAvailable, true);
  assert.equal(await db.order.count({ where: { restaurantId } }), 0, 'refused checkouts created nothing');
  await assert.rejects(() => placeOrder(engine, pickupInput(p.id, { taxiCompanyId: taxiId })), /taksi/i);
});

test('a pickup order is PICKUP from checkout, never books a taxi, and the restaurant completes it once with the commission accrued once', async () => {
  const id = await paidPickup();
  const o = await order(id);
  assert.deepEqual([o.deliveryPreference, o.deliveryMode, o.addressText, o.taxiCompanyId, o.allowTaxiFallback], ['PICKUP', 'PICKUP', PICKUP_ADDRESS_LABEL, null, false]);
  assert.equal((await dispatches(id)).length, 0, 'nothing booked while cooking');
  assert.equal((await customerView(id)).stage, 'PREPARING');

  const r = await performOrderAction(engine, restaurantId, id, 'MARK_READY', { delivery: 'TAXI' }); // a TAXI choice is ignored for a pickup
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && [r.order.status, r.order.delivery.mode, r.order.allowedActions], ['READY', 'PICKUP', ['PICKED_UP']]);
  assert.equal((await dispatches(id)).length, 0, 'no taxi at "Tayyor" either');
  const ev = await db.orderEvent.findFirstOrThrow({ where: { orderId: id, action: 'MARK_READY' } });
  assert.equal((ev.details as { delivery: string }).delivery, 'PICKUP');
  const v = await customerView(id);
  assert.deepEqual([v.stage, v.deliveryMode, v.deliveryPreference, v.pickupAddress, v.canConfirmReceived], ['PICKUP_READY', 'PICKUP', 'PICKUP', 'Chilonzor 5', false]);

  assert.equal(await completePickup({ restaurantId: otherRestaurantId, orderId: id, actorLabel: 'x' }), 'NOT_FOUND', 'a stranger sees nothing');
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => performOrderAction(engine, restaurantId, id, 'PICKED_UP', {})));
  assert.ok(results.every(x => x.ok || x.httpStatus === 409), JSON.stringify(results.map(x => x.ok)));
  const done = await order(id);
  assert.equal(done.status, 'COMPLETED');
  assert.ok(done.pickedUpAt);
  assert.equal(await db.orderEvent.count({ where: { orderId: id, action: 'PICKUP_HANDED_OVER' } }), 1);
  assert.equal(await db.commissionEntry.count({ where: { orderId: id } }), 1);
  assert.equal(await completePickup({ restaurantId, orderId: id, actorLabel: 'x' }), 'ALREADY');
  const after = await customerView(id);
  assert.deepEqual([after.stage, after.deliveredAt, after.canConfirmReceived], ['DELIVERED', done.pickedUpAt!.toISOString(), false]);
});

test('"Mijozga berildi" only for a READY pickup with cleared money and no open refund; never for a delivery order', async () => {
  const cooking = await paidPickup();
  assert.equal(await completePickup({ restaurantId, orderId: cooking, actorLabel: 'x' }), 'STALE', 'not ready yet');
  const early = await performOrderAction(engine, restaurantId, cooking, 'PICKED_UP', {});
  assert.deepEqual([early.ok, !early.ok && early.error], [false, 'INVALID_STATE']);

  assert.equal((await performOrderAction(engine, restaurantId, cooking, 'MARK_READY', {})).ok, true);
  const pay = await db.payment.findFirstOrThrow({ where: { orderId: cooking } });
  const refund = await db.refundRequest.create({ data: { orderId: cooking, paymentId: pay.id, kind: 'CUSTOMER_CANCEL', status: 'REQUESTED', reasonCode: 'POLICY', requestedBy: 'test', requestedByType: 'CUSTOMER', paidAmountTiyin: pay.amountTiyin, orderStatusBefore: 'READY', paymentStatusAtRequest: pay.status } });
  await assert.rejects(() => completePickup({ restaurantId, orderId: cooking, actorLabel: 'x' }), /QAYTARISH_JARAYONIDA/);
  assert.equal((await order(cooking)).status, 'READY');
  await db.refundRequest.delete({ where: { id: refund.id } });

  // a delivery order cannot be "handed over" (and SELF is still refused for anything that is not WALK_OK)
  await db.payment.updateMany({ where: { restaurantId, status: { in: ['AWAITING', 'QUEUED'] } }, data: { status: 'CANCELLED' } });
  const p = await product();
  const taxiOrder = await placeOrder(engine, { ...pickupInput(p.id), deliveryPreference: 'TAXI', addressText: 'Manzil', taxiCompanyId: taxiId });
  assert.equal(await completePickup({ restaurantId, orderId: taxiOrder!.id, actorLabel: 'x' }), 'STALE');
});

test('cash pickup: the restaurant accepts, the customer pays at the counter, the order completes at "Mijozga berildi"', async () => {
  const p = await product(50_000);
  const o = await placeOrder(engine, pickupInput(p.id, { paymentMethod: 'CASH' }));
  assert.equal((await db.payment.findFirstOrThrow({ where: { orderId: o!.id } })).status, 'CASH_PENDING');
  const accepted = await performOrderAction(engine, restaurantId, o!.id, 'ACCEPT', {});
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal((await order(o!.id)).status, 'PREPARING');
  assert.equal((await performOrderAction(engine, restaurantId, o!.id, 'MARK_READY', {})).ok, true);
  assert.equal((await dispatches(o!.id)).length, 0);
  const handed = await performOrderAction(engine, restaurantId, o!.id, 'PICKED_UP', {});
  assert.equal(handed.ok, true, JSON.stringify(handed));
  assert.equal((await order(o!.id)).status, 'COMPLETED');
});

test('the database refuses the contradictions: a taxi for a pickup, a pickup mode without the wish (and back), a hand-over time on a delivery', async () => {
  const id = await paidPickup();
  await assert.rejects(() => db.taxiDispatch.create({ data: { orderId: id, taxiCompanyId: taxiId, attemptNo: 1, dueAt: new Date(), status: 'SCHEDULED' } }), /pickup|check/i);
  await assert.rejects(() => db.order.update({ where: { id }, data: { deliveryMode: 'TAXI' } }), /Order_pickup_consistent|check/i);
  await assert.rejects(() => db.order.update({ where: { id }, data: { deliveryMode: 'SELF' } }), /check/i);
  assert.equal((await dispatches(id)).length, 0);

  await db.payment.updateMany({ where: { restaurantId, status: { in: ['AWAITING', 'QUEUED'] } }, data: { status: 'CANCELLED' } });
  const p = await product();
  const taxiOrder = (await placeOrder(engine, { ...pickupInput(p.id), deliveryPreference: 'TAXI', addressText: 'Manzil', taxiCompanyId: taxiId }))!.id;
  await assert.rejects(() => db.order.update({ where: { id: taxiOrder }, data: { deliveryMode: 'PICKUP' } }), /Order_pickup_consistent|check/i);
  await assert.rejects(() => db.order.update({ where: { id: taxiOrder }, data: { pickedUpAt: new Date() } }), /Order_picked_up_only_pickup|check/i);
});

test('refunds (owner decision 2026-11-22): the restaurant only cancels/agrees, the administrator sends; own-card money shows as owed by the restaurant', async () => {
  const { adminMarkRefundSent } = await import('../modules/refunds/service.js');
  const { financeOverview } = await import('../modules/restaurant-finance/overview.js');
  const adminId = String(randomInt(100000001, 999999999));
  const envBefore = process.env.SUPPORT_ADMIN_1_TELEGRAM_ID;
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = adminId;
  try {
    const id = await paidPickup();
    const cancelled = await performOrderAction(engine, restaurantId, id, 'CANCEL_ORDER', { reason: 'OUT_OF_STOCK' });
    assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
    assert.deepEqual(cancelled.ok && [cancelled.order.refund?.status, cancelled.order.allowedActions, cancelled.order.attention], ['APPROVED', [], []]);
    const byRestaurant = await performOrderAction(engine, restaurantId, id, 'REFUND_SENT', {});
    assert.deepEqual([byRestaurant.ok, !byRestaurant.ok && byRestaurant.error], [false, 'REFUND_BY_PLATFORM']);
    const refund = await db.refundRequest.findFirstOrThrow({ where: { orderId: id } });
    assert.equal(refund.status, 'APPROVED');
    const before = (await financeOverview(restaurantId)).refundsPaidByPlatform;
    const sent = await adminMarkRefundSent({ adminTelegramId: adminId, refundId: refund.id, bankReference: `PK-${nonce}-1` });
    assert.equal(sent.result, 'DONE');
    const ev = await db.refundEvent.findFirstOrThrow({ where: { refundId: refund.id, action: 'SENT' } });
    assert.deepEqual(ev.details, { bankReference: `PK-${nonce}-1`, byPlatform: false, restaurantHeld: true });
    const owed = (await financeOverview(restaurantId)).refundsPaidByPlatform;
    assert.deepEqual([owed.count - before.count, owed.amountSom - before.amountSom], [1, Number(refund.approvedAmountTiyin! / 100n)]);
  } finally {
    if (envBefore === undefined) delete process.env.SUPPORT_ADMIN_1_TELEGRAM_ID; else process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = envBefore;
  }
});
