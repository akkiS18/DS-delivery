import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Telegraf } from 'telegraf';
import { buildApp } from '../app.js';
import { createClientBot } from '../bot/client.js';
import { startRestaurantOrderNotifier } from '../bot/restaurant-notify.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { placeOrder } from '../modules/orders/service.js';
import { attemptKey, setRestaurantPassword } from '../modules/restaurant-auth/service.js';
import { db as appDb } from '../lib/db.js';

// Everything Telegram is a LOCAL fake HTTP server: no token is real, nothing leaves this machine, no taxi worker runs
// and no payment is created beyond the repository's MOCK test card. Only rows created here are deleted.
process.env.RESTAURANT_MANUAL_ACCEPTANCE = 'true'; // legacy accept-first flow; the 6F default is covered by checkout.stage6f.db.test.ts
process.env.RESTAURANT_TELEGRAM_ENABLED = 'true'; // the legacy staff panel is exercised here; the disabled mode has its own tests below
delete process.env.BOT_PAYMENT_MODE;
process.env.RESTAURANT_LOGIN_MAX_FAILURES = '50';
process.env.RESTAURANT_LOGIN_IP_MAX_FAILURES = '1000';

const FAKE_TOKEN = '123456789:AAFakeTokenForLocalFakeServerOnly_0123456789';
type Call = { method: string; body: Record<string, unknown>; failed: boolean };
const calls: Call[] = [];
const failChats = new Set<string>();
let getUpdatesMode: 'hold' | 'conflict' = 'hold';
let messageId = 100;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    const method = req.url!.split('/').pop()!;
    const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    const reply = (code: number, payload: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
    if (method === 'getUpdates') {
      if (getUpdatesMode === 'conflict') return reply(409, { ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' });
      setTimeout(() => reply(200, { ok: true, result: [] }), 150);
      return;
    }
    const chat = String(body.chat_id ?? '');
    if (['sendMessage', 'editMessageText'].includes(method) && failChats.has(chat)) {
      calls.push({ method, body, failed: true });
      return reply(403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
    }
    if (method !== 'getMe') calls.push({ method, body, failed: false });
    if (method === 'getMe') return reply(200, { ok: true, result: { id: 123456789, is_bot: true, first_name: 'T', username: 'ds_test_bot' } });
    if (method === 'sendMessage' || method === 'editMessageText') {
      return reply(200, { ok: true, result: { message_id: ++messageId, date: 0, chat: { id: Number(chat) || 1, type: 'private' }, text: String(body.text ?? '') } });
    }
    return reply(200, { ok: true, result: true });
  });
});

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const app = buildApp(engine);
const nonce = randomUUID().slice(0, 8);
const slugA = `tg-a-${nonce}`;
const slugB = `tg-b-${nonce}`;
const PW_A = `Alpha-${randomUUID()}`;
const PW_B = `Bravo-${randomUUID()}`;
const staffA = String(randomInt(100000000000, 300000000000));
const staffB = String(randomInt(300000000001, 500000000000));
const stranger = String(randomInt(500000000001, 600000000000));
const customerTg = String(randomInt(700000000001, 800000000000));
const operatorTg = String(randomInt(900000000001, 990000000000));
const ids: Record<string, string> = {};
const ips: string[] = [];
const productIds: string[] = [];
let last4 = '';
let taxiId = '';
let bot: Telegraf<any>;
let apiRoot = '';
let tokenA = '';
let tokenB = '';
let snapshot: Array<{ id: string; staffLastNotifiedStatus: string | null; customerLastNotifiedStatus: string | null }> = [];
let updateId = 1;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ip = () => { const v = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`; ips.push(v); return v; };
const from = (id: string) => ({ id: Number(id), is_bot: false, first_name: 'Tester' });
const chatOf = (id: string) => ({ id: Number(id), type: 'private' as const, first_name: 'Tester' });
async function press(userId: string, data: string) {
  await bot.handleUpdate({ update_id: updateId++, callback_query: {
    id: randomUUID(), from: from(userId), chat_instance: 'ci', data,
    message: { message_id: 1, date: 0, chat: chatOf(userId), text: 'x' },
  } } as never);
}
async function say(userId: string, text: string) {
  await bot.handleUpdate({ update_id: updateId++, message: {
    message_id: ++messageId, date: 0, chat: chatOf(userId), from: from(userId), text,
    ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }] } : {}),
  } } as never);
}
const texts = (chat: string, since = 0) => calls.slice(since).filter(c => !c.failed && String(c.body.chat_id) === chat
  && ['sendMessage', 'editMessageText'].includes(c.method)).map(c => String(c.body.text));
const attempts = (chat: string, since = 0) => calls.slice(since).filter(c => String(c.body.chat_id) === chat && c.method === 'sendMessage').length;
async function notifyOnce(b: Telegraf<any> = bot) { const stop = startRestaurantOrderNotifier(b); await sleep(1500); stop(); }
const call = (method: 'GET' | 'POST', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1/restaurant${url}`, payload: payload as object | undefined, headers: { authorization: `Bearer ${token}` } });
async function loginToken(slug: string, password: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/v1/restaurant/auth/login', payload: { slug, password }, remoteAddress: ip() });
  assert.equal(r.statusCode, 200);
  return r.json().accessToken;
}
/** Each order gets its own price so the restaurant's single MOCK card is never shared by two live payments. */
async function place() {
  const productId = (await db.product.create({ data: { restaurantId: ids.a!, name: `P${productIds.length}`, priceSom: randomInt(10_000, 900_000) } })).id;
  productIds.push(productId);
  return (await placeOrder(engine, {
    restaurantId: ids.a!, telegramUserId: customerTg, customerName: 'Tester', phone: '+998901234567', addressText: 'Test manzil',
    taxiCompanyId: taxiId, checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'MOCK',
    items: [{ productId, quantity: 1 }],
  }))!;
}
const row = (id: string) => db.order.findUniqueOrThrow({ where: { id } });
const eventCount = (id: string, action: string) => db.orderEvent.count({ where: { orderId: id, action } });

before(async () => {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  apiRoot = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  // The notifier is global; remember notification markers of pre-existing orders and put them back afterwards.
  snapshot = await db.order.findMany({ select: { id: true, staffLastNotifiedStatus: true, customerLastNotifiedStatus: true } });
  ids.a = (await db.restaurant.create({ data: { slug: slugA, name: `Zeta TG A ${nonce}`, staffTelegramUserId: staffA, staffLinkedAt: new Date(Date.now() - 60_000), pickupAddress: 'Test pickup' } })).id;
  ids.b = (await db.restaurant.create({ data: { slug: slugB, name: `Zeta TG B ${nonce}`, staffTelegramUserId: staffB, staffLinkedAt: new Date(Date.now() - 60_000) } })).id;
  await setRestaurantPassword({ slug: slugA, password: PW_A });
  await setRestaurantPassword({ slug: slugB, password: PW_B });
  taxiId = (await db.taxiCompany.create({ data: { name: `Taxi ${randomUUID()}`, operatorTelegramUserId: operatorTg, isActive: true } })).id;
  for (;;) {
    const c = String(randomInt(1000, 9999));
    if (await db.card.findUnique({ where: { last4: c } })) continue;
    last4 = c; await engine.addCard(c, true, ids.a!); break;
  }
  bot = createClientBot(FAKE_TOKEN, engine, { apiRoot });
  bot.botInfo = await bot.telegram.getMe();
  tokenA = await loginToken(slugA, PW_A);
  tokenB = await loginToken(slugB, PW_B);
});
after(async () => {
  const rids = Object.values(ids);
  for (const s of snapshot) {
    await db.order.updateMany({ where: { id: s.id }, data: { staffLastNotifiedStatus: s.staffLastNotifiedStatus, customerLastNotifiedStatus: s.customerLastNotifiedStatus } });
  }
  const payIds = (await db.payment.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(p => p.id);
  await db.incomingTransaction.deleteMany({ where: { OR: [{ matchedPaymentId: { in: payIds } }, { cardLast4: last4 }] } });
  await db.notificationLog.deleteMany({ where: { orderId: { in: (await db.order.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(o => o.id) } } } as never);
  await db.restaurantLoginAttempt.deleteMany({ where: { keyHash: { in: [slugA, slugB].map(s => attemptKey('slug', s)).concat(ips.map(i => attemptKey('ip', i))) } } });
  await db.taxiDispatch.deleteMany({ where: { order: { restaurantId: { in: rids } } } });
  await db.payment.deleteMany({ where: { id: { in: payIds } } });
  const cards = await db.card.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } });
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards.map(c => c.id) } } });
  await db.card.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.order.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.customer.deleteMany({ where: { telegramUserId: customerTg } });
  await db.product.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.restaurant.deleteMany({ where: { id: { in: rids } } });
  await db.taxiCompany.deleteMany({ where: { id: taxiId } });
  await app.close();
  await new Promise<void>(r => server.close(() => r()));
  await db.$disconnect();
  await appDb.$disconnect();
});

test('polling start-up: launch() only settles when polling stops, so workers must start from onLaunch', async () => {
  getUpdatesMode = 'hold';
  const t = new Telegraf(FAKE_TOKEN, { telegram: { apiRoot } });
  let up = false;
  let settled = false;
  const p = t.launch({}, () => { up = true; }).then(() => { settled = true; });
  await sleep(500);
  assert.equal(up, true, 'onLaunch fires once getMe succeeded');
  assert.equal(settled, false, 'launch() is still pending while polling runs');
  t.stop('test');
  await p;
  assert.equal(settled, true);
});

test('duplicate polling (another process with the same token) surfaces as a 409 rejection after onLaunch', async () => {
  getUpdatesMode = 'conflict';
  const t = new Telegraf(FAKE_TOKEN, { telegram: { apiRoot } });
  let up = false;
  await assert.rejects(t.launch({}, () => { up = true; }), (e: { code?: number }) => e.code === 409);
  assert.equal(up, true);
  getUpdatesMode = 'hold';
});

test('customer: /start lists restaurants and the menu opens with products', async () => {
  const from0 = calls.length;
  await say(customerTg, '/start');
  assert.ok(texts(customerTg, from0).length > 0, 'customer got a reply');
  const from1 = calls.length;
  await press(customerTg, `r:${ids.a}`);
  assert.ok(calls.slice(from1).some(c => String(c.body.chat_id) === customerTg), 'menu screen sent');
});

test('staff notice: a new order is delivered once, a failed delivery is retried, repeats never duplicate', async () => {
  const o = await place();
  assert.equal((await row(o.id)).status, 'WAITING_RESTAURANT');
  const mark = calls.length;
  failChats.add(staffA);
  await notifyOnce();
  assert.ok(attempts(staffA, mark) >= 1, 'a delivery was attempted');
  assert.equal(texts(staffA, mark).length, 0, 'but it failed');
  assert.equal((await row(o.id)).staffLastNotifiedStatus, null, 'failed delivery leaves the notice pending');
  failChats.clear();
  await notifyOnce();
  const delivered = texts(staffA, mark).filter(t => t.includes(`#${o.number}`));
  assert.equal(delivered.length, 1);
  await notifyOnce();
  assert.equal(texts(staffA, mark).filter(t => t.includes(`#${o.number}`)).length, 1, 'no duplicate on later runs');
  assert.equal((await row(o.id)).staffLastNotifiedStatus, 'WAITING_RESTAURANT');
});

test('callback authorization: other restaurants, strangers and unlinked accounts cannot act; owners are exactly-once', async () => {
  const o = await place();
  for (const who of [staffB, stranger]) {
    const mark = calls.length;
    await press(who, `staff:acc20:${o.id}`);
    assert.ok(texts(who, mark).some(t => t.includes('Ruxsat yo‘q')), `denied for ${who}`);
    await press(who, `staff:rejUNAVAILABLE:${o.id}`);
  }
  assert.equal((await row(o.id)).status, 'WAITING_RESTAURANT');
  const mark = calls.length;
  await say(stranger, '/staff');
  assert.ok(texts(stranger, mark).some(t => t.includes('biriktirilmagansiz')), 'missing linkage is explained');
  assert.equal((await call('POST', `/orders/${o.id}/accept`, tokenB, { prepMinutes: 20 })).statusCode, 404);
  await Promise.all([1, 2, 3].map(() => press(staffA, `staff:acc20:${o.id}`)));
  const r = await row(o.id);
  assert.equal(r.status, 'PAYMENT_PENDING');
  assert.equal(r.acceptedBy, staffA);
  assert.equal(await db.payment.count({ where: { orderId: o.id } }), 1);
  assert.equal(await eventCount(o.id, 'ACCEPT'), 1);
  assert.ok(texts(staffA, mark).some(t => t.includes('avval bajarilgan')), 'duplicate presses are told it is already done');
});

test('Android and Telegram show the same state; payment verification cannot be bypassed from either side', async () => {
  const o = await place();
  await press(staffA, `staff:acc20:${o.id}`);
  const api = (await call('GET', `/orders/${o.id}`, tokenA)).json();
  assert.equal(api.status, 'PAYMENT_PENDING');
  const mark = calls.length;
  await press(staffA, `staff:view:${o.id}`);
  assert.ok(texts(staffA, mark).some(t => t.includes('Mijoz to‘lovi kutilmoqda')));
  // nothing can start cooking before a verified payment
  await press(staffA, `staff:prep20:${o.id}`);
  assert.equal((await row(o.id)).status, 'PAYMENT_PENDING');
  assert.equal((await call('POST', `/orders/${o.id}/preparing`, tokenA, { prepMinutes: 20 })).statusCode, 409);
  await press(staffA, `staff:verify:${o.id}`);
  assert.equal((await row(o.id)).status, 'PAYMENT_PENDING', 'verify before any matched payment does nothing');
  // only the ordering customer can use the MOCK button
  const mark2 = calls.length;
  await press(stranger, `checkout:mock:${o.id}`);
  assert.equal((await row(o.id)).status, 'PAYMENT_PENDING');
  assert.ok(texts(stranger, mark2).some(t => t.includes('MOCK to‘lov faol emas')));
  await engine.ingestMock(BigInt(o.totalSom) * 100n, last4); // bank-signal only; the MOCK button's automation has its own test
  assert.equal((await row(o.id)).status, 'PAYMENT_MATCHED_UNVERIFIED');
  assert.equal((await call('GET', `/orders/${o.id}`, tokenA)).json().awaitingPaymentVerification, true);
  assert.equal((await call('POST', `/orders/${o.id}/preparing`, tokenA, { prepMinutes: 20 })).statusCode, 409);
  await press(staffB, `staff:verify:${o.id}`);
  assert.equal((await row(o.id)).status, 'PAYMENT_MATCHED_UNVERIFIED', 'another restaurant cannot verify');
  await Promise.all([1, 2].map(() => press(staffA, `staff:verify:${o.id}`)));
  assert.equal((await row(o.id)).status, 'PAYMENT_CONFIRMED');
  assert.equal(await eventCount(o.id, 'VERIFY_PAYMENT'), 1);
  assert.equal((await db.payment.findFirstOrThrow({ where: { orderId: o.id } })).status, 'CONFIRMED_MANUAL');
  // Android prepares, Telegram marks ready; both see READY, and no taxi message is sent by anything here
  const sent0 = calls.length;
  assert.equal((await call('POST', `/orders/${o.id}/preparing`, tokenA, { prepMinutes: 20 })).statusCode, 200);
  await press(staffA, `staff:ready:${o.id}`);
  assert.equal((await row(o.id)).status, 'READY');
  assert.equal((await call('GET', `/orders/${o.id}`, tokenA)).json().status, 'READY');
  assert.equal((await db.taxiDispatch.findFirstOrThrow({ where: { orderId: o.id } })).status, 'SCHEDULED');
  assert.equal(attempts(operatorTg, sent0), 0, 'dispatch is only scheduled; the taxi operator was not messaged');
  // Stage 9: "food ready" is not announced to the customer (the next news is "on the way"); the marker is settled so the row is not re-read
  const mark3 = calls.length;
  await notifyOnce();
  await notifyOnce();
  assert.equal(texts(customerTg, mark3).filter(t => t.includes(`#${o.number}`)).length, 0, 'no message for READY');
  assert.equal((await row(o.id)).customerLastNotifiedStatus, 'READY');
});

test('Android rejection reaches the customer exactly once and Telegram sees the rejected state', async () => {
  const o = await place();
  assert.equal((await call('POST', `/orders/${o.id}/reject`, tokenA, { reason: 'UNAVAILABLE' })).statusCode, 200);
  const mark = calls.length;
  await notifyOnce();
  await notifyOnce();
  assert.equal(texts(customerTg, mark).filter(t => t.includes(`#${o.number}`) && t.includes('qabul qila olmadi')).length, 1);
  assert.equal(texts(staffA, mark).filter(t => t.includes(`#${o.number}`)).length, 0, 'no staff action buttons for a rejected order');
  const mark2 = calls.length;
  await press(staffA, `staff:acc20:${o.id}`);
  assert.equal((await row(o.id)).status, 'RESTAURANT_REJECTED');
  assert.ok(texts(staffA, mark2).some(t => t.includes('avval bajarilgan')));
  assert.equal(await db.payment.count({ where: { orderId: o.id } }), 0);
});

test('RESTAURANT_TELEGRAM_ENABLED=false: no staff notices, no staff panel, old buttons change nothing; customers still served', async () => {
  const previous = process.env.RESTAURANT_TELEGRAM_ENABLED;
  process.env.RESTAURANT_TELEGRAM_ENABLED = 'false';
  try {
    const off = createClientBot(FAKE_TOKEN, engine, { apiRoot });
    off.botInfo = await off.telegram.getMe();
    const o = await place();
    const o2 = await place();
    const m0 = calls.length;
    await notifyOnce(off);
    assert.equal(texts(staffA, m0).length, 0, 'no staff notification');
    assert.equal((await row(o.id)).staffLastNotifiedStatus, null);
    const m1 = calls.length;
    const pressOff = (user: string, data: string) => off.handleUpdate({ update_id: updateId++, callback_query: { id: randomUUID(), from: from(user), chat_instance: 'ci', data,
      message: { message_id: 1, date: 0, chat: chatOf(user), text: 'x' } } } as never);
    for (const data of [`staff:acc20:${o.id}`, `staff:rejUNAVAILABLE:${o.id}`, `staff:prop20:${o.id}`, `staff:verify:${o.id}`, `staff:prep20:${o.id}`, `staff:ready:${o.id}`,
      `refund:cx:${o.id}`, `refund:cxr:OUT_OF_STOCK:${o.id}`, `refund:ok:${o.id}`, `refund:no:${o.id}`, `refund:r0:${o.id}`, `refund:sent:${o.id}`]) {
      await pressOff(staffA, data);
    }
    await off.handleUpdate({ update_id: updateId++, message: { message_id: ++messageId, date: 0, chat: chatOf(staffA), from: from(staffA), text: '/staff',
      entities: [{ type: 'bot_command', offset: 0, length: 6 }] } } as never);
    const replies = texts(staffA, m1);
    assert.ok(replies.length >= 13);
    assert.ok(replies.every(t => t.includes('Android')), 'every old control answers that the panel is disabled');
    assert.equal((await row(o.id)).status, 'WAITING_RESTAURANT', 'nothing was mutated');
    assert.equal(await db.payment.count({ where: { orderId: o.id } }), 0);
    // customer features keep working on the same bot: browsing, and status notices after an app decision
    const m2 = calls.length;
    await off.handleUpdate({ update_id: updateId++, message: { message_id: ++messageId, date: 0, chat: chatOf(customerTg), from: from(customerTg), text: '/start',
      entities: [{ type: 'bot_command', offset: 0, length: 6 }] } } as never);
    assert.ok(texts(customerTg, m2).length > 0);
    assert.equal((await call('POST', `/orders/${o2.id}/reject`, tokenA, { reason: 'UNAVAILABLE' })).statusCode, 200);
    const m3 = calls.length;
    await notifyOnce(off);
    assert.equal(texts(customerTg, m3).filter(t => t.includes(`#${o2.number}`) && t.includes('qabul qila olmadi')).length, 1);
    assert.equal(texts(staffA, m3).length, 0);
    // the staff account and link are untouched (only the panel is off)
    assert.equal((await db.restaurant.findUniqueOrThrow({ where: { id: ids.a! } })).staffTelegramUserId, staffA);
  } finally { process.env.RESTAURANT_TELEGRAM_ENABLED = previous; }
});

test('the customer MOCK payment button moves the order on by itself; real Gmail money never does', async () => {
  const o = await place();
  assert.equal((await call('POST', `/orders/${o.id}/accept`, tokenA, {})).statusCode, 200);
  assert.equal((await row(o.id)).estimatedPrepMinutes, 25, 'restaurant default, no question asked');
  await Promise.all([1, 2].map(() => press(customerTg, `checkout:mock:${o.id}`)));
  const r = await row(o.id);
  assert.equal(r.status, 'PREPARING');
  assert.equal(r.prepMinutes, 25);
  assert.equal(r.readyAt, null, 'READY is never automatic');
  assert.equal(await eventCount(o.id, 'VERIFY_PAYMENT'), 1);
  assert.equal(await eventCount(o.id, 'START_PREPARING'), 1);
  assert.equal(((await db.orderEvent.findFirstOrThrow({ where: { orderId: o.id, action: 'VERIFY_PAYMENT' } })).details as { channel: string }).channel, 'SYSTEM');
  assert.equal(await db.taxiDispatch.count({ where: { orderId: o.id } }), 1, 'taxi dispatch is scheduled automatically');
});
