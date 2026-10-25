import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Telegraf } from 'telegraf';
import { buildApp } from '../app.js';
import { createClientBot } from '../bot/client.js';
import { createTaxiBot } from '../bot/taxi-bot.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { placeOrder } from '../modules/orders/service.js';
import { attemptKey, setRestaurantPassword } from '../modules/restaurant-auth/service.js';
import { takeStaffAction } from '../modules/restaurant/service.js';
import { createOperatorInvite, resetLinkRateLimit } from '../modules/taxi/linking.js';
import { completeDelivery } from '../modules/taxi/service.js';
import { db as appDb } from '../lib/db.js';

// Telegram is a LOCAL fake HTTP server (two fake tokens: customer bot and taxi bot). Nothing leaves this machine, no real
// taxi company is contacted, no money moves (MOCK payments or clearly labelled fixture rows). Only rows created here are
// deleted. The worker reads TAXI_OPERATOR_ALLOWLIST at import time, hence the dynamic import below.
process.env.RESTAURANT_MANUAL_ACCEPTANCE = 'true'; // legacy accept-first flow; the 6F default is covered by checkout.stage6f.db.test.ts
delete process.env.RESTAURANT_TELEGRAM_ENABLED; // default: restaurants use the app
delete process.env.BOT_PAYMENT_MODE;
delete process.env.TAXI_BOT_TOKEN;
process.env.RESTAURANT_LOGIN_MAX_FAILURES = '50';
process.env.RESTAURANT_LOGIN_IP_MAX_FAILURES = '1000';

const CUSTOMER_TOKEN = '111111111:AAFakeCustomerTokenLocalOnly_0123456789';
const TAXI_TOKEN = '222222222:BBFakeTaxiTokenLocalOnlyXXXXXXXXXXX_01';
type Call = { token: string; method: string; body: Record<string, unknown>; failed: boolean };
const calls: Call[] = [];
const failChats = new Set<string>();
let messageId = 100;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    const parts = req.url!.split('/');
    const method = parts.pop()!;
    const token = parts.pop()!.replace(/^bot/, '');
    const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    const reply = (code: number, payload: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
    if (method === 'getUpdates') { setTimeout(() => reply(200, { ok: true, result: [] }), 150); return; }
    const chat = String(body.chat_id ?? '');
    if (['sendMessage', 'editMessageText'].includes(method) && failChats.has(chat)) {
      calls.push({ token, method, body, failed: true });
      return reply(403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
    }
    if (method === 'getMe') return reply(200, { ok: true, result: { id: Number(token.split(':')[0]), is_bot: true, first_name: 'T', username: 'fake_bot' } });
    calls.push({ token, method, body, failed: false });
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
const slugA = `tx-a-${nonce}`;
const PW_A = `Alpha-${randomUUID()}`;
const staffA = String(randomInt(100000000000, 300000000000));
const customerTg = String(randomInt(700000000001, 800000000000));
const opA = String(randomInt(900000000001, 940000000000)); // company A operator (allowlisted)
const opB = String(randomInt(940000000001, 980000000000)); // company B operator (NOT allowlisted)
const rando = String(randomInt(980000000001, 999000000000));
process.env.TAXI_OPERATOR_ALLOWLIST = opA;
const ids: Record<string, string> = {};
const ips: string[] = [];
const productIds: string[] = [];
const fixtureCustomers: string[] = [];
let companyA = '';
let companyB = '';
let companyC = '';
let last4 = '';
let customerBot: Telegraf<any>;
let taxiBot: Telegraf<any>;
let apiRoot = '';
let tokenA = '';
let updateId = 1;
let runCycle: (bot: Telegraf<any>, orderId?: string, operatorBot?: Telegraf<any>) => Promise<void>;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ip = () => { const v = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`; ips.push(v); return v; };
const from = (id: string) => ({ id: Number(id), is_bot: false, first_name: 'Tester' });
const chatOf = (id: string) => ({ id: Number(id), type: 'private' as const, first_name: 'Tester' });
const press = (bot: Telegraf<any>, userId: string, data: string) => bot.handleUpdate({ update_id: updateId++, callback_query: {
  id: randomUUID(), from: from(userId), chat_instance: 'ci', data,
  message: { message_id: 1, date: 0, chat: chatOf(userId), text: 'x' },
} } as never);
const say = (bot: Telegraf<any>, userId: string, text: string, chatType: 'private' | 'group' = 'private') => bot.handleUpdate({ update_id: updateId++, message: {
  message_id: ++messageId, date: 0, chat: { ...chatOf(userId), type: chatType }, from: from(userId), text,
  ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }] } : {}),
} } as never);
const sent = (token: string, chat: string, since = 0) => calls.slice(since).filter(c => c.token === token && !c.failed
  && String(c.body.chat_id) === chat && ['sendMessage', 'editMessageText'].includes(c.method)).map(c => String(c.body.text));
const taxiMsgs = (chat: string, since = 0) => sent(TAXI_TOKEN, chat, since);
const custMsgs = (chat: string, since = 0) => sent(CUSTOMER_TOKEN, chat, since);
const buttons = (c: Call) => JSON.stringify(c.body.reply_markup ?? '');
const call = (method: 'GET' | 'POST', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1/restaurant${url}`, payload: payload as object | undefined, headers: { authorization: `Bearer ${token}` } });
async function loginToken(slug: string, password: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/v1/restaurant/auth/login', payload: { slug, password }, remoteAddress: ip() });
  assert.equal(r.statusCode, 200);
  return r.json().accessToken;
}
const row = (id: string) => db.order.findUniqueOrThrow({ where: { id } });
const dispatchOf = (orderId: string, attemptNo = 1) => db.taxiDispatch.findUniqueOrThrow({ where: { orderId_attemptNo: { orderId, attemptNo } } });
const events = async (orderId: string) => (await db.orderEvent.findMany({ where: { orderId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(e => e.action);

/** MOCK order driven through the real services up to PREPARING; the scheduled dispatch is returned. */
async function preparingOrder(companyId: string, allowTaxiFallback = false) {
  const productId = (await db.product.create({ data: { restaurantId: ids.a!, name: `P${productIds.length}`, priceSom: randomInt(10_000, 900_000) } })).id;
  productIds.push(productId);
  const o = (await placeOrder(engine, {
    restaurantId: ids.a!, telegramUserId: customerTg, customerName: 'Tester', phone: '+998901234567', addressText: 'Test manzil 5',
    taxiCompanyId: companyId, checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'MOCK', allowTaxiFallback,
    items: [{ productId, quantity: 1 }],
  }))!;
  assert.equal((await call('POST', `/orders/${o.id}/accept`, tokenA, { prepMinutes: 20 })).statusCode, 200);
  await engine.ingestMock(BigInt(o.totalSom) * 100n, last4);
  await takeStaffAction({ actorTelegramId: staffA, orderId: o.id, action: 'VERIFY_PAYMENT' });
  assert.equal((await call('POST', `/orders/${o.id}/preparing`, tokenA, { prepMinutes: 10 })).statusCode, 200);
  return { order: o, dispatch: await dispatchOf(o.id) };
}
const makeDue = (id: string) => db.taxiDispatch.update({ where: { id }, data: { dueAt: new Date(Date.now() - 1000) } });
/** Brings a freshly prepared order's dispatch to REQUESTED on the taxi bot. */
async function requested(companyId: string, allowTaxiFallback = false) {
  const { order, dispatch } = await preparingOrder(companyId, allowTaxiFallback);
  await makeDue(dispatch.id);
  await runCycle(customerBot, order.id, taxiBot);
  return { order, dispatch: await db.taxiDispatch.findUniqueOrThrow({ where: { id: dispatch.id } }) };
}
/** Fixture rows (clearly synthetic, deleted afterwards) for states the MOCK flow cannot reach: a verified non-test payment. */
async function fixture(o: { orderStatus: string; dispatchStatus: string; payStatus?: string; payTest?: boolean; orderTest?: boolean; company?: string }) {
  const customer = await db.customer.create({ data: { telegramUserId: String(randomInt(800000000001, 899999999999)), displayName: 'Fixture' } });
  fixtureCustomers.push(customer.id);
  const som = 21_000;
  const payStatus = o.payStatus ?? 'CONFIRMED_MANUAL';
  const tx = !o.payTest && ['CONFIRMED_MANUAL', 'MATCHED_UNVERIFIED'].includes(payStatus)
    ? (await db.incomingTransaction.create({ data: { sourceId: `tx6d-${randomUUID()}`, source: 'test', cardLast4: '0000', amountTiyin: BigInt(som) * 100n, occurredAt: new Date() } })).id : undefined;
  const order = await db.order.create({ data: {
    restaurantId: ids.a!, customerId: customer.id, addressText: 'Fixture manzil', phoneSnapshot: '+998901234567', totalSom: som,
    createdViaBot: true, status: o.orderStatus as never, paymentIsTest: o.orderTest ?? false, taxiCompanyId: o.company ?? companyA,
    payment: { create: { restaurantId: ids.a!, amountTiyin: BigInt(som) * 100n, status: payStatus, isTest: o.payTest ?? false, matchedTransactionId: tx } },
  } });
  const dispatch = await db.taxiDispatch.create({ data: { orderId: order.id, taxiCompanyId: o.company ?? companyA, attemptNo: 1, status: o.dispatchStatus as never, dueAt: new Date() } });
  return { order, dispatch };
}

before(async () => {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  apiRoot = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  ids.a = (await db.restaurant.create({ data: { slug: slugA, name: `TX Resto ${nonce}`, staffTelegramUserId: staffA, staffLinkedAt: new Date(Date.now() - 60_000), pickupAddress: 'Pickup ko‘chasi 1', pickupPhone: '+998900000001' } })).id;
  await setRestaurantPassword({ slug: slugA, password: PW_A });
  companyA = (await db.taxiCompany.create({ data: { name: `TX A ${nonce}`, isActive: true } })).id;   // operator linked through the bot below
  companyB = (await db.taxiCompany.create({ data: { name: `TX B ${nonce}`, isActive: true, operatorTelegramUserId: opB, operatorLinkedAt: new Date() } })).id;
  companyC = (await db.taxiCompany.create({ data: { name: `TX C ${nonce}`, isActive: true } })).id;
  for (;;) {
    const c = String(randomInt(1000, 9999));
    if (await db.card.findUnique({ where: { last4: c } })) continue;
    last4 = c; await engine.addCard(c, true, ids.a!); break;
  }
  customerBot = createClientBot(CUSTOMER_TOKEN, engine, { apiRoot });
  customerBot.botInfo = await customerBot.telegram.getMe();
  taxiBot = createTaxiBot(TAXI_TOKEN, { apiRoot });
  taxiBot.botInfo = await taxiBot.telegram.getMe();
  tokenA = await loginToken(slugA, PW_A);
  const worker = await import('../modules/taxi/worker.js');
  runCycle = worker.runTaxiDispatchCycle as typeof runCycle;
});
after(async () => {
  const rids = Object.values(ids);
  const orders = (await db.order.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(o => o.id);
  await db.$transaction(async tx => { // ledger rows are append-only; this switch exists for exactly this cleanup
    await tx.$executeRaw`SELECT set_config('ds.ledger_cleanup', 'on', true)`;
    await tx.commissionEvent.deleteMany({ where: { entry: { restaurantId: { in: rids } } } });
    await tx.commissionEntry.deleteMany({ where: { restaurantId: { in: rids } } });
  });
  await db.refundRequest.deleteMany({ where: { orderId: { in: orders } } });
  const pays = await db.payment.findMany({ where: { restaurantId: { in: rids } }, select: { id: true, matchedTransactionId: true } });
  await db.incomingTransaction.deleteMany({ where: { OR: [{ matchedPaymentId: { in: pays.map(p => p.id) } }, { cardLast4: last4 }, { id: { in: pays.map(p => p.matchedTransactionId).filter((x): x is string => !!x) } }] } });
  await db.restaurantLoginAttempt.deleteMany({ where: { keyHash: { in: [attemptKey('slug', slugA)].concat(ips.map(i => attemptKey('ip', i))) } } });
  await db.notificationLog.deleteMany({ where: { orderId: { in: orders } } });
  await db.taxiDispatch.deleteMany({ where: { orderId: { in: orders } } });
  await db.payment.deleteMany({ where: { id: { in: pays.map(p => p.id) } } });
  const cards = await db.card.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } });
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards.map(c => c.id) } } });
  await db.card.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.order.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.customer.deleteMany({ where: { OR: [{ telegramUserId: customerTg }, { id: { in: fixtureCustomers } }] } });
  await db.product.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.restaurant.deleteMany({ where: { id: { in: rids } } });
  await db.taxiOperatorInvite.deleteMany({ where: { taxiCompanyId: { in: [companyA, companyB, companyC] } } });
  await db.taxiCompany.deleteMany({ where: { id: { in: [companyA, companyB, companyC] } } });
  await app.close();
  await new Promise<void>(r => server.close(() => r()));
  await db.$disconnect();
  await appDb.$disconnect();
});

// ------------------------------------------------------------------------------------------------ linking
test('operator link codes: hashed, one-time, rate limited, one Telegram account per company', async () => {
  resetLinkRateLimit();
  const unlinked = await db.taxiCompany.findUniqueOrThrow({ where: { id: companyA } });
  assert.equal(unlinked.operatorTelegramUserId, null);
  const m0 = calls.length;
  await say(taxiBot, rando, '/taxi');
  assert.ok(taxiMsgs(rando, m0).some(t => t.includes('/link')), 'unlinked account is told how to link');
  await say(taxiBot, rando, '/link ABCDE-FGHJK');
  assert.ok(taxiMsgs(rando, m0).some(t => t.includes('noto‘g‘ri')), 'unknown code rejected');

  const invite = await createOperatorInvite(`TX A ${nonce}`, 'test-admin');
  const stored = await db.taxiOperatorInvite.findFirstOrThrow({ where: { taxiCompanyId: companyA } });
  assert.notEqual(stored.codeHash, invite.code);
  assert.ok(!stored.codeHash.includes(invite.code.replace('-', '')), 'only a hash is stored');
  // another operator (already linked to company B) cannot take company A with a valid code
  const m1 = calls.length;
  await say(taxiBot, opB, `/link ${invite.code}`);
  assert.ok(taxiMsgs(opB, m1).some(t => t.includes('boshqa taksi kompaniyasiga')));
  assert.equal((await db.taxiOperatorInvite.findUniqueOrThrow({ where: { id: stored.id } })).usedAt, null);
  // two chats race with the same code: exactly one wins
  await Promise.all([say(taxiBot, opA, `/start ${invite.code}`), say(taxiBot, rando, `/link ${invite.code.toLowerCase()}`)]);
  const company = await db.taxiCompany.findUniqueOrThrow({ where: { id: companyA } });
  assert.ok([opA, rando].includes(company.operatorTelegramUserId!));
  if (company.operatorTelegramUserId !== opA) {
    // the race went the other way; relink the intended operator with a fresh code so the rest of the suite is deterministic
    await db.taxiCompany.update({ where: { id: companyA }, data: { operatorTelegramUserId: opA } });
  }
  assert.ok((await db.taxiOperatorInvite.findUniqueOrThrow({ where: { id: stored.id } })).usedAt, 'code consumed');
  const m2 = calls.length;
  await say(taxiBot, opA, `/link ${invite.code}`);
  assert.ok(taxiMsgs(opA, m2).some(t => t.includes('noto‘g‘ri')), 'a used code is dead');
  // expired code
  const expired = await createOperatorInvite(`TX C ${nonce}`, 'test-admin', new Date(Date.now() - 48 * 3_600_000));
  const m3 = calls.length;
  await say(taxiBot, rando, `/link ${expired.code}`);
  assert.ok(taxiMsgs(rando, m3).some(t => t.includes('noto‘g‘ri')));
  assert.equal((await db.taxiCompany.findUniqueOrThrow({ where: { id: companyC } })).operatorTelegramUserId, null);
  // brute force: 5 failures lock the account out, even for a valid code
  resetLinkRateLimit();
  for (let i = 0; i < 5; i++) await say(taxiBot, rando, `/link ZZZZZ-ZZZZ${i + 2}`);
  const good = await createOperatorInvite(`TX C ${nonce}`, 'test-admin');
  const m4 = calls.length;
  await say(taxiBot, rando, `/link ${good.code}`);
  assert.ok(taxiMsgs(rando, m4).some(t => t.includes('Juda ko‘p')));
  assert.equal((await db.taxiCompany.findUniqueOrThrow({ where: { id: companyC } })).operatorTelegramUserId, null);
  resetLinkRateLimit();
  // group chats are ignored entirely
  const m5 = calls.length;
  await say(taxiBot, opA, '/taxi', 'group');
  assert.equal(calls.slice(m5).filter(c => c.token === TAXI_TOKEN).length, 0);
});

// ------------------------------------------------------------------------------------------------ automatic dispatch
test('dispatch is scheduled automatically at "preparing", not sent early, and sent once to the right operator on the taxi bot', async () => {
  const { order, dispatch } = await preparingOrder(companyA);
  assert.equal(dispatch.status, 'SCHEDULED');
  // prep 10 min, lead 7 min => due about 3 minutes after cooking started, never before
  const delay = dispatch.dueAt.getTime() - (await row(order.id)).preparingStartedAt!.getTime();
  assert.ok(delay > 2 * 60_000 && delay < 4 * 60_000, `due after ${delay}ms`);
  const m0 = calls.length;
  await runCycle(customerBot, order.id, taxiBot);
  assert.equal(taxiMsgs(opA, m0).length, 0, 'not due yet: nothing sent');
  await makeDue(dispatch.id);
  await Promise.all([runCycle(customerBot, order.id, taxiBot), runCycle(customerBot, order.id, taxiBot)]);
  await runCycle(customerBot, order.id, taxiBot);
  const msgs = taxiMsgs(opA, m0).filter(t => t.includes(`#${order.code}`));
  assert.equal(msgs.length, 1, 'exactly one booking request, no duplicates');
  const text = msgs[0]!;
  assert.ok(text.includes('Pickup ko‘chasi 1') && text.includes('Test manzil 5') && text.includes('+998901234567'));
  assert.ok(text.includes('MOCK'), 'test order is labelled');
  assert.ok(!new RegExp(`\\*{0,3}${last4}`).test(text) || !text.includes('karta'), 'no payment credentials');
  // Owner decision 2026-10-25: the operator is told whether the food is already paid by card or must be paid in cash - that one line and nothing else about payment.
  assert.ok(text.includes('✅ Taom puli kartadan to‘langan'), 'a card order says it is already paid');
  assert.ok(!/karta|card|payment|to‘lov rekviz/i.test(text.replace(/^✅ Taom puli kartadan to‘langan.*$/m, '')), 'no other payment details in the booking');
  const req = calls.slice(m0).find(c => c.token === TAXI_TOKEN && String(c.body.chat_id) === opA && String(c.body.text).includes(`#${order.code}`))!;
  assert.ok(buttons(req).includes('taxi:acc:') && buttons(req).includes('taxi:none:'), 'Qabul qilish / Rad etish');
  assert.ok(!buttons(req).includes('taxi:sent:'), '"Taksi yuborildi" is not offered before acceptance');
  assert.equal(calls.slice(m0).filter(c => c.token === CUSTOMER_TOKEN && String(c.body.chat_id) === opA).length, 0, 'the customer bot never talks to operators');
  const d = await dispatchOf(order.id);
  assert.equal(d.status, 'REQUESTED');
  assert.equal(d.taxiCompanyId, companyA);
  assert.ok(d.expiresAt);
});

test('allowlist blocks a request to a non-allowlisted operator; nothing is sent', async () => {
  const { order, dispatch } = await preparingOrder(companyB);
  await makeDue(dispatch.id);
  const m0 = calls.length;
  await runCycle(customerBot, order.id, taxiBot);
  assert.equal(calls.slice(m0).filter(c => String(c.body.chat_id) === opB).length, 0);
  assert.equal((await dispatchOf(order.id)).status, 'NEEDS_HELP');
});

// ------------------------------------------------------------------------------------------------ operator workflow
test('request -> accept -> dispatched: ordered, company-isolated, exactly-once, notifies customer and restaurant once', async () => {
  const { order, dispatch } = await requested(companyA);
  const m0 = calls.length;
  // a booking notification is not an accepted booking; nothing else may skip ahead
  await press(taxiBot, opA, `taxi:sent:${dispatch.id}`);
  await press(taxiBot, opA, `taxi:dlvok:${dispatch.id}`);
  assert.equal((await dispatchOf(order.id)).status, 'REQUESTED');
  // company isolation: B's operator, a stranger and a customer cannot even see it
  for (const who of [opB, rando]) {
    const m = calls.length;
    for (const verb of ['view', 'acc', 'none', 'sent', 'dlvok']) await press(taxiBot, who, `taxi:${verb}:${dispatch.id}`);
    assert.ok(taxiMsgs(who, m).every(t => t.includes('Ruxsat yo‘q')), 'every action denied');
  }
  await press(customerBot, customerTg, `taxi:acc:${dispatch.id}`); // the customer bot has no taxi handlers
  assert.equal((await dispatchOf(order.id)).status, 'REQUESTED');
  // concurrent duplicate accept presses: one wins
  await Promise.all([1, 2, 3].map(() => press(taxiBot, opA, `taxi:acc:${dispatch.id}`)));
  const accepted = await dispatchOf(order.id);
  assert.equal(accepted.status, 'ACCEPTED');
  assert.equal(accepted.acceptedBy, opA);
  assert.ok(accepted.acceptedAt);
  assert.equal((await events(order.id)).filter(a => a === 'TAXI_ACCEPTED').length, 1);
  assert.ok(taxiMsgs(opA, m0).some(t => t.includes('qabul qilindi')), 'operator sees the next action');
  const next = calls.slice(m0).find(c => c.token === TAXI_TOKEN && buttons(c).includes('taxi:sent:'));
  assert.ok(next, '"Taksi yuborildi" appears after acceptance');
  // restaurant app sees it (after refresh)
  assert.equal((await call('GET', `/orders/${order.id}`, tokenA)).json().taxi.stage, 'ACCEPTED');
  // customer + staff are told exactly once, even across repeated worker cycles
  const m1 = calls.length;
  await runCycle(customerBot, order.id, taxiBot);
  await runCycle(customerBot, order.id, taxiBot);
  assert.equal(custMsgs(customerTg, m1).filter(t => t.includes(`#${order.code}`)).length, 0, 'Stage 9: "operator accepted" is internal, the customer is told nothing yet');
  assert.equal(custMsgs(staffA, m1).length, 0, 'restaurant staff are no longer notified through Telegram (RESTAURANT_TELEGRAM_ENABLED is off)');
  // dispatched
  await Promise.all([1, 2].map(() => press(taxiBot, opA, `taxi:sent:${dispatch.id}`)));
  const sentRow = await dispatchOf(order.id);
  assert.equal(sentRow.status, 'ASSIGNED');
  assert.equal(sentRow.dispatchedBy, opA);
  assert.equal((await events(order.id)).filter(a => a === 'TAXI_DRIVER_SENT').length, 1);
  assert.equal((await call('GET', `/orders/${order.id}`, tokenA)).json().taxi.stage, 'DISPATCHED');
  const m2 = calls.length;
  await runCycle(customerBot, order.id, taxiBot);
  await runCycle(customerBot, order.id, taxiBot);
  assert.equal(custMsgs(customerTg, m2).filter(t => t.includes(`#${order.code}`) && t.includes('yo‘lda')).length, 1);
  assert.equal(custMsgs(staffA, m2).length, 0);
  assert.equal(await db.commissionEntry.count({ where: { orderId: order.id } }), 0, 'dispatch never accrues commission');
  assert.equal((await row(order.id)).status, 'PREPARING', 'dispatch alone never changes the order');
});

test('delivery completion: premature, wrong company and stale presses are refused; two-step confirmation; exactly once; MOCK order earns no commission', async () => {
  const { order, dispatch } = await requested(companyA);
  await press(taxiBot, opA, `taxi:acc:${dispatch.id}`);
  const m0 = calls.length;
  await press(taxiBot, opA, `taxi:dlv:${dispatch.id}`); // not dispatched yet
  assert.ok(taxiMsgs(opA, m0).some(t => t.includes('Avval')));
  await press(taxiBot, opA, `taxi:sent:${dispatch.id}`);
  const m1 = calls.length;
  await press(taxiBot, opA, `taxi:dlv:${dispatch.id}`);
  const ask = calls.slice(m1).find(c => c.token === TAXI_TOKEN && buttons(c).includes('taxi:dlvok:'))!;
  assert.ok(ask, 'a second confirmation is required');
  assert.equal((await dispatchOf(order.id)).status, 'ASSIGNED', 'the first press changes nothing');
  // food not ready yet
  await press(taxiBot, opA, `taxi:dlvok:${dispatch.id}`);
  assert.equal((await dispatchOf(order.id)).status, 'ASSIGNED');
  assert.equal((await row(order.id)).status, 'PREPARING');
  await assert.rejects(completeDelivery({ actorTelegramId: opA, dispatchId: dispatch.id }), /BUYURTMA_HALI_TAYYOR_EMAS/);
  await takeStaffAction({ actorTelegramId: staffA, orderId: order.id, action: 'MARK_READY' });
  // only the assigned company's operator
  for (const who of [opB, rando]) await assert.rejects(completeDelivery({ actorTelegramId: who, dispatchId: dispatch.id }), /RUXSAT_YOQ/);
  const rs = await Promise.allSettled([1, 2, 3, 4].map(() => completeDelivery({ actorTelegramId: opA, dispatchId: dispatch.id })));
  assert.equal(rs.filter(r => r.status === 'fulfilled' && r.value.changed).length, 1, 'exactly one completion');
  assert.equal(rs.filter(r => r.status === 'rejected').length, 0, 'duplicates are harmless no-ops');
  assert.equal((await row(order.id)).status, 'COMPLETED');
  const d = await dispatchOf(order.id);
  assert.equal(d.status, 'DELIVERED');
  assert.equal(d.deliveredBy, opA);
  assert.ok(d.deliveredAt);
  assert.equal((await events(order.id)).filter(a => a === 'DELIVERY_CONFIRMED').length, 1);
  const ev = await db.orderEvent.findFirstOrThrow({ where: { orderId: order.id, action: 'DELIVERY_CONFIRMED' } });
  assert.equal(ev.actorTelegramId, opA);
  assert.equal(ev.actorType, 'TAXI_OPERATOR');
  assert.equal(ev.toStatus, 'COMPLETED');
  assert.equal(await db.commissionEntry.count({ where: { orderId: order.id } }), 0, 'MOCK/test orders never accrue commission');
  // a late duplicate press from Telegram
  const m2 = calls.length;
  await press(taxiBot, opA, `taxi:dlvok:${dispatch.id}`);
  assert.ok(taxiMsgs(opA, m2).some(t => t.includes('avval tasdiqlangan')));
  assert.equal((await events(order.id)).filter(a => a === 'DELIVERY_CONFIRMED').length, 1);
  // no new dispatch can be created for a delivered order
  await assert.rejects(db.taxiDispatch.create({ data: { orderId: order.id, taxiCompanyId: companyB, attemptNo: 2, status: 'SCHEDULED', dueAt: new Date() } }), /only_one_active|Unique/);
  // customer + restaurant notice, once
  const m3 = calls.length;
  await runCycle(customerBot, order.id, taxiBot);
  await runCycle(customerBot, order.id, taxiBot);
  assert.equal(custMsgs(customerTg, m3).filter(t => t.includes(`#${order.code}`) && t.includes('yetkazildi')).length, 1);
  const api = (await call('GET', `/orders/${order.id}`, tokenA)).json();
  assert.equal(api.status, 'COMPLETED');
  assert.equal(api.taxi.stage, 'DELIVERED');
  assert.deepEqual(api.allowedActions, []);
});

test('commission: a verified non-test order earns the flat 5000 UZS exactly once; payment/refund/cancel guards hold', async () => {
  const real = await fixture({ orderStatus: 'READY', dispatchStatus: 'ASSIGNED' });
  const rs = await Promise.allSettled([1, 2, 3].map(() => completeDelivery({ actorTelegramId: opA, dispatchId: real.dispatch.id })));
  assert.equal(rs.filter(r => r.status === 'fulfilled' && r.value.changed).length, 1);
  const entries = await db.commissionEntry.findMany({ where: { orderId: real.order.id } });
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.amountSom, 5000);
  assert.equal(entries[0]!.orderTotalSom, 21_000, 'flat amount, not a percentage of the order');
  await completeDelivery({ actorTelegramId: opA, dispatchId: real.dispatch.id });
  assert.equal(await db.commissionEntry.count({ where: { orderId: real.order.id } }), 1, 'a repeat never posts twice');
  // unverified payment
  const unpaid = await fixture({ orderStatus: 'READY', dispatchStatus: 'ASSIGNED', payStatus: 'MATCHED_UNVERIFIED' });
  await assert.rejects(completeDelivery({ actorTelegramId: opA, dispatchId: unpaid.dispatch.id }), /TOLOV_TASDIQLANMAGAN/);
  assert.equal((await row(unpaid.order.id)).status, 'READY');
  // cancelled / cancellation requested
  for (const status of ['CANCELLATION_REQUESTED', 'CANCELLED']) {
    const f = await fixture({ orderStatus: status, dispatchStatus: 'ASSIGNED' });
    await assert.rejects(completeDelivery({ actorTelegramId: opA, dispatchId: f.dispatch.id }), /BUYURTMA_BEKOR_QILINGAN/);
    assert.equal((await row(f.order.id)).status, status);
  }
  // refund in progress
  const refunded = await fixture({ orderStatus: 'READY', dispatchStatus: 'ASSIGNED' });
  const pay = await db.payment.findUniqueOrThrow({ where: { orderId: refunded.order.id } });
  await db.refundRequest.create({ data: { orderId: refunded.order.id, paymentId: pay.id, kind: 'CUSTOMER_CANCEL', status: 'REQUESTED', reasonCode: 'CHANGED_MIND',
    paidAmountTiyin: pay.amountTiyin, orderStatusBefore: 'READY', paymentStatusAtRequest: pay.status, requestedBy: 'c', requestedByType: 'CUSTOMER' } });
  await assert.rejects(completeDelivery({ actorTelegramId: opA, dispatchId: refunded.dispatch.id }), /QAYTARISH_JARAYONIDA/);
  assert.equal(await db.commissionEntry.count({ where: { orderId: refunded.order.id } }), 0);
  // test payment on a real-looking order never earns commission either
  const test = await fixture({ orderStatus: 'READY', dispatchStatus: 'ASSIGNED', payTest: true, orderTest: true });
  const t = await completeDelivery({ actorTelegramId: opA, dispatchId: test.dispatch.id });
  assert.ok(t.changed && t.commission.result === 'NOT_ELIGIBLE');
  assert.equal(await db.commissionEntry.count({ where: { orderId: test.order.id } }), 0);
});

// ------------------------------------------------------------------------------------------------ rejection, timeout, fallback
test('rejection follows the consented-fallback rule and never auto-switches without consent', async () => {
  const noConsent = await requested(companyA, false);
  await press(taxiBot, opA, `taxi:none:${noConsent.dispatch.id}`);
  assert.equal((await dispatchOf(noConsent.order.id)).status, 'DECLINED');
  assert.equal(await db.taxiDispatch.count({ where: { orderId: noConsent.order.id } }), 1, 'no second company without the customer\'s consent');
  const m0 = calls.length;
  await runCycle(customerBot, noConsent.order.id, taxiBot);
  assert.equal(custMsgs(customerTg, m0).filter(t => t.includes(`#${noConsent.order.code}`) && t.includes('taksi topilmadi')).length, 1);
  assert.equal((await call('GET', `/orders/${noConsent.order.id}`, tokenA)).json().taxi.stage, 'NEEDS_HELP');

  const consent = await requested(companyA, true);
  await press(taxiBot, opA, `taxi:acc:${consent.dispatch.id}`);
  await press(taxiBot, opA, `taxi:none:${consent.dispatch.id}`); // accepted, then cannot supply a car
  assert.equal((await dispatchOf(consent.order.id)).status, 'DECLINED');
  // Stage 7A: the fallback only considers companies that can actually be reached (TAXI_OPERATOR_ALLOWLIST), so no dead attempt is queued.
  assert.equal(await db.taxiDispatch.count({ where: { orderId: consent.order.id, attemptNo: 2 } }), 0, 'an unreachable fallback company is never given an attempt');
  const m1 = calls.length;
  await runCycle(customerBot, consent.order.id, taxiBot);
  assert.equal(taxiMsgs(opB, m1).length, 0, 'the non-allowlisted operator is never messaged');
  assert.equal(await db.taxiDispatch.count({ where: { orderId: consent.order.id, status: { in: ['SCHEDULED', 'SENDING', 'REQUESTED', 'ACCEPTED', 'ASSIGNED', 'CANCELLATION_PENDING'] } } }), 0, 'no second car is arranged');
});

test('timeouts escalate instead of redispatching; an accepted booking that never leaves is flagged', async () => {
  const { order, dispatch } = await requested(companyA, true);
  await db.taxiDispatch.update({ where: { id: dispatch.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const m0 = calls.length;
  await runCycle(customerBot, order.id, taxiBot);
  assert.equal((await dispatchOf(order.id)).status, 'CANCELLATION_PENDING');
  assert.ok(taxiMsgs(opA, m0).some(t => t.includes('javob muddati tugadi')), 'operator is asked to clarify on the taxi bot');
  assert.equal(await db.taxiDispatch.count({ where: { orderId: order.id } }), 1, 'silence never causes a second car');
  // the late operator may still say the driver was sent
  await press(taxiBot, opA, `taxi:sent:${dispatch.id}`);
  assert.equal((await dispatchOf(order.id)).status, 'ASSIGNED');

  const stuck = await requested(companyA);
  await press(taxiBot, opA, `taxi:acc:${stuck.dispatch.id}`);
  await db.taxiDispatch.update({ where: { id: stuck.dispatch.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await runCycle(customerBot, stuck.order.id, taxiBot);
  assert.equal((await dispatchOf(stuck.order.id)).status, 'NEEDS_HELP');
  assert.equal(await db.taxiDispatch.count({ where: { orderId: stuck.order.id } }), 1);
  assert.equal((await call('GET', `/orders/${stuck.order.id}`, tokenA)).json().taxi.stage, 'NEEDS_HELP');
});

test('failed Telegram delivery to the operator never resends blindly; bot restart recovers from the database', async () => {
  const failing = await preparingOrder(companyA);
  await makeDue(failing.dispatch.id);
  failChats.add(opA);
  await runCycle(customerBot, failing.order.id, taxiBot);
  failChats.clear();
  assert.equal((await dispatchOf(failing.order.id)).status, 'NEEDS_HELP');
  const m0 = calls.length;
  await runCycle(customerBot, failing.order.id, taxiBot);
  assert.equal(taxiMsgs(opA, m0).filter(t => t.includes('yangi yetkazish')).length, 0, 'no automatic resend after an uncertain send');
  // an interrupted send (stale lease) is never re-sent either
  const crashed = await preparingOrder(companyA);
  await db.taxiDispatch.update({ where: { id: crashed.dispatch.id }, data: { status: 'SENDING', leaseAt: new Date(Date.now() - 5 * 60_000) } });
  const m1 = calls.length;
  await runCycle(customerBot, crashed.order.id, taxiBot);
  assert.equal((await dispatchOf(crashed.order.id)).status, 'NEEDS_HELP');
  assert.equal(taxiMsgs(opA, m1).filter(t => t.includes(`#${crashed.order.code}`) && t.includes('yangi yetkazish')).length, 0);
  // "restart": brand-new bot instances pick up an already REQUESTED dispatch and continue the flow
  const live = await requested(companyA);
  const freshTaxiBot = createTaxiBot(TAXI_TOKEN, { apiRoot });
  freshTaxiBot.botInfo = await freshTaxiBot.telegram.getMe();
  const freshCustomerBot = createClientBot(CUSTOMER_TOKEN, engine, { apiRoot });
  freshCustomerBot.botInfo = await freshCustomerBot.telegram.getMe();
  const m2 = calls.length;
  await runCycle(freshCustomerBot, live.order.id, freshTaxiBot);
  assert.equal(taxiMsgs(opA, m2).filter(t => t.includes(`#${live.order.code}`)).length, 0, 'no duplicate request after a restart');
  await press(freshTaxiBot, opA, `taxi:acc:${live.dispatch.id}`);
  assert.equal((await dispatchOf(live.order.id)).status, 'ACCEPTED');
});

test('one active dispatch per order is enforced by the database for every active state', async () => {
  const { order } = await preparingOrder(companyA);
  for (const status of ['SCHEDULED', 'ACCEPTED', 'DELIVERED'] as const) {
    await db.taxiDispatch.updateMany({ where: { orderId: order.id }, data: { status } });
    await assert.rejects(db.taxiDispatch.create({ data: { orderId: order.id, taxiCompanyId: companyB, attemptNo: 9, status: 'SCHEDULED', dueAt: new Date() } }), /Unique|only_one_active/, status);
  }
  await db.taxiDispatch.updateMany({ where: { orderId: order.id }, data: { status: 'DECLINED' } });
  await db.taxiDispatch.create({ data: { orderId: order.id, taxiCompanyId: companyB, attemptNo: 9, status: 'SCHEDULED', dueAt: new Date() } }); // a declined one no longer blocks
});

test('the customer bot defers to the taxi bot and exposes no operator tools when TAXI_BOT_TOKEN is set', async () => {
  process.env.TAXI_BOT_TOKEN = TAXI_TOKEN.replace('222222222', '333333333');
  try {
    const bot = createClientBot(CUSTOMER_TOKEN, engine, { apiRoot });
    bot.botInfo = await bot.telegram.getMe();
    const m0 = calls.length;
    await say(bot, opA, '/taxi');
    assert.ok(custMsgs(opA, m0).some(t => t.includes('alohida')));
  } finally { delete process.env.TAXI_BOT_TOKEN; }
});

// ------------------------------------------------------------------------------------------------ order #645 regression
test('#645: one logical notification per chat and event, even when customer and restaurant staff are the same Telegram account', async () => {
  const previous = process.env.RESTAURANT_TELEGRAM_ENABLED;
  process.env.RESTAURANT_TELEGRAM_ENABLED = 'true'; // legacy panel ON: both "roles" are addressed - and the account is the same
  const { order, dispatch } = await requested(companyA);
  await db.restaurant.update({ where: { id: ids.a! }, data: { staffTelegramUserId: customerTg } });
  try {
    await press(taxiBot, opA, `taxi:acc:${dispatch.id}`);
    await press(taxiBot, opA, `taxi:sent:${dispatch.id}`);
    const worker2Customer = createClientBot(CUSTOMER_TOKEN, engine, { apiRoot });
    worker2Customer.botInfo = await worker2Customer.telegram.getMe();
    const m0 = calls.length;
    // several workers (two bot instances = two processes) cycle at the same time, many times
    await Promise.all([1, 2, 3].flatMap(() => [runCycle(customerBot, order.id, taxiBot), runCycle(worker2Customer, order.id, taxiBot)]));
    const sentMsgs = () => custMsgs(customerTg, m0).filter(t => t.includes(`#${order.code}`) && t.includes('yo‘lda'));
    assert.equal(sentMsgs().length, 1, '"taxi sent": one message although two roles and two workers');
    // a restart that lost the in-row markers must not repeat it either: the durable log is the authority
    await db.taxiDispatch.update({ where: { id: dispatch.id }, data: { customerNotifiedAt: null, staffNotifiedAt: null } });
    await runCycle(customerBot, order.id, taxiBot);
    assert.equal(sentMsgs().length, 1, 'no repeat after the markers were reset');
    const keys = await db.notificationLog.findMany({ where: { orderId: order.id, kind: 'taxi-outcome' } });
    assert.equal(keys.filter(k => k.dedupeKey.includes(':ASSIGNED:')).length, 1, 'one durable key per (dispatch state, chat)');
    assert.ok(keys.every(k => k.sentAt));
    assert.equal(await db.notificationLog.count({ where: { dedupeKey: keys[0]!.dedupeKey } }), 1);
    // food ready -> delivery confirmed: exactly one completion, one commission decision, one "delivered" message
    await takeStaffAction({ actorTelegramId: customerTg, orderId: order.id, action: 'MARK_READY' });
    const m1 = calls.length;
    const completions = await Promise.allSettled([1, 2, 3, 4].map(() => completeDelivery({ actorTelegramId: opA, dispatchId: dispatch.id })));
    assert.equal(completions.filter(r => r.status === 'fulfilled' && r.value.changed).length, 1);
    await Promise.all([1, 2, 3].flatMap(() => [runCycle(customerBot, order.id, taxiBot), runCycle(worker2Customer, order.id, taxiBot)]));
    await db.taxiDispatch.update({ where: { id: dispatch.id }, data: { customerNotifiedAt: null, staffNotifiedAt: null } });
    await runCycle(customerBot, order.id, taxiBot);
    assert.equal(custMsgs(customerTg, m1).filter(t => t.includes(`#${order.code}`) && t.includes('yetkazildi')).length, 1, '"delivered": one message');
    assert.equal((await events(order.id)).filter(a => a === 'DELIVERY_CONFIRMED').length, 1);
    assert.equal(await db.commissionEntry.count({ where: { orderId: order.id } }), 0, 'MOCK order: no commission, and certainly not two');
    assert.equal(await db.taxiDispatch.count({ where: { orderId: order.id } }), 1);
  } finally {
    await db.restaurant.update({ where: { id: ids.a! }, data: { staffTelegramUserId: staffA } });
    process.env.RESTAURANT_TELEGRAM_ENABLED = previous;
    if (previous === undefined) delete process.env.RESTAURANT_TELEGRAM_ENABLED;
  }
});

test('failed Telegram delivery is retried without ever sending twice', async () => {
  const { order, dispatch } = await requested(companyA);
  await press(taxiBot, opA, `taxi:acc:${dispatch.id}`);
  await press(taxiBot, opA, `taxi:sent:${dispatch.id}`);
  const m0 = calls.length;
  failChats.add(customerTg);
  await runCycle(customerBot, order.id, taxiBot);
  await runCycle(customerBot, order.id, taxiBot);
  const log = await db.notificationLog.findFirstOrThrow({ where: { orderId: order.id, dedupeKey: { contains: ':ASSIGNED:' } } });
  assert.equal(log.sentAt, null);
  assert.ok(log.attempts >= 2 && log.lastError);
  failChats.clear();
  await runCycle(customerBot, order.id, taxiBot);
  await runCycle(customerBot, order.id, taxiBot);
  assert.equal(custMsgs(customerTg, m0).filter(t => t.includes(`#${order.code}`) && t.includes('yo‘lda')).length, 1);
  assert.ok((await db.notificationLog.findUniqueOrThrow({ where: { id: log.id } })).sentAt);
  // an expired lease from a crashed worker is retaken; a live lease is respected
  const { sendOnce } = await import('../lib/notify-once.js');
  const fake = { telegram: { sendMessage: async () => ({ message_id: 1 }) } };
  const key = `test-lease:${randomUUID()}`;
  await db.notificationLog.create({ data: { dedupeKey: key, kind: 'test', chatId: customerTg, claimedAt: new Date(), attempts: 1 } });
  assert.equal(await sendOnce(fake as never, { key, kind: 'test', chatId: customerTg, text: 'x' }), 'IN_FLIGHT');
  assert.equal(await sendOnce(fake as never, { key, kind: 'test', chatId: customerTg, text: 'x' }, new Date(Date.now() + 120_000)), 'SENT');
  assert.equal(await sendOnce(fake as never, { key, kind: 'test', chatId: customerTg, text: 'x' }), 'ALREADY_SENT');
  const parallel = `test-par:${randomUUID()}`;
  let sends = 0;
  const slow = { telegram: { sendMessage: async () => { sends += 1; await sleep(50); return { message_id: 2 }; } } };
  const outs = await Promise.all(Array.from({ length: 8 }, () => sendOnce(slow as never, { key: parallel, kind: 'test', chatId: customerTg, text: 'x' })));
  assert.equal(sends, 1, 'eight concurrent workers, one Telegram call');
  assert.equal(outs.filter(o => o === 'SENT').length, 1);
  await db.notificationLog.deleteMany({ where: { dedupeKey: { in: [key, parallel] } } });
});
