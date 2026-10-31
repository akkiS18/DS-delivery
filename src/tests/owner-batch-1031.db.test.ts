import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { placeOrder } from '../modules/orders/service.js';
import { quoteCheckout } from '../modules/orders/contract.js';
import { performOrderAction } from '../modules/restaurant-orders/service.js';
import { autoConfirmRealOrders } from '../modules/restaurant-orders/auto.js';
import { customerOrderView, loadCustomerOrder } from '../modules/miniapp/views.js';
import { autoCompleteDeliveries } from '../modules/taxi/service.js';
import { loadCashMaxOrderSom, setCashMaxOrderSom, CASH_MAX_KEY } from '../modules/payment/method.js';
import { setFeeMode, loadFeeConfig } from '../modules/pricing/config.js';

// Owner batch 2026-10-31: walking only where the restaurant allows it, cancellation closes once the restaurant accepted, the taxi's 20-minute
// auto "delivered", the administrator's cash cap and the separate platform line. ds_delivery_test only; rows are deleted by id in after().
delete process.env.GMAIL_AUTO_CONFIRM;
process.env.MAX_OPEN_UNPAID_ORDERS = '0';
const ADMIN = String(randomInt(500000000001, 600000000000));
const savedAdmin = process.env.SUPPORT_ADMIN_1_TELEGRAM_ID;
process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = ADMIN;

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const nonce = randomUUID().slice(0, 8);
const customerTg = String(randomInt(700000000001, 800000000000));
const operatorTg = String(randomInt(900000000001, 990000000000));
let restaurantId = '';
let noWalkRestaurantId = '';
let taxiId = '';
let last4 = '';
let savedFee: Awaited<ReturnType<typeof loadFeeConfig>>;
let savedCashMax: string | null = null;

const order = (id: string) => db.order.findUniqueOrThrow({ where: { id } });
const view = async (id: string) => customerOrderView((await loadCustomerOrder(customerTg, id))!);
const input = (rid: string, productId: string, extra: Record<string, unknown> = {}) => ({
  restaurantId: rid, telegramUserId: customerTg, customerName: 'T', phone: '+998901234567', addressText: 'Manzil', deliveryLat: 41.3, deliveryLng: 69.2,
  taxiCompanyId: taxiId, checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'REAL' as const, items: [{ productId, quantity: 1 }], ...extra,
});

async function paidOrder(): Promise<string> {
  await db.payment.updateMany({ where: { restaurantId, status: { in: ['AWAITING', 'QUEUED'] } }, data: { status: 'CANCELLED' } });
  const p = await db.product.create({ data: { restaurantId, name: `P${randomUUID().slice(0, 6)}`, priceSom: randomInt(10_000, 90_000), isAvailable: true } });
  const o = await placeOrder(engine, input(restaurantId, p.id) as Parameters<typeof placeOrder>[1]);
  const pay = await db.payment.findFirstOrThrow({ where: { orderId: o!.id } });
  const m = await engine.ingestGmail(`ob-${randomUUID()}`, { cardLast4: last4, amountTiyin: pay.amountTiyin, occurredAt: new Date(), emailReceivedAt: new Date(Date.now() + 1000), minutePrecision: true, trustedSender: true });
  assert.equal(m.status, 'MATCHED_UNVERIFIED', String(m.reason));
  assert.ok((await autoConfirmRealOrders(100)).confirmed.includes(o!.id));
  assert.equal((await order(o!.id)).status, 'PREPARING');
  return o!.id;
}

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  restaurantId = (await db.restaurant.create({ data: { slug: `ob-${nonce}`, name: `OB ${nonce}`, pickupAddress: 'P', walkingDeliveryEnabled: true } })).id;
  noWalkRestaurantId = (await db.restaurant.create({ data: { slug: `ob2-${nonce}`, name: `OB2 ${nonce}`, pickupAddress: 'P' } })).id;
  taxiId = (await db.taxiCompany.create({ data: { name: `OB Taxi ${randomUUID()}`, operatorTelegramUserId: operatorTg, isActive: true } })).id;
  for (;;) { last4 = String(randomInt(1000, 10000)); if (!(await db.card.findUnique({ where: { last4 } }))) break; }
  await db.card.create({ data: { restaurantId, last4, isTest: false } });
  savedFee = await loadFeeConfig();
  savedCashMax = (await db.platformSetting.findUnique({ where: { key: CASH_MAX_KEY } }))?.value ?? null;
});

after(async () => {
  // put the shared settings back exactly as found
  await setFeeMode({ adminId: ADMIN, mode: savedFee.mode, percentBp: savedFee.percentBp, lineSom: savedFee.lineSom, lineWaived: savedFee.lineWaived }).catch(() => undefined);
  if (savedCashMax === null) await db.platformSetting.deleteMany({ where: { key: CASH_MAX_KEY } });
  else await db.platformSetting.upsert({ where: { key: CASH_MAX_KEY }, create: { key: CASH_MAX_KEY, value: savedCashMax }, update: { value: savedCashMax } });
  const rids = [restaurantId, noWalkRestaurantId];
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
  if (savedAdmin === undefined) delete process.env.SUPPORT_ADMIN_1_TELEGRAM_ID; else process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = savedAdmin;
  await db.$disconnect();
});

test('walking is refused for a restaurant that has not turned it on, and accepted for one that has', async () => {
  const p = await db.product.create({ data: { restaurantId: noWalkRestaurantId, name: 'NW', priceSom: 20_000, isAvailable: true } });
  await assert.rejects(() => placeOrder(engine, input(noWalkRestaurantId, p.id, { deliveryPreference: 'WALK_OK' }) as Parameters<typeof placeOrder>[1]), /PIYODA_YETKAZISH_MAVJUD_EMAS/);
  assert.equal(await db.order.count({ where: { restaurantId: noWalkRestaurantId } }), 0, 'nothing was created');
  const q = await quoteCheckout({ restaurantId: noWalkRestaurantId, items: [{ productId: p.id, quantity: 1 }] } as Parameters<typeof quoteCheckout>[0]);
  assert.equal(q.ok && q.walkingAvailable, false);
  const q2 = await quoteCheckout({ restaurantId, items: [{ productId: (await db.product.create({ data: { restaurantId, name: 'W', priceSom: 20_000, isAvailable: true } })).id, quantity: 1 }] } as Parameters<typeof quoteCheckout>[0]);
  assert.equal(q2.ok && q2.walkingAvailable, true);
});

test('cancellation: open until the restaurant presses "Qabul qildim", closed after that', async () => {
  const id = await paidOrder();
  let v = await view(id);
  assert.deepEqual([v.awaitingRestaurant, v.restaurantAccepted, v.cancel.allowed, v.cancel.kind], [true, false, true, 'REFUND_REQUEST']);
  const r = await performOrderAction(engine, restaurantId, id, 'SET_PREP_TIME', {});
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.notEqual((await order(id)).prepChosenMinutes, null);
  v = await view(id);
  assert.deepEqual([v.awaitingRestaurant, v.restaurantAccepted, v.cancel.allowed, v.cancel.kind], [false, true, false, null]);
});

test('auto "delivered": not before the minutes pass, once after, with the commission once and an audit row that says it was assumed', async () => {
  const id = await paidOrder();
  assert.equal((await performOrderAction(engine, restaurantId, id, 'MARK_READY', {})).ok, true);
  const d = await db.taxiDispatch.findFirstOrThrow({ where: { orderId: id } });
  const sent = new Date(Date.now() - 5 * 60_000);
  await db.taxiDispatch.update({ where: { id: d.id }, data: { status: 'ASSIGNED', dispatchedAt: sent } });
  assert.deepEqual(await autoCompleteDeliveries({ onlyOrderId: id }), [], '5 minutes is too early');
  assert.equal((await order(id)).status, 'READY');

  await db.taxiDispatch.update({ where: { id: d.id }, data: { dispatchedAt: new Date(Date.now() - 21 * 60_000) } });
  const done = await Promise.all([1, 2, 3].map(() => autoCompleteDeliveries({ onlyOrderId: id })));
  assert.equal(done.flat().length, 1, 'three sweeps together close it once');
  assert.equal((await order(id)).status, 'COMPLETED');
  assert.equal(await db.orderEvent.count({ where: { orderId: id, action: 'DELIVERY_AUTO_ASSUMED' } }), 1);
  assert.equal(await db.orderEvent.count({ where: { orderId: id, action: 'DELIVERY_CONFIRMED' } }), 0, 'never recorded as a human confirmation');
  assert.equal(await db.commissionEntry.count({ where: { orderId: id } }), 1);
  assert.deepEqual(await autoCompleteDeliveries({ onlyOrderId: id }), []);
});

test('auto "delivered" leaves an order with an open refund alone', async () => {
  const id = await paidOrder();
  assert.equal((await performOrderAction(engine, restaurantId, id, 'MARK_READY', {})).ok, true);
  const d = await db.taxiDispatch.findFirstOrThrow({ where: { orderId: id } });
  const sent = new Date(Date.now() - 60 * 60_000);
  await db.taxiDispatch.update({ where: { id: d.id }, data: { status: 'ASSIGNED', dispatchedAt: sent } });
  const pay = await db.payment.findFirstOrThrow({ where: { orderId: id } });
  await db.refundRequest.create({ data: { orderId: id, paymentId: pay.id, kind: 'CUSTOMER_CANCEL', status: 'REQUESTED', reasonCode: 'POLICY', requestedBy: 'test', requestedByType: 'CUSTOMER', paidAmountTiyin: pay.amountTiyin, orderStatusBefore: 'READY', paymentStatusAtRequest: pay.status } });
  assert.deepEqual(await autoCompleteDeliveries({ onlyOrderId: id }), []);
  assert.equal((await order(id)).status, 'READY');
  assert.equal(await db.commissionEntry.count({ where: { orderId: id } }), 0);
});

test('cash cap: 500 000 by default, the administrator can change it, bad values and strangers are refused, every change is audited', async () => {
  await db.platformSetting.deleteMany({ where: { key: CASH_MAX_KEY } });
  assert.equal(await loadCashMaxOrderSom(), 500_000);
  const admin = ADMIN;
  assert.equal(await setCashMaxOrderSom({ adminId: admin, maxOrderSom: 300_000 }), 'CHANGED');
  assert.equal(await loadCashMaxOrderSom(), 300_000);
  assert.equal(await setCashMaxOrderSom({ adminId: admin, maxOrderSom: 300_000 }), 'UNCHANGED');
  await assert.rejects(() => setCashMaxOrderSom({ adminId: admin, maxOrderSom: 5 }), /NAQD_CHEGARA_NOTOGRI/);
  await assert.rejects(() => setCashMaxOrderSom({ adminId: admin, maxOrderSom: 1.5 * 100_000 + 0.5 }), /NAQD_CHEGARA_NOTOGRI/);
  await assert.rejects(() => setCashMaxOrderSom({ adminId: '1', maxOrderSom: 400_000 }), /ADMIN_RUXSAT_YOQ/);
  assert.equal(await loadCashMaxOrderSom(), 300_000);
  assert.equal(await db.adminAuditEvent.count({ where: { action: 'CASH_MAX_CHANGED', targetId: CASH_MAX_KEY, actorId: admin, details: { path: ['next'], equals: 300_000 } } }) >= 1, true);
});

test('platform line: a separate 5 000 on top of the menu prices, crossed out and free when waived, with no commission owed on it', async () => {
  const admin = ADMIN;
  const p = await db.product.create({ data: { restaurantId, name: 'LN', priceSom: 30_000, isAvailable: true } });
  const items = [{ productId: p.id, quantity: 2 }];
  await setFeeMode({ adminId: admin, mode: 'LINE', lineSom: 5000, lineWaived: false });
  let q = await quoteCheckout({ restaurantId, items } as Parameters<typeof quoteCheckout>[0]);
  assert.ok(q.ok);
  assert.equal(q.ok && q.totalSom, 65_000, 'menu 60 000 + the line');
  await setFeeMode({ adminId: admin, mode: 'LINE', lineSom: 5000, lineWaived: true });
  q = await quoteCheckout({ restaurantId, items } as Parameters<typeof quoteCheckout>[0]);
  assert.equal(q.ok && q.totalSom, 60_000, 'waived: nothing added');
  assert.equal((await loadFeeConfig()).lineWaived, true);
  await assert.rejects(() => setFeeMode({ adminId: admin, mode: 'LINE', lineSom: 10 }), /XIZMAT_HAQI_SUMMASI_NOTOGRI/);
});
