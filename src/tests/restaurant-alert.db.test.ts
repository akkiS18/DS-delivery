import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { placeOrder } from '../modules/orders/service.js';
import { deliverPaidOrderAlerts, REMINDER_AFTER_MS } from '../bot/restaurant-alert.js';

// Stage 8C: "open the app" alert for restaurant staff. ds_delivery_test only; the bot is a fake, nothing is sent anywhere.
delete process.env.RESTAURANT_TELEGRAM_ENABLED;
delete process.env.RESTAURANT_TELEGRAM_ALERTS;
process.env.MAX_OPEN_UNPAID_ORDERS = '0';

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
const mine = () => sent.filter(s => s.to === staffTg);

async function realOrderMatched() {
  const p = await db.product.create({ data: { restaurantId, name: `P${randomUUID().slice(0, 6)}`, priceSom: randomInt(10_000, 900_000), isAvailable: true } });
  const o = await placeOrder(engine, {
    restaurantId, telegramUserId: customerTg, customerName: 'T', phone: '+998901234567', addressText: 'Manzil',
    taxiCompanyId: taxiId, checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'REAL', items: [{ productId: p.id, quantity: 1 }],
  });
  const pay = await db.payment.findFirstOrThrow({ where: { orderId: o!.id } });
  const m = await engine.ingestGmail(`ra-${randomUUID()}`, { cardLast4: last4, amountTiyin: pay.amountTiyin, occurredAt: new Date(), emailReceivedAt: new Date(), minutePrecision: true, trustedSender: true });
  assert.equal(m.status, 'MATCHED_UNVERIFIED');
  return { order: await db.order.findUniqueOrThrow({ where: { id: o!.id } }), pay };
}

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  restaurantId = (await db.restaurant.create({ data: { slug: `ra-${nonce}`, name: `RA ${nonce}`, pickupAddress: 'P', staffTelegramUserId: staffTg, staffLinkedAt: new Date(Date.now() - 3600_000) } })).id;
  taxiId = (await db.taxiCompany.create({ data: { name: `RA Taxi ${randomUUID()}`, operatorTelegramUserId: operatorTg, isActive: true } })).id;
  for (;;) { last4 = String(randomInt(1000, 10000)); if (!(await db.card.findUnique({ where: { last4 } }))) break; }
  await db.card.create({ data: { restaurantId, last4, isTest: false } });
});

after(async () => {
  const orders = (await db.order.findMany({ where: { restaurantId }, select: { id: true } })).map(o => o.id);
  const pays = await db.payment.findMany({ where: { restaurantId }, select: { id: true } });
  const cards = await db.card.findMany({ where: { restaurantId }, select: { id: true } });
  await db.notificationLog.deleteMany({ where: { orderId: { in: orders } } });
  await db.taxiDispatch.deleteMany({ where: { orderId: { in: orders } } });
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

test('a REAL payment that reached the restaurant sends exactly one "open the app" alert, with no buttons and no secrets', async () => {
  const { order } = await realOrderMatched();
  assert.equal(order.status, 'PAYMENT_MATCHED_UNVERIFIED');
  await deliverPaidOrderAlerts(bot);
  assert.equal(mine().length, 1);
  assert.match(mine()[0]!.text, new RegExp(`#${order.number}`));
  assert.match(mine()[0]!.text, /tasdiqlash/i);
  assert.ok(!mine()[0]!.text.includes(last4), 'no card digits in the alert');
  await deliverPaidOrderAlerts(bot);
  await deliverPaidOrderAlerts(bot);
  assert.equal(mine().length, 1, 'repeat polling never repeats the alert');
});

test('one reminder when the confirmation is overdue, and only one', async () => {
  const { order, pay } = await realOrderMatched();
  await deliverPaidOrderAlerts(bot);
  const afterFirst = mine().length;
  await db.payment.update({ where: { id: pay.id }, data: { matchedAt: new Date(Date.now() - REMINDER_AFTER_MS - 60_000) } });
  await deliverPaidOrderAlerts(bot);
  const reminders = mine().filter(s => s.text.startsWith('⏰') && s.text.includes(`#${order.number}`));
  assert.equal(reminders.length, 1);
  assert.equal(mine().length, afterFirst + 1);
  await deliverPaidOrderAlerts(bot);
  assert.equal(mine().filter(s => s.text.startsWith('⏰') && s.text.includes(`#${order.number}`)).length, 1);
});

test('nothing is sent for unpaid orders, old orders, restaurants without a linked staff account, or when switched off', async () => {
  // unpaid REAL order (card assigned, nobody paid)
  const p = await db.product.create({ data: { restaurantId, name: `P${randomUUID().slice(0, 6)}`, priceSom: randomInt(10_000, 900_000), isAvailable: true } });
  const unpaid = await placeOrder(engine, {
    restaurantId, telegramUserId: customerTg, customerName: 'T', phone: '+998901234567', addressText: 'Manzil',
    taxiCompanyId: taxiId, checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'REAL', items: [{ productId: p.id, quantity: 1 }],
  });
  const n0 = mine().length;
  await deliverPaidOrderAlerts(bot);
  assert.equal(mine().length, n0);
  assert.ok(!mine().some(s => s.text.includes(`#${unpaid!.number}`)));

  // old: a matched order last touched 3 hours ago is not announced
  const { order: old } = await realOrderMatched();
  await db.order.update({ where: { id: old.id }, data: { updatedAt: new Date(Date.now() - 3 * 3600_000) } });
  await db.$executeRaw`UPDATE "Order" SET "updatedAt" = now() - interval '3 hours' WHERE id = ${old.id}`;
  await deliverPaidOrderAlerts(bot);
  assert.ok(!mine().some(s => s.text.includes(`#${old.number}`) && !s.text.startsWith('⏰')), 'stale orders are not announced');

  // no staff link
  await db.restaurant.update({ where: { id: restaurantId }, data: { staffTelegramUserId: null } });
  const { order: unlinked } = await realOrderMatched();
  const n1 = sent.length;
  await deliverPaidOrderAlerts(bot);
  assert.equal(sent.length, n1);
  await db.restaurant.update({ where: { id: restaurantId }, data: { staffTelegramUserId: staffTg } });

  // switched off
  process.env.RESTAURANT_TELEGRAM_ALERTS = 'false';
  try {
    const n2 = sent.length;
    await deliverPaidOrderAlerts(bot);
    assert.equal(sent.length, n2);
  } finally { delete process.env.RESTAURANT_TELEGRAM_ALERTS; }
  void unlinked;
});

test('MOCK orders are announced as tests, and a failing Telegram send is retried instead of lost', async () => {
  const p = await db.product.create({ data: { restaurantId, name: `P${randomUUID().slice(0, 6)}`, priceSom: randomInt(10_000, 900_000), isAvailable: true } });
  await db.card.create({ data: { restaurantId, last4: await (async () => { for (;;) { const v = String(randomInt(1000, 10000)); if (!(await db.card.findUnique({ where: { last4: v } }))) return v; } })(), isTest: true } });
  const o = await placeOrder(engine, {
    restaurantId, telegramUserId: customerTg, customerName: 'T', phone: '+998901234567', addressText: 'Manzil',
    taxiCompanyId: taxiId, checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'MOCK', items: [{ productId: p.id, quantity: 1 }],
  });
  await db.order.update({ where: { id: o!.id }, data: { status: 'PAYMENT_CONFIRMED' } });
  let fail = true;
  const flaky = { telegram: { async sendMessage(to: string, text: string) { if (fail) throw new Error('network'); sent.push({ to, text }); return { message_id: 1 }; } } };
  const before = mine().length;
  await deliverPaidOrderAlerts(flaky);
  assert.equal(mine().length, before, 'the failed send delivered nothing');
  fail = false;
  await deliverPaidOrderAlerts(flaky);
  const got = mine().filter(s => s.text.includes(`#${o!.number}`));
  assert.equal(got.length, 1);
  assert.match(got[0]!.text, /SINOV/);
});
