import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { placeOrder } from '../modules/orders/service.js';
import { takeStaffAction } from '../modules/restaurant/service.js';
import { autoConfirmRealOrders } from '../modules/restaurant-orders/auto.js';
import { countUnhandledReviews } from '../modules/payment/review.js';
import { sampleHumoMessage } from '../modules/payment/humo.js';
import { ingestHumoMessage, type TgMessage } from '../modules/payment/humo-telegram.js';

// Humocard Telegram messages as a payment signal: trust is decided by the sender account, the engine ends in MATCHED_UNVERIFIED (the restaurant
// confirms; the Gmail-only automatic confirmation must leave it alone), and every path is idempotent. ds_delivery_test only; nothing is sent.
delete process.env.GMAIL_AUTO_CONFIRM;
process.env.MAX_OPEN_UNPAID_ORDERS = '0';

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const nonce = randomUUID().slice(0, 8);
const staffTg = String(randomInt(100000000001, 200000000000));
const customerTg = String(randomInt(700000000001, 800000000000));
const operatorTg = String(randomInt(900000000001, 990000000000));
const BOT = String(randomInt(5_000_000_000, 6_000_000_000));
let restaurantId = '';
let taxiId = '';
let last4 = '';
let testCardLast4 = '';
let nextMessageId = randomInt(1000, 100000);

// Telegram dates have whole seconds; rounding up keeps the message after the payment it answers
const message = (over: Partial<TgMessage> & { text?: string } = {}): TgMessage => ({
  id: nextMessageId++, date: Math.ceil(Date.now() / 1000), out: false, senderId: { toString: () => BOT }, message: over.text, ...over,
});
const credit = (amountTiyin: bigint, card = last4, balance = amountTiyin * 3n) => sampleHumoMessage(card, amountTiyin, new Date(), balance);

async function realOrder() {
  // one card per restaurant: earlier tests' open payments would queue this one behind them
  await db.payment.updateMany({ where: { restaurantId, status: { in: ['AWAITING', 'QUEUED'] } }, data: { status: 'CANCELLED' } });
  const p = await db.product.create({ data: { restaurantId, name: `P${randomUUID().slice(0, 6)}`, priceSom: randomInt(10_000, 900_000), isAvailable: true } });
  const o = await placeOrder(engine, {
    restaurantId, telegramUserId: customerTg, customerName: 'T', phone: '+998901234567', addressText: 'Manzil',
    taxiCompanyId: taxiId, checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'REAL', items: [{ productId: p.id, quantity: 1 }],
  });
  return { id: o!.id, pay: await db.payment.findFirstOrThrow({ where: { orderId: o!.id } }) };
}
const order = (id: string) => db.order.findUniqueOrThrow({ where: { id } });

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  restaurantId = (await db.restaurant.create({ data: { slug: `hm-${nonce}`, name: `HM ${nonce}`, pickupAddress: 'P', staffTelegramUserId: staffTg, staffLinkedAt: new Date(Date.now() - 3600_000) } })).id;
  taxiId = (await db.taxiCompany.create({ data: { name: `HM Taxi ${randomUUID()}`, operatorTelegramUserId: operatorTg, isActive: true } })).id;
  const free = async () => { for (;;) { const v = String(randomInt(1000, 10000)); if (!(await db.card.findUnique({ where: { last4: v } }))) return v; } };
  last4 = await free();
  await db.card.create({ data: { restaurantId, last4, isTest: false } });
  testCardLast4 = await free();
  await db.card.create({ data: { restaurantId, last4: testCardLast4, isTest: true } });
});

after(async () => {
  const orders = (await db.order.findMany({ where: { restaurantId }, select: { id: true } })).map(o => o.id);
  const pays = await db.payment.findMany({ where: { restaurantId }, select: { id: true } });
  const cards = await db.card.findMany({ where: { restaurantId }, select: { id: true } });
  await db.notificationLog.deleteMany({ where: { orderId: { in: orders } } });
  await db.taxiDispatch.deleteMany({ where: { orderId: { in: orders } } });
  await db.paymentEvent.deleteMany({ where: { paymentId: { in: pays.map(p => p.id) } } });
  await db.payment.deleteMany({ where: { id: { in: pays.map(p => p.id) } } });
  await db.incomingTransaction.deleteMany({ where: { cardLast4: { in: [last4, testCardLast4] } } });
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards.map(c => c.id) } } });
  await db.card.deleteMany({ where: { restaurantId } });
  await db.order.deleteMany({ where: { restaurantId } });
  await db.customer.deleteMany({ where: { telegramUserId: customerTg } });
  await db.product.deleteMany({ where: { restaurantId } });
  await db.restaurant.deleteMany({ where: { id: restaurantId } });
  await db.taxiCompany.deleteMany({ where: { id: taxiId } });
  await db.$disconnect();
});

test('a credit from the verified bot matches the order as a trusted HUMO_TG signal; the amount is read from the credit line, not the balance', async () => {
  const { id, pay } = await realOrder();
  const r = await ingestHumoMessage(engine, BOT, message({ text: credit(pay.amountTiyin, last4, 987_654_300n) }));
  assert.equal(r?.result.status, 'MATCHED_UNVERIFIED', String(r?.result.reason));
  assert.equal((await order(id)).status, 'PAYMENT_MATCHED_UNVERIFIED');
  const inc = await db.incomingTransaction.findFirstOrThrow({ where: { matchedPaymentId: pay.id } });
  assert.equal(inc.source, 'HUMO_TG');
  assert.equal(inc.trustedSender, true);
  assert.equal(inc.amountTiyin, pay.amountTiyin);
  assert.match(inc.sourceId, new RegExp(`^humo:${BOT}:\\d+$`));
  assert.ok(inc.emailReceivedAt, 'the Telegram message date feeds the delay checks');
});

test('only the verified bot account counts: other senders, our own messages, old messages and non-credits are dropped without touching the engine', async () => {
  const { pay } = await realOrder();
  const text = credit(pay.amountTiyin);
  const before = await db.incomingTransaction.count({ where: { cardLast4: last4 } });
  assert.equal(await ingestHumoMessage(engine, BOT, message({ text, senderId: { toString: () => '777' } })), null, 'a customer sending a lookalike message');
  assert.equal(await ingestHumoMessage(engine, BOT, message({ text, out: true })), null, 'our own message');
  assert.equal(await ingestHumoMessage(engine, BOT, message({ text, senderId: undefined })), null, 'unknown sender');
  assert.equal(await ingestHumoMessage(engine, BOT, message({ text, date: Math.floor(Date.now() / 1000) - 7200 })), null, 'older than the look-back');
  assert.equal(await ingestHumoMessage(engine, BOT, message({ text: text.replace('➕', '➖') })), null, 'a debit');
  assert.equal(await ingestHumoMessage(engine, BOT, message({ text: 'Salom' })), null);
  assert.equal(await db.incomingTransaction.count({ where: { cardLast4: last4 } }), before, 'nothing was stored');
  assert.equal((await db.payment.findUniqueOrThrow({ where: { id: pay.id } })).status, 'AWAITING');
});

test('the same Telegram message is processed once, even when the live handler and the poll deliver it together', async () => {
  const { id, pay } = await realOrder();
  const m = message({ text: credit(pay.amountTiyin) });
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => ingestHumoMessage(engine, BOT, m)));
  assert.equal(results.filter(r => r?.result.status === 'MATCHED_UNVERIFIED').length, 1);
  assert.equal(results.filter(r => r?.result.status === 'DUPLICATE').length, 4);
  assert.equal(await db.incomingTransaction.count({ where: { sourceId: `humo:${BOT}:${m.id}` } }), 1);
  assert.equal(await db.paymentEvent.count({ where: { paymentId: pay.id, action: 'MATCHED_UNVERIFIED' } }), 1);
  assert.deepEqual([...await engine.seenHumo([`${BOT}:${m.id}`, `${BOT}:0`])], [`${BOT}:${m.id}`]);
  assert.equal((await order(id)).status, 'PAYMENT_MATCHED_UNVERIFIED');
});

test('doubtful money goes to review, never to an order: wrong amount, unknown card, test card, and the same bank event seen by mail and by Telegram', async () => {
  const { id, pay } = await realOrder();
  const wrong = await ingestHumoMessage(engine, BOT, message({ text: credit(pay.amountTiyin + 100n) }));
  assert.equal(wrong?.result.status, 'REVIEW_REQUIRED');
  assert.equal(wrong?.result.reason, 'AMOUNT_ABOVE_EXPECTED');
  assert.equal((await order(id)).status, 'PAYMENT_PENDING');

  const unknown = await ingestHumoMessage(engine, BOT, message({ text: credit(pay.amountTiyin, '0000') }));
  assert.equal(unknown?.result.reason, 'UNKNOWN_CARD');
  const onTestCard = await ingestHumoMessage(engine, BOT, message({ text: credit(pay.amountTiyin, testCardLast4) }));
  assert.equal(onTestCard?.result.reason, 'GMAIL_FOR_MOCK_CARD', 'a real bank signal never pays a mock card');
  await db.incomingTransaction.deleteMany({ where: { cardLast4: '0000' } });

  // the exact payment, through Telegram, then the same bank event again through the mail: only the first one pays
  const at = new Date(Date.now() - 20_000); at.setSeconds(0, 0);
  const viaTg = await ingestHumoMessage(engine, BOT, message({ text: sampleHumoMessage(last4, pay.amountTiyin, at) }));
  assert.equal(viaTg?.result.status, 'MATCHED_UNVERIFIED');
  const viaMail = await engine.ingestGmail(`hm-${randomUUID()}`, {
    cardLast4: last4, amountTiyin: pay.amountTiyin, occurredAt: at, emailReceivedAt: new Date(), minutePrecision: true, trustedSender: true,
  });
  assert.equal(viaMail.status, 'REVIEW_REQUIRED');
  assert.equal(viaMail.reason, 'POSSIBLE_DUPLICATE_NOTIFICATION');
  assert.ok(await countUnhandledReviews() >= 3, 'Telegram-sourced reviews are listed for the administrator too');
});

test('a Humo match is left for the restaurant: the Gmail auto-confirm sweep neither confirms nor refuses it, and the restaurant can confirm it', async () => {
  const { id, pay } = await realOrder();
  await ingestHumoMessage(engine, BOT, message({ text: credit(pay.amountTiyin) }));
  const sweep = await autoConfirmRealOrders(100);
  assert.ok(!sweep.confirmed.includes(id), 'not confirmed by the e-mail-only automation');
  assert.ok(!sweep.refused.some(r => r.orderId === id), 'and no admin alert is produced for it');
  assert.equal((await order(id)).status, 'PAYMENT_MATCHED_UNVERIFIED');
  await assert.rejects(() => takeStaffAction({ actorSystemId: 'gmail-auto', orderId: id, action: 'VERIFY_PAYMENT' }), /TOLOV_MOS_EMAS|RUXSAT_YOQ/);
  const r = await takeStaffAction({ actorTelegramId: staffTg, orderId: id, action: 'VERIFY_PAYMENT' });
  assert.equal(r.changed, true);
  assert.equal((await order(id)).status, 'PAYMENT_CONFIRMED');
  assert.equal((await db.payment.findUniqueOrThrow({ where: { id: pay.id } })).status, 'CONFIRMED_MANUAL');
});
