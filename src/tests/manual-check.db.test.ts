import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { placeOrder } from '../modules/orders/service.js';
import { accrueCommissionTx } from '../modules/commission/ledger.js';
import { setCollectsToPlatform, setManualPaymentCheck } from '../modules/payment/pool-admin.js';
import { customerOrderView, loadCustomerOrder } from '../modules/miniapp/views.js';
import { cancelUnpaidOrder } from '../modules/refunds/service.js';
import { confirmRestaurantCheckedPayment, rejectRestaurantCheckedOrder } from '../modules/restaurant/manual-payment.js';
import { attemptKey, setRestaurantPassword } from '../modules/restaurant-auth/service.js';

// "Shirin" mode: the restaurant checks the money itself (Payment.method CARD_MANUAL). ds_delivery_test only. The orders are REAL-mode orders with a real
// (non-test) restaurant card; no money moves anywhere.
delete process.env.RESTAURANT_MANUAL_ACCEPTANCE;
delete process.env.COMMISSION_FLAT_SOM;
process.env.MAX_OPEN_UNPAID_ORDERS = '0';
process.env.RESTAURANT_LOGIN_MAX_FAILURES = '50';
process.env.RESTAURANT_LOGIN_IP_MAX_FAILURES = '1000';
const ADMIN = String(randomInt(100000000001, 200000000000));

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const app = buildApp(engine);
const nonce = randomUUID().slice(0, 8);
const slug = `shirin-${nonce}`;
const otherSlug = `shirin2-${nonce}`;
const plainSlug = `plain-${nonce}`;
const PW = `Alpha-${randomUUID()}`;
const customerTg = String(randomInt(700000000001, 800000000000));
const ids: Record<string, string> = {};
const products: Record<string, string> = {};
const cardsLast4: string[] = [];
let taxiId = '';
let token = '';
let otherToken = '';
let savedAdmin: string | undefined;
const ip = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`;

const place = (restaurant: 'r' | 'p' = 'r', over: Partial<Parameters<typeof placeOrder>[1]> = {}) => placeOrder(engine, {
  restaurantId: ids[restaurant]!, telegramUserId: customerTg, customerName: 'Tester', phone: '+998901234567', addressText: 'Test manzil',
  taxiCompanyId: taxiId, checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'REAL', items: [{ productId: products[restaurant]!, quantity: 1 }], ...over,
});
const row = (id: string) => db.order.findUniqueOrThrow({ where: { id }, include: { payment: true, taxiDispatches: true } });
const post = (id: string, action: string, body: object = {}, tk = token) =>
  app.inject({ method: 'POST', url: `/api/v1/restaurant/orders/${id}/${action}`, headers: { authorization: `Bearer ${tk}` }, payload: body });
const verify = (id: string, tk = token) => post(id, 'verify-payment', { confirmReceived: true }, tk);
const list = async (filter: string) => (await app.inject({ method: 'GET', url: `/api/v1/restaurant/orders?filter=${filter}`, headers: { authorization: `Bearer ${token}` } })).json();
const clearActive = () => db.order.updateMany({ where: { restaurantId: { in: [ids.r!, ids.p!] }, status: { in: ['PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'PREPARING', 'READY'] } }, data: { status: 'CANCELLED' } });

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  savedAdmin = process.env.SUPPORT_ADMIN_1_TELEGRAM_ID;
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = ADMIN;
  const base = { pickupAddress: 'Pickup', pickupPhone: '+998900000001', defaultPrepMinutes: 30 };
  ids.r = (await db.restaurant.create({ data: { slug, name: `Shirin ${nonce}`, ...base, manualPaymentCheck: true } })).id;
  ids.o = (await db.restaurant.create({ data: { slug: otherSlug, name: `Shirin2 ${nonce}`, ...base, manualPaymentCheck: true } })).id;
  ids.p = (await db.restaurant.create({ data: { slug: plainSlug, name: `Plain ${nonce}`, ...base } })).id;
  await setRestaurantPassword({ slug, password: PW });
  await setRestaurantPassword({ slug: otherSlug, password: PW });
  products.r = (await db.product.create({ data: { restaurantId: ids.r, name: `osh-${nonce}`, priceSom: 25_000 } })).id;
  products.p = (await db.product.create({ data: { restaurantId: ids.p, name: `osh-${nonce}`, priceSom: 25_000 } })).id;
  taxiId = (await db.taxiCompany.create({ data: { name: `Shirin Taxi ${randomUUID()}`, operatorTelegramUserId: String(randomInt(900000000001, 990000000000)), isActive: true } })).id;
  for (const restaurantId of [ids.r, ids.o, ids.p]) {
    for (;;) {
      const c = String(randomInt(1000, 9999));
      if (await db.card.findUnique({ where: { last4: c } })) continue;
      cardsLast4.push(c); await engine.addCard(c, false, restaurantId); break;
    }
  }
  const login = await app.inject({ method: 'POST', url: '/api/v1/restaurant/auth/login', payload: { slug, password: PW }, remoteAddress: ip });
  assert.equal(login.statusCode, 200);
  token = login.json().accessToken;
  const login2 = await app.inject({ method: 'POST', url: '/api/v1/restaurant/auth/login', payload: { slug: otherSlug, password: PW }, remoteAddress: ip });
  assert.equal(login2.statusCode, 200);
  otherToken = login2.json().accessToken;
});

after(async () => {
  if (savedAdmin === undefined) delete process.env.SUPPORT_ADMIN_1_TELEGRAM_ID; else process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = savedAdmin;
  const rids = [ids.r!, ids.o!, ids.p!];
  await db.$transaction(async tx => { // the audit trail and the ledger are append-only; this switch exists for exactly this cleanup
    await tx.$executeRaw`SELECT set_config('ds.ledger_cleanup', 'on', true)`;
    await tx.adminAuditEvent.deleteMany({ where: { actorId: ADMIN } });
    await tx.commissionEvent.deleteMany({ where: { entry: { restaurantId: { in: rids } } } });
    await tx.commissionEntry.deleteMany({ where: { restaurantId: { in: rids } } });
  });
  const orders = (await db.order.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(o => o.id);
  await db.notificationLog.deleteMany({ where: { orderId: { in: orders } } });
  await db.taxiDispatch.deleteMany({ where: { orderId: { in: orders } } });
  const pays = await db.payment.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } });
  await db.payment.deleteMany({ where: { id: { in: pays.map(p => p.id) } } });
  await db.restaurantLoginAttempt.deleteMany({ where: { keyHash: { in: [attemptKey('slug', slug), attemptKey('slug', otherSlug), attemptKey('ip', ip)] } } });
  await db.order.deleteMany({ where: { restaurantId: { in: rids } } });
  const cards = await db.card.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } });
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards.map(c => c.id) } } });
  await db.card.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.customer.deleteMany({ where: { telegramUserId: customerTg } });
  await db.product.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.taxiCompany.deleteMany({ where: { id: taxiId } });
  await db.restaurant.deleteMany({ where: { id: { in: rids } } });
  await db.$disconnect();
});

test('checkout: a Shirin order is PAYMENT_PENDING with a RESTAURANT_CHECK payment on the restaurant card; the customer sees the card with no countdown', async () => {
  const o = await place();
  const r = await row(o!.id);
  assert.equal(r.status, 'PAYMENT_PENDING');
  assert.equal(r.payment!.method, 'CARD_MANUAL');
  assert.equal(r.payment!.status, 'RESTAURANT_CHECK');
  assert.ok(r.payment!.cardId && r.payment!.expiresAt, 'a card is shown and the restaurant has a deadline');
  assert.equal(r.payment!.matchedTransactionId, null);
  const view = customerOrderView((await loadCustomerOrder(customerTg, o!.id))!) as { stage: string; payment: { instructions: { manualCheck: boolean; expiresAt: string | null; windowSeconds: number | null; cardLast4: string } | null } };
  assert.equal(view.stage, 'PAYMENT_PENDING');
  assert.equal(view.payment.instructions?.manualCheck, true);
  assert.equal(view.payment.instructions?.expiresAt, null, 'the customer is never shown a deadline');
  assert.equal(view.payment.instructions?.windowSeconds, null);
  assert.ok(cardsLast4.includes(view.payment.instructions!.cardLast4));
  await clearActive();
});

test('checkout: equal amounts do not queue behind each other (no engine slot is held)', async () => {
  await clearActive();
  const [a, b, c] = await Promise.all([place(), place(), place()]);
  for (const o of [a, b, c]) assert.equal((await row(o!.id)).payment!.status, 'RESTAURANT_CHECK');
  await clearActive();
});

test('a restaurant without the switch keeps the normal card flow', async () => {
  const o = await place('p');
  const r = await row(o!.id);
  assert.equal(r.payment!.method, 'CARD');
  assert.equal(r.payment!.status, 'AWAITING');
  assert.ok(r.payment!.expiresAt);
  await clearActive();
});

test('restaurant app: the order is in "new" with Tasdiqlash + Rad etish, shown as "Kutilmoqda" to the installed app; not under "waiting"', async () => {
  await clearActive();
  const before = (await list('new')).counts;
  const o = await place();
  const news = await list('new');
  const found = news.orders.find((x: { id: string }) => x.id === o!.id);
  assert.ok(found, 'reaches the kitchen before the payment is confirmed');
  assert.deepEqual(found.allowedActions.sort(), ['REJECT', 'VERIFY_PAYMENT']);
  assert.equal(found.payment.status, 'AWAITING', 'the installed app only knows AWAITING');
  assert.equal(found.payment.method, 'CARD_MANUAL');
  assert.equal(news.counts.new, before.new + 1);
  assert.ok(!(await list('waiting')).orders.some((x: { id: string }) => x.id === o!.id));
  assert.ok(found.attention.includes('VERIFY_PAYMENT'));
  await clearActive();
});

test('verify: one tap confirms the money, starts cooking and acknowledges the order; concurrent taps change it once', async () => {
  await clearActive();
  const o = await place();
  const results = await Promise.all([verify(o!.id), verify(o!.id), verify(o!.id)]);
  assert.equal(results.filter(r => r.statusCode === 200).length, 1, results.map(r => r.statusCode).join());
  assert.ok(results.every(r => [200, 409].includes(r.statusCode)));
  const r = await row(o!.id);
  assert.equal(r.payment!.status, 'CONFIRMED_MANUAL');
  assert.equal(r.status, 'PREPARING');
  assert.ok(r.paymentVerifiedAt && r.paymentVerifiedBy?.startsWith('restaurant-api:'));
  assert.ok(r.prepChosenMinutes !== null, 'the confirming tap is the kitchen acknowledgement (no second "Qabul qildim")');
  assert.equal(await db.paymentEvent.count({ where: { paymentId: r.payment!.id, action: 'CONFIRMED_MANUAL' } }), 1);
  assert.equal(await db.orderEvent.count({ where: { orderId: o!.id, action: 'VERIFY_PAYMENT' } }), 1);
  assert.ok(r.taxiDispatches.length <= 1);
  assert.equal((await verify(o!.id)).statusCode, 409, 'a repeat tap after the fact is refused, not applied twice');
  await clearActive();
});

test('authorization: another restaurant cannot confirm or reject it; the system actor is refused', async () => {
  await clearActive();
  const o = await place();
  assert.equal((await verify(o!.id, otherToken)).statusCode, 404);
  assert.equal((await post(o!.id, 'reject', { reason: 'OTHER' }, otherToken)).statusCode, 404);
  await assert.rejects(confirmRestaurantCheckedPayment({ actorSystemId: 'gmail-auto', orderId: o!.id }), /RUXSAT_YOQ/);
  await assert.rejects(rejectRestaurantCheckedOrder({ actorSystemId: 'gmail-auto', orderId: o!.id, reason: 'OTHER' }), /RUXSAT_YOQ/);
  await assert.rejects(confirmRestaurantCheckedPayment({ actorRestaurantId: ids.o!, orderId: o!.id }), /RUXSAT_YOQ/);
  assert.equal((await row(o!.id)).payment!.status, 'RESTAURANT_CHECK', 'nothing changed');
  await clearActive();
});

test('reject: the money did not arrive -> RESTAURANT_REJECTED, payment CANCELLED; a repeat is refused', async () => {
  await clearActive();
  const o = await place();
  const res = await post(o!.id, 'reject', { reason: 'OTHER' });
  assert.equal(res.statusCode, 200, res.body);
  const r = await row(o!.id);
  assert.equal(r.status, 'RESTAURANT_REJECTED');
  assert.equal(r.payment!.status, 'CANCELLED');
  assert.equal((await post(o!.id, 'reject', { reason: 'OTHER' })).statusCode, 409);
  assert.equal((await verify(o!.id)).statusCode, 409, 'a rejected order cannot be confirmed afterwards');
  await clearActive();
});

test('expiry: an unconfirmed order expires after the restaurant deadline; a late tap cannot revive it', async () => {
  await clearActive();
  const o = await place();
  await db.payment.update({ where: { orderId: o!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await verify(o!.id)).statusCode, 409, 'late tap');
  await engine.maintenance();
  const r = await row(o!.id);
  assert.equal(r.payment!.status, 'EXPIRED');
  assert.equal(r.status, 'PAYMENT_EXPIRED');
  assert.equal(await db.cardCooldown.count({ where: { cardId: r.payment!.cardId! } }), 0, 'no engine card cooldown for a payment that held no slot');
  assert.equal((await verify(o!.id)).statusCode, 409);
});

test('customer cancel: an unconfirmed order can be cancelled for free; the restaurant then cannot confirm it', async () => {
  await clearActive();
  const o = await place();
  const res = await cancelUnpaidOrder(engine, { telegramUserId: customerTg, orderId: o!.id });
  assert.equal(res.result, 'CANCELLED');
  const r = await row(o!.id);
  assert.equal(r.status, 'CANCELLED');
  assert.equal(r.payment!.status, 'CANCELLED');
  assert.equal((await verify(o!.id)).statusCode, 409);
});

test('commission: a delivered Shirin order accrues like any card order the restaurant verified, once', async () => {
  await clearActive();
  const o = await place();
  assert.equal((await verify(o!.id)).statusCode, 200);
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${o!.id} FOR UPDATE`;
    await tx.order.update({ where: { id: o!.id }, data: { status: 'COMPLETED' } });
    await tx.orderEvent.create({ data: { orderId: o!.id, actorTelegramId: 'test', actorType: 'SYSTEM', action: 'TEST_DELIVERY', fromStatus: 'PREPARING', toStatus: 'COMPLETED' } });
  });
  assert.equal((await db.$transaction(tx => accrueCommissionTx(tx, o!.id, { id: 'system', type: 'SYSTEM' }))).result, 'ACCRUED');
  assert.equal((await db.$transaction(tx => accrueCommissionTx(tx, o!.id, { id: 'system', type: 'SYSTEM' }))).result, 'ALREADY_ACCRUED');
  await clearActive();
});

test('database: a CARD_MANUAL payment can never be linked to a bank signal; an unlinked real CARD confirmation is still refused', async () => {
  const o = await place();
  const p = (await row(o!.id)).payment!;
  const tx = await db.incomingTransaction.create({ data: {
    sourceId: `manual-${nonce}`, source: 'MOCK', cardLast4: cardsLast4[0]!, amountTiyin: p.amountTiyin, occurredAt: new Date(), receivedAt: new Date(), status: 'REVIEW_REQUIRED', trustedSender: true, minutePrecision: true,
  } });
  await assert.rejects(db.payment.update({ where: { id: p.id }, data: { matchedTransactionId: tx.id } }), /Payment_manual_has_no_signal|check constraint/i);
  await assert.rejects(db.payment.update({ where: { id: p.id }, data: { method: 'BITCOIN' } }), /Payment_method_valid|check constraint/i);
  const plain = (await row((await place('p'))!.id)).payment!;
  await assert.rejects(db.payment.update({ where: { id: plain.id }, data: { status: 'CONFIRMED_MANUAL' } }), /Payment_real_match_needs_transaction|check constraint/i);
  await db.incomingTransaction.delete({ where: { id: tx.id } });
  await clearActive();
});

test('admin switch: guards, audit, and exclusivity with the platform card pool', async () => {
  await assert.rejects(setManualPaymentCheck({ adminId: '1', slug: plainSlug, on: true }), /ADMIN_RUXSAT_YOQ/);
  assert.deepEqual(await setManualPaymentCheck({ adminId: ADMIN, slug: `nope-${nonce}`, on: true }), { result: 'NOT_FOUND' });
  assert.equal((await setManualPaymentCheck({ adminId: ADMIN, slug, on: true })).result, 'UNCHANGED');
  assert.equal((await setCollectsToPlatform({ adminId: ADMIN, slug, on: true })).result, 'MANUAL_MODE', 'a Shirin restaurant is not paid on the platform pool');
  // plainSlug: has an own card, no open payments -> can be switched on, and not onto the pool while on
  await clearActive();
  await db.payment.updateMany({ where: { restaurantId: ids.p, status: { in: ['QUEUED', 'AWAITING'] } }, data: { status: 'CANCELLED' } });
  assert.equal((await setManualPaymentCheck({ adminId: ADMIN, slug: plainSlug, on: true })).result, 'CHANGED');
  assert.equal((await setCollectsToPlatform({ adminId: ADMIN, slug: plainSlug, on: true })).result, 'MANUAL_MODE');
  assert.equal((await setManualPaymentCheck({ adminId: ADMIN, slug: plainSlug, on: false })).result, 'CHANGED');
  assert.equal(await db.adminAuditEvent.count({ where: { actorId: ADMIN, action: { in: ['MANUAL_PAYMENT_CHECK_ON', 'MANUAL_PAYMENT_CHECK_OFF'] } } }), 2);
  // no own card -> refused
  await db.card.updateMany({ where: { restaurantId: ids.p }, data: { active: false } });
  assert.equal((await setManualPaymentCheck({ adminId: ADMIN, slug: plainSlug, on: true })).result, 'NO_OWN_CARD');
  await db.card.updateMany({ where: { restaurantId: ids.p }, data: { active: true } });
  // switching off keeps an order that already waits for the restaurant working
  const o = await place();
  assert.equal((await setManualPaymentCheck({ adminId: ADMIN, slug, on: false })).result, 'CHANGED');
  assert.equal((await verify(o!.id)).statusCode, 200);
  await db.restaurant.update({ where: { id: ids.r }, data: { manualPaymentCheck: true } });
  await clearActive();
});
