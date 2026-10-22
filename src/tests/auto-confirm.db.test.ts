import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { placeOrder } from '../modules/orders/service.js';
import { requestCancellation } from '../modules/refunds/service.js';
import { takeStaffAction } from '../modules/restaurant/service.js';
import { advanceGmailMatchedOrder, autoConfirmRealOrders } from '../modules/restaurant-orders/auto.js';
import { AUTO_GRACE_MS, deliverAutoConfirmRefusals, deliverPaidOrderAlerts } from '../bot/restaurant-alert.js';

// Stage 8D: a trusted Gmail match of a REAL payment confirms itself and starts cooking; everything doubtful stays with people.
// ds_delivery_test only; the bot is a fake, nothing is sent anywhere.
delete process.env.RESTAURANT_TELEGRAM_ENABLED;
delete process.env.RESTAURANT_TELEGRAM_ALERTS;
delete process.env.GMAIL_AUTO_CONFIRM;
process.env.MAX_OPEN_UNPAID_ORDERS = '0';
const adminTg = String(randomInt(300000000001, 399999999999));
process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = adminTg;

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const nonce = randomUUID().slice(0, 8);
const staffTg = String(randomInt(100000000001, 200000000000));
const customerTg = String(randomInt(700000000001, 800000000000));
const operatorTg = String(randomInt(900000000001, 990000000000));
let restaurantId = '';
let taxiId = '';
let last4 = '';

const sent: Array<{ to: string; text: string }> = [];
const bot = { telegram: { async sendMessage(to: string, text: string) { sent.push({ to, text }); return { message_id: sent.length }; } } };

async function realOrder() {
  const p = await db.product.create({ data: { restaurantId, name: `P${randomUUID().slice(0, 6)}`, priceSom: randomInt(10_000, 900_000), isAvailable: true } });
  const o = await placeOrder(engine, {
    restaurantId, telegramUserId: customerTg, customerName: 'T', phone: '+998901234567', addressText: 'Manzil',
    taxiCompanyId: taxiId, checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'REAL', items: [{ productId: p.id, quantity: 1 }],
  });
  return { id: o!.id, pay: await db.payment.findFirstOrThrow({ where: { orderId: o!.id } }) };
}
const gmail = (amountTiyin: bigint) => engine.ingestGmail(`ac-${randomUUID()}`, {
  cardLast4: last4, amountTiyin, occurredAt: new Date(), emailReceivedAt: new Date(), minutePrecision: true, trustedSender: true,
});
async function realOrderMatched() {
  const { id, pay } = await realOrder();
  assert.equal((await gmail(pay.amountTiyin)).status, 'MATCHED_UNVERIFIED');
  return { id, pay };
}
const order = (id: string) => db.order.findUniqueOrThrow({ where: { id } });
const payment = (id: string) => db.payment.findUniqueOrThrow({ where: { id } });

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  restaurantId = (await db.restaurant.create({ data: { slug: `ac-${nonce}`, name: `AC ${nonce}`, pickupAddress: 'P', staffTelegramUserId: staffTg, staffLinkedAt: new Date(Date.now() - 3600_000) } })).id;
  taxiId = (await db.taxiCompany.create({ data: { name: `AC Taxi ${randomUUID()}`, operatorTelegramUserId: operatorTg, isActive: true } })).id;
  for (;;) { last4 = String(randomInt(1000, 10000)); if (!(await db.card.findUnique({ where: { last4 } }))) break; }
  await db.card.create({ data: { restaurantId, last4, isTest: false } });
});

after(async () => {
  const orders = (await db.order.findMany({ where: { restaurantId }, select: { id: true } })).map(o => o.id);
  const pays = await db.payment.findMany({ where: { restaurantId }, select: { id: true } });
  const cards = await db.card.findMany({ where: { restaurantId }, select: { id: true } });
  await db.notificationLog.deleteMany({ where: { orderId: { in: orders } } });
  await db.taxiDispatch.deleteMany({ where: { orderId: { in: orders } } });
  await db.refundRequest.deleteMany({ where: { orderId: { in: orders } } });
  await db.paymentEvent.deleteMany({ where: { paymentId: { in: pays.map(p => p.id) } } });
  await db.payment.deleteMany({ where: { id: { in: pays.map(p => p.id) } } });
  await db.incomingTransaction.deleteMany({ where: { cardLast4: last4 } });
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards.map(c => c.id) } } });
  await db.card.deleteMany({ where: { restaurantId } });
  await db.order.deleteMany({ where: { restaurantId } });
  await db.customer.deleteMany({ where: { telegramUserId: customerTg } });
  await db.product.deleteMany({ where: { restaurantId } });
  await db.restaurant.deleteMany({ where: { id: restaurantId } });
  await db.taxiCompany.deleteMany({ where: { id: taxiId } });
  await db.$disconnect();
});

test('an exact trusted Gmail match confirms itself, starts cooking and is audited as the system, not as a person', async () => {
  const { id, pay } = await realOrderMatched();
  assert.equal((await order(id)).status, 'PAYMENT_MATCHED_UNVERIFIED', 'the engine alone still only produces a signal');
  const r = await autoConfirmRealOrders(50);
  assert.ok(r.confirmed.includes(id));
  const o = await order(id);
  assert.equal(o.status, 'PREPARING');
  assert.equal(o.paymentVerifiedBy, 'system:gmail-auto');
  assert.ok(o.paymentVerifiedAt);
  assert.equal((await payment(pay.id)).status, 'CONFIRMED_MANUAL');
  const ev = await db.paymentEvent.findFirstOrThrow({ where: { paymentId: pay.id, action: 'CONFIRMED_MANUAL' } });
  assert.equal(ev.actorType, 'SYSTEM');
  assert.equal(ev.actorId, 'system:gmail-auto');
  assert.ok(ev.incomingTransactionId, 'the confirmation points at the bank e-mail it relied on');
  assert.equal(await db.taxiDispatch.count({ where: { orderId: id } }), 1, 'cooking started, so the taxi is scheduled as before');
  assert.equal((await autoConfirmRealOrders(50)).confirmed.includes(id), false, 'a second sweep changes nothing');
});

test('concurrent sweeps confirm and start exactly once', async () => {
  const { id } = await realOrderMatched();
  await Promise.allSettled([1, 2, 3, 4, 5].map(() => advanceGmailMatchedOrder(id)));
  assert.equal((await order(id)).status, 'PREPARING');
  assert.equal(await db.orderEvent.count({ where: { orderId: id, action: 'VERIFY_PAYMENT' } }), 1);
  assert.equal(await db.orderEvent.count({ where: { orderId: id, action: 'START_PREPARING' } }), 1);
  const pay = await db.payment.findFirstOrThrow({ where: { orderId: id } });
  assert.equal(await db.paymentEvent.count({ where: { paymentId: pay.id, action: 'CONFIRMED_MANUAL' } }), 1);
});

test('money that is not an exact unambiguous match is never confirmed: it goes to REVIEW_REQUIRED and the order does not move', async () => {
  const { id, pay } = await realOrder();
  const wrong = await gmail(pay.amountTiyin + 100n);
  assert.equal(wrong.status, 'REVIEW_REQUIRED');
  const r = await autoConfirmRealOrders(50);
  assert.ok(!r.confirmed.includes(id) && !r.refused.some(x => x.orderId === id));
  assert.equal((await order(id)).status, 'PAYMENT_PENDING');
  assert.equal((await payment(pay.id)).status, 'AWAITING');
});

test('kill switch GMAIL_AUTO_CONFIRM=false: nothing confirms itself and the system actor is refused for real money', async () => {
  const { id } = await realOrderMatched();
  process.env.GMAIL_AUTO_CONFIRM = 'false';
  try {
    assert.deepEqual(await autoConfirmRealOrders(50), { confirmed: [], refused: [] });
    await assert.rejects(() => takeStaffAction({ actorSystemId: 'gmail-auto', orderId: id, action: 'VERIFY_PAYMENT' }), /RUXSAT_YOQ/);
    assert.equal((await order(id)).status, 'PAYMENT_MATCHED_UNVERIFIED');
  } finally { delete process.env.GMAIL_AUTO_CONFIRM; }
  // the restaurant's own manual confirmation still works exactly as before
  const r = await takeStaffAction({ actorTelegramId: staffTg, orderId: id, action: 'VERIFY_PAYMENT' });
  assert.equal(r.changed, true);
});

test('the system actor can only verify/start REAL orders as gmail-auto: other ids and READY are refused', async () => {
  const { id } = await realOrderMatched();
  await assert.rejects(() => takeStaffAction({ actorSystemId: 'mock-auto', orderId: id, action: 'VERIFY_PAYMENT' }), /RUXSAT_YOQ/);
  await assert.rejects(() => takeStaffAction({ actorSystemId: 'evil', orderId: id, action: 'VERIFY_PAYMENT' }), /RUXSAT_YOQ/);
  await assert.rejects(() => takeStaffAction({ actorSystemId: 'gmail-auto', orderId: id, action: 'MARK_READY' }), /RUXSAT_YOQ/);
  assert.equal((await order(id)).status, 'PAYMENT_MATCHED_UNVERIFIED');
});

test('evidence tampering: a transaction that is not a trusted bank e-mail is refused, the order stays for a person, the admin hears once', async () => {
  const { id, pay } = await realOrderMatched();
  await db.incomingTransaction.update({ where: { id: (await payment(pay.id)).matchedTransactionId! }, data: { trustedSender: false } });
  const r = await autoConfirmRealOrders(50);
  const refusal = r.refused.find(x => x.orderId === id);
  assert.ok(refusal, 'refusal reported');
  assert.equal(refusal.reason, 'TOLOV_MOS_EMAS');
  assert.equal((await order(id)).status, 'PAYMENT_MATCHED_UNVERIFIED');
  assert.equal((await payment(pay.id)).status, 'MATCHED_UNVERIFIED');
  assert.equal((await autoConfirmRealOrders(50)).refused.some(x => x.orderId === id), false, 'no retry storm');
  const before = sent.length;
  assert.equal(await deliverAutoConfirmRefusals(bot, [refusal]), 1);
  assert.equal(await deliverAutoConfirmRefusals(bot, [refusal]), 0, 'one message per order and admin');
  assert.equal(sent.length, before + 1);
  assert.equal(sent[sent.length - 1]!.to, adminTg);
  assert.ok(!sent[sent.length - 1]!.text.includes(last4), 'no card digits');
});

test('an order the customer already asked to cancel is not confirmed automatically', async () => {
  const { id } = await realOrderMatched();
  const c = await requestCancellation({ actorType: 'CUSTOMER', actorTelegramId: customerTg, orderId: id, reasonCode: 'CHANGED_MIND' });
  assert.notEqual(c.result, 'NOT_FOUND');
  const r = await autoConfirmRealOrders(50);
  assert.ok(!r.confirmed.includes(id));
  assert.equal((await order(id)).status === 'PREPARING', false);
});

test('restaurant alerts: no "please confirm" while it confirms itself; "new paid order" once cooking; a stuck match asks for the manual confirmation', async () => {
  const mine = () => sent.filter(s => s.to === staffTg);
  // 1) matched seconds ago: silent
  const a = await realOrderMatched();
  const num = (await order(a.id)).number;
  const about = (n: number) => mine().filter(s => s.text.includes(`#${n}`));
  await deliverPaidOrderAlerts(bot);
  assert.equal(about(num).length, 0, 'inside the grace period nothing is announced for an unconfirmed match');
  // 2) it confirmed itself: one "paid order" message without the old "confirm" request
  await autoConfirmRealOrders(50);
  await deliverPaidOrderAlerts(bot);
  const mineA = about(num);
  assert.equal(mineA.length, 1);
  assert.match(mineA[0]!.text, /to‘langan buyurtma/);
  assert.doesNotMatch(mineA[0]!.text, /tasdiqlash/i);
  // 3) a match that stayed unconfirmed past the grace period: the manual fallback text
  const b = await realOrderMatched();
  await db.incomingTransaction.update({ where: { id: (await payment(b.pay.id)).matchedTransactionId! }, data: { trustedSender: false } });
  await autoConfirmRealOrders(50);
  await db.payment.update({ where: { id: b.pay.id }, data: { matchedAt: new Date(Date.now() - AUTO_GRACE_MS - 5_000) } });
  await deliverPaidOrderAlerts(bot);
  const numB = (await order(b.id)).number;
  const mineB = mine().filter(s => s.text.includes(`#${numB}`) && !s.text.startsWith('⏰'));
  assert.equal(mineB.length, 1);
  assert.match(mineB[0]!.text, /avtomatik tasdiqlanmadi/);
});
