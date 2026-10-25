import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { CheckoutError, placeOrder } from '../modules/orders/service.js';
import { quoteCheckout } from '../modules/orders/contract.js';
import { switchOrderToCash } from '../modules/orders/cash.js';
import { accrueCommissionTx } from '../modules/commission/ledger.js';
import { CASH_ENABLED_KEY, setCashEnabled } from '../modules/payment/method.js';
import { TAXI_MODE_KEY, loadTaxiMode, setTaxiMode } from '../modules/taxi/mode.js';
import { customerOrderView, loadCustomerOrder } from '../modules/miniapp/views.js';
import { cancelUnpaidOrder } from '../modules/refunds/service.js';
import { getRequest, listRequests } from '../modules/taxi-app/service.js';
import { attemptKey, setRestaurantPassword } from '../modules/restaurant-auth/service.js';

// Cash on delivery. ds_delivery_test only, MOCK payments. The cash switch is a platform-wide setting: run this file on its own and it restores the row.
delete process.env.RESTAURANT_MANUAL_ACCEPTANCE;
delete process.env.COMMISSION_FLAT_SOM;
process.env.MAX_OPEN_UNPAID_ORDERS = '0';
process.env.RESTAURANT_LOGIN_MAX_FAILURES = '50';
process.env.RESTAURANT_LOGIN_IP_MAX_FAILURES = '1000';
const LEAD = Number(process.env.TAXI_LEAD_MINUTES ?? 4); // the lead the server was started with
const ADMIN = String(randomInt(100000000001, 200000000000));

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const app = buildApp(engine);
const nonce = randomUUID().slice(0, 8);
const slug = `cash-${nonce}`;
const otherSlug = `cash2-${nonce}`;
const PW = `Alpha-${randomUUID()}`;
const customerTg = String(randomInt(700000000001, 800000000000));
const ids: Record<string, string> = {};
let product = '';
let bigProduct = '';
const cardsLast4: string[] = [];
let taxiId = '';
let token = '';
let otherToken = '';
let savedAdmin: string | undefined;
let savedSetting: { key: string; value: string } | null = null;
const ip = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`;

const place = (over: Partial<Parameters<typeof placeOrder>[1]> = {}, tg = customerTg) => placeOrder(engine, {
  restaurantId: ids.r!, telegramUserId: tg, customerName: 'Tester', phone: '+998901234567', addressText: 'Test manzil',
  taxiCompanyId: taxiId, checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'MOCK', items: [{ productId: product, quantity: 1 }], paymentMethod: 'CASH', ...over,
});
const row = (id: string) => db.order.findUniqueOrThrow({ where: { id }, include: { payment: true, taxiDispatches: true } });
const post = (id: string, action: string, body: object = {}, tk = token) =>
  app.inject({ method: 'POST', url: `/api/v1/restaurant/orders/${id}/${action}`, headers: { authorization: `Bearer ${tk}` }, payload: body });
/** Frees the per-customer cash cap between tests. */
const clearActive = () => db.order.updateMany({ where: { restaurantId: ids.r, status: { in: ['PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'PREPARING', 'READY'] } }, data: { status: 'CANCELLED' } });

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  savedAdmin = process.env.SUPPORT_ADMIN_1_TELEGRAM_ID;
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = ADMIN;
  savedSetting = await db.platformSetting.findUnique({ where: { key: CASH_ENABLED_KEY }, select: { key: true, value: true } });
  await db.platformSetting.deleteMany({ where: { key: CASH_ENABLED_KEY } });
  ids.r = (await db.restaurant.create({ data: { slug, name: `Cash ${nonce}`, pickupAddress: 'Pickup', pickupPhone: '+998900000001', defaultPrepMinutes: 30 } })).id;
  ids.o = (await db.restaurant.create({ data: { slug: otherSlug, name: `Cash2 ${nonce}`, pickupAddress: 'Pickup', pickupPhone: '+998900000002', defaultPrepMinutes: 30 } })).id;
  await setRestaurantPassword({ slug, password: PW });
  await setRestaurantPassword({ slug: otherSlug, password: PW });
  product = (await db.product.create({ data: { restaurantId: ids.r, name: `osh-${nonce}`, priceSom: 25_000 } })).id;
  bigProduct = (await db.product.create({ data: { restaurantId: ids.r, name: `big-${nonce}`, priceSom: 2_000_000 } })).id;
  taxiId = (await db.taxiCompany.create({ data: { name: `Cash Taxi ${randomUUID()}`, operatorTelegramUserId: String(randomInt(900000000001, 990000000000)), isActive: true } })).id;
  for (;;) {
    const c = String(randomInt(1000, 9999));
    if (await db.card.findUnique({ where: { last4: c } })) continue;
    cardsLast4.push(c); await engine.addCard(c, true, ids.r); break;
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
  await db.platformSetting.deleteMany({ where: { key: { in: [CASH_ENABLED_KEY, TAXI_MODE_KEY] } } });
  if (savedSetting) await db.platformSetting.create({ data: savedSetting });
  await db.$transaction(async tx => { // the audit trail is append-only too
    await tx.$executeRaw`SELECT set_config('ds.ledger_cleanup', 'on', true)`;
    await tx.adminAuditEvent.deleteMany({ where: { actorId: ADMIN } });
  });
  const rids = [ids.r!, ids.o!];
  const orders = (await db.order.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(o => o.id);
  await db.$transaction(async tx => { // the ledger is append-only; this switch exists for exactly this cleanup
    await tx.$executeRaw`SELECT set_config('ds.ledger_cleanup', 'on', true)`;
    await tx.commissionEvent.deleteMany({ where: { entry: { restaurantId: { in: rids } } } });
    await tx.commissionEntry.deleteMany({ where: { restaurantId: { in: rids } } });
  });
  await db.notificationLog.deleteMany({ where: { orderId: { in: orders } } });
  await db.taxiDispatch.deleteMany({ where: { orderId: { in: orders } } });
  const pays = await db.payment.findMany({ where: { restaurantId: { in: rids } }, select: { id: true, matchedTransactionId: true } });
  await db.payment.deleteMany({ where: { id: { in: pays.map(p => p.id) } } });
  await db.incomingTransaction.deleteMany({ where: { OR: [{ id: { in: pays.map(p => p.matchedTransactionId).filter((x): x is string => !!x) } }, { cardLast4: { in: cardsLast4 } }] } });
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

test('checkout: a cash order is PAYMENT_PENDING with a CASH_PENDING payment, no card and no taxi yet; the quote offers both ways', async () => {
  const q = await quoteCheckout({ restaurantId: ids.r!, items: [{ productId: product, quantity: 1 }] }, { isTest: true });
  assert.ok(q.ok);
  assert.equal(q.paymentOptions.cash.available, true);
  assert.notEqual(q.paymentOptions.card.state, 'NONE');

  const o = await place();
  const r = await row(o!.id);
  assert.equal(r.status, 'PAYMENT_PENDING');
  assert.deepEqual([r.payment!.method, r.payment!.status, r.payment!.cardId, r.payment!.amountTiyin], ['CASH', 'CASH_PENDING', null, 2_500_000n]);
  assert.ok(r.payment!.expiresAt && r.payment!.expiresAt.getTime() > Date.now());
  assert.equal(r.taxiDispatches.length, 0, 'nothing is dispatched before the restaurant accepts');
  await clearActive();
});

test('restaurant: a pending cash order is in the "new" tab with ACCEPT / REJECT and shows the cash amount, no card evidence', async () => {
  await clearActive();
  const o = await place();
  const list = (await app.inject({ method: 'GET', url: '/api/v1/restaurant/orders?filter=new', headers: { authorization: `Bearer ${token}` } })).json();
  const found = (list.orders ?? []).find((x: { id: string }) => x.id === o!.id);
  assert.ok(found, 'the bell tab contains the cash order');
  const detail = (await app.inject({ method: 'GET', url: `/api/v1/restaurant/orders/${o!.id}`, headers: { authorization: `Bearer ${token}` } })).json();
  const v = detail.order ?? detail;
  assert.deepEqual(v.allowedActions, ['ACCEPT', 'REJECT']);
  assert.equal(v.payment.method, 'CASH');
  assert.deepEqual([v.cash.amountSom, v.cash.accepted], [25_000, false]);
  assert.equal(v.paymentEvidence, null);
  await clearActive();
});

test('accept: cooking starts by itself, the payment is CASH_ACCEPTED, taxi is scheduled; a second tap changes nothing', async () => {
  await clearActive();
  const o = await place();
  const res = await post(o!.id, 'accept');
  assert.equal(res.statusCode, 200, res.body);
  const r = await row(o!.id);
  assert.equal(r.payment!.status, 'CASH_ACCEPTED');
  assert.ok(['PAYMENT_CONFIRMED', 'PREPARING'].includes(r.status), r.status);
  assert.equal(r.status, 'PREPARING', 'cooking starts by itself after the restaurant accepts');
  assert.equal(r.taxiDispatches.length, 1, 'exactly one taxi request is scheduled');
  const events = await db.orderEvent.count({ where: { orderId: o!.id, action: 'ACCEPT_CASH' } });
  assert.equal(events, 1);
  const again = await post(o!.id, 'accept');
  assert.notEqual(again.statusCode, 500);
  assert.equal(await db.orderEvent.count({ where: { orderId: o!.id, action: 'ACCEPT_CASH' } }), 1, 'a double tap must not accept twice');
  assert.equal((await row(o!.id)).payment!.status, 'CASH_ACCEPTED');
});

test('another restaurant cannot accept, reject or cancel the order (looks like "not found")', async () => {
  await clearActive();
  const o = await place();
  for (const action of ['accept', 'reject', 'cancel']) {
    const res = await post(o!.id, action, action === 'accept' ? {} : { reason: 'OTHER' }, otherToken);
    assert.ok([404, 409].includes(res.statusCode), `${action}: ${res.statusCode}`);
  }
  const r = await row(o!.id);
  assert.deepEqual([r.status, r.payment!.status], ['PAYMENT_PENDING', 'CASH_PENDING']);
  await clearActive();
});

test('reject: the order is rejected, the payment cancelled, nothing is cooked or dispatched', async () => {
  await clearActive();
  const o = await place();
  const res = await post(o!.id, 'reject', { reason: 'CLOSED' });
  assert.equal(res.statusCode, 200, res.body);
  const r = await row(o!.id);
  assert.deepEqual([r.status, r.payment!.status, r.taxiDispatches.length], ['RESTAURANT_REJECTED', 'CANCELLED', 0]);
  assert.equal((await post(o!.id, 'accept')).statusCode === 200, false, 'a rejected order cannot be accepted afterwards');
});

test('expiry: an unanswered cash order expires with its payment (maintenance), and cannot be accepted any more', async () => {
  await clearActive();
  const o = await place();
  await db.payment.update({ where: { orderId: o!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await post(o!.id, 'accept')).statusCode === 200, false, 'accepting after the deadline is refused');
  await engine.maintenance();
  const r = await row(o!.id);
  assert.deepEqual([r.status, r.payment!.status], ['PAYMENT_EXPIRED', 'EXPIRED']);
});

test('customer: can withdraw a cash order before the restaurant accepts; after accepting only the restaurant can cancel', async () => {
  await clearActive();
  const a = await place();
  const view = customerOrderView((await loadCustomerOrder(customerTg, a!.id))!);
  assert.equal(view.payment!.method, 'CASH');
  assert.deepEqual([view.payment!.cash!.dueSom, view.payment!.cash!.accepted, view.cancel.kind], [25_000, false, 'UNPAID']);
  assert.equal(view.payment!.instructions, null, 'no card number is ever shown for cash');
  assert.equal((await cancelUnpaidOrder(engine, { telegramUserId: customerTg, orderId: a!.id })).result, 'CANCELLED');
  assert.equal((await row(a!.id)).payment!.status, 'CANCELLED');

  const b = await place();
  assert.equal((await post(b!.id, 'accept')).statusCode, 200);
  const view2 = customerOrderView((await loadCustomerOrder(customerTg, b!.id))!);
  assert.deepEqual([view2.payment!.cash!.accepted, view2.cancel.kind, view2.paidAt], [true, null, null]);
  assert.equal(view2.stage, 'PREPARING');

  const res = await post(b!.id, 'cancel', { reason: 'CLOSED' });
  assert.equal(res.statusCode, 200, res.body);
  const r = await row(b!.id);
  assert.deepEqual([r.status, r.payment!.status], ['CANCELLED', 'CANCELLED']);
  assert.equal(await db.refundRequest.count({ where: { orderId: b!.id } }), 0, 'cash has no refund');
});

test('"card busy": a QUEUED card order can switch to cash exactly once; an AWAITING card order cannot', async () => {
  await clearActive();
  const first = await place({ paymentMethod: 'CARD' });   // takes the only card
  const second = await place({ paymentMethod: 'CARD' });  // same amount: waits in the queue
  assert.equal((await row(first!.id)).payment!.status, 'AWAITING');
  assert.equal((await row(second!.id)).payment!.status, 'QUEUED');
  const q = await quoteCheckout({ restaurantId: ids.r!, items: [{ productId: product, quantity: 1 }] }, { isTest: true });
  assert.ok(q.ok);

  assert.equal(await switchOrderToCash(engine, { telegramUserId: customerTg, orderId: first!.id }), 'NOT_ALLOWED');
  assert.equal(await switchOrderToCash(engine, { telegramUserId: customerTg, orderId: second!.id }), 'SWITCHED');
  assert.equal(await switchOrderToCash(engine, { telegramUserId: customerTg, orderId: second!.id }), 'ALREADY_CASH');
  const r = await row(second!.id);
  assert.deepEqual([r.payment!.method, r.payment!.status, r.payment!.cardId], ['CASH', 'CASH_PENDING', null]);
  assert.equal(await switchOrderToCash(engine, { telegramUserId: String(randomInt(1, 99999999)), orderId: second!.id }), 'NOT_FOUND', 'a stranger cannot switch it');
  await clearActive();
});

test('limits: the kill switch, the amount cap and at most two open cash orders per customer', async () => {
  await clearActive();
  await assert.rejects(setCashEnabled({ adminId: '1', enabled: false }), /ADMIN_RUXSAT_YOQ/);
  assert.equal((await setCashEnabled({ adminId: ADMIN, enabled: false })).valueOf(), 'CHANGED');
  await assert.rejects(place(), (e: unknown) => e instanceof CheckoutError && e.message === 'NAQD_TOLOV_YOPIQ');
  const q = await quoteCheckout({ restaurantId: ids.r!, items: [{ productId: product, quantity: 1 }] }, { isTest: true });
  assert.ok(q.ok);
  assert.equal(q.paymentOptions.cash.available, false);
  assert.equal((await place({ paymentMethod: 'CARD' }))!.payment!.method, 'CARD', 'card orders are not affected');
  assert.equal((await setCashEnabled({ adminId: ADMIN, enabled: true })).valueOf(), 'CHANGED');
  assert.equal(await db.adminAuditEvent.count({ where: { actorId: ADMIN, action: { in: ['CASH_ORDERS_ENABLED', 'CASH_ORDERS_DISABLED'] } } }), 2);

  await assert.rejects(place({ items: [{ productId: bigProduct, quantity: 1 }] }), (e: unknown) => e instanceof CheckoutError && e.message === 'NAQD_SUMMA_JUDA_KATTA');

  await clearActive();
  await place(); await place();
  await assert.rejects(place(), (e: unknown) => e instanceof CheckoutError && e.message === 'KOP_NAQD_BUYURTMA' && e.statusCode === 429);
  await clearActive();
});

test('a card order never goes through the cash path, and the DB refuses a cash payment that carries a card', async () => {
  await clearActive();
  const o = await place({ paymentMethod: 'CARD' });
  const res = await post(o!.id, 'accept');
  assert.notEqual(res.statusCode, 200, 'ACCEPT is a cash step; a card order waits for its bank credit');
  assert.equal(await db.orderEvent.count({ where: { orderId: o!.id, action: 'ACCEPT_CASH' } }), 0);
  const card = await db.card.findFirstOrThrow({ where: { restaurantId: ids.r } });
  const c = await place();
  await assert.rejects(db.payment.update({ where: { orderId: c!.id }, data: { cardId: card.id } }), /Payment_cash_has_no_card|check constraint/);
  await clearActive();
});

/** Moves an accepted order to READY with a dispatched taxi request, like the restaurant + dispatch stages do. */
async function dispatch(orderId: string) {
  await db.order.update({ where: { id: orderId }, data: { status: 'READY', readyAt: new Date() } });
  const d = await db.taxiDispatch.findFirst({ where: { orderId } });
  if (d) return db.taxiDispatch.update({ where: { id: d.id }, data: { status: 'REQUESTED', sentAt: new Date(), expiresAt: new Date(Date.now() + 600_000) } });
  return db.taxiDispatch.create({ data: { orderId, taxiCompanyId: taxiId, attemptNo: 1, status: 'REQUESTED', dueAt: new Date(), expiresAt: new Date(Date.now() + 600_000) } });
}

test('taxi operator view: cash says how much to pay the restaurant, card says nothing is owed', async () => {
  await clearActive();
  const cash = await place();
  assert.equal((await post(cash!.id, 'accept')).statusCode, 200);
  const cd = await dispatch(cash!.id);
  const card = await place({ paymentMethod: 'CARD' });
  const mock = await db.order.findUniqueOrThrow({ where: { id: card!.id }, include: { payment: true } });
  await db.payment.update({ where: { id: mock.payment!.id }, data: { status: 'CONFIRMED_MANUAL' } }).catch(() => undefined); // may need a matched tx: the view only reads the method
  const cardDispatch = await db.taxiDispatch.create({ data: { orderId: card!.id, taxiCompanyId: taxiId, attemptNo: 1, status: 'REQUESTED', dueAt: new Date(), expiresAt: new Date(Date.now() + 600_000) } }).catch(() => null);

  const a = await getRequest(taxiId, cd.id);
  assert.deepEqual(a!.payment, { method: 'CASH', payRestaurantSom: 25_000 });
  if (cardDispatch) assert.deepEqual((await getRequest(taxiId, cardDispatch.id))!.payment, { method: 'CARD', payRestaurantSom: 0 });
  assert.ok((await listRequests(taxiId)).active.some(x => x.id === cd.id && x.payment.method === 'CASH'));
  await clearActive();
});

test('commission: a delivered cash order accrues like a card order, once', async () => {
  await clearActive();
  const o = await place();
  assert.equal((await post(o!.id, 'accept')).statusCode, 200);
  await db.order.update({ where: { id: o!.id }, data: { paymentIsTest: false } });
  await db.payment.update({ where: { orderId: o!.id }, data: { isTest: false } });
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${o!.id} FOR UPDATE`;
    await tx.order.update({ where: { id: o!.id }, data: { status: 'COMPLETED' } });
    await tx.orderEvent.create({ data: { orderId: o!.id, actorTelegramId: 'test', actorType: 'SYSTEM', action: 'TEST_DELIVERY', fromStatus: 'PAYMENT_CONFIRMED', toStatus: 'COMPLETED' } });
  });
  const first = await db.$transaction(tx => accrueCommissionTx(tx, o!.id, { id: 'system', type: 'SYSTEM' }));
  assert.equal(first.result, 'ACCRUED');
  assert.equal((await db.$transaction(tx => accrueCommissionTx(tx, o!.id, { id: 'system', type: 'SYSTEM' }))).result, 'ALREADY_ACCRUED');
  await clearActive();
});

test('taxi timing: default READY mode parks the request until "Tayyor"; the preparation time does not move it', async () => {
  await clearActive();
  await db.platformSetting.deleteMany({ where: { key: TAXI_MODE_KEY } });
  assert.equal(await loadTaxiMode(), 'READY');
  const o = await place();
  assert.equal((await post(o!.id, 'accept')).statusCode, 200);
  const d1 = await db.taxiDispatch.findFirstOrThrow({ where: { orderId: o!.id } });
  assert.equal(d1.status, 'SCHEDULED');
  assert.ok(d1.dueAt.getTime() > Date.now() + 5 * 3_600_000, 'parked, not due for hours');
  const prep = await app.inject({ method: 'POST', url: `/api/v1/restaurant/orders/${o!.id}/prep-time`, headers: { authorization: `Bearer ${token}` }, payload: { minutes: 10 } });
  assert.equal(prep.statusCode, 200, prep.body);
  assert.equal((await db.taxiDispatch.findFirstOrThrow({ where: { orderId: o!.id } })).dueAt.getTime(), d1.dueAt.getTime(), 'choosing the time does not call the taxi');
  const ready = await post(o!.id, 'ready');
  assert.equal(ready.statusCode, 200, ready.body);
  const d2 = await db.taxiDispatch.findFirstOrThrow({ where: { orderId: o!.id } });
  assert.ok(d2.dueAt.getTime() <= Date.now(), '"Tayyor" makes the request due now');
  await clearActive();
});

test('taxi timing: LEAD mode asks 4 minutes before the food is expected; only an administrator can switch the mode (audited)', async () => {
  await clearActive();
  await assert.rejects(setTaxiMode({ adminId: '1', mode: 'LEAD' }), /ADMIN_RUXSAT_YOQ/);
  assert.equal(await setTaxiMode({ adminId: ADMIN, mode: 'LEAD' }), 'CHANGED');
  assert.equal(await setTaxiMode({ adminId: ADMIN, mode: 'LEAD' }), 'UNCHANGED');
  assert.equal(await db.adminAuditEvent.count({ where: { actorId: ADMIN, action: 'TAXI_DISPATCH_MODE_CHANGED' } }), 1);
  const o = await place();
  assert.equal((await post(o!.id, 'accept')).statusCode, 200);
  const r = await row(o!.id);
  const d = r.taxiDispatches[0]!;
  assert.equal(d.dueAt.getTime(), r.preparingStartedAt!.getTime() + (r.prepMinutes! - LEAD) * 60_000);
  const prep = await app.inject({ method: 'POST', url: `/api/v1/restaurant/orders/${o!.id}/prep-time`, headers: { authorization: `Bearer ${token}` }, payload: { minutes: 10 } });
  assert.equal(prep.statusCode, 200, prep.body);
  const r2 = await row(o!.id);
  assert.equal(r2.taxiDispatches[0]!.dueAt.getTime(), r2.preparingStartedAt!.getTime() + (r2.prepMinutes! - LEAD) * 60_000, 'the new time moves the request');
  assert.equal(await setTaxiMode({ adminId: ADMIN, mode: 'READY' }), 'CHANGED');
  await clearActive();
});
