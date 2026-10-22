import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Telegraf } from 'telegraf';
import { createClientBot } from '../bot/client.js';
import { createTaxiBot } from '../bot/taxi-bot.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { placeOrder } from '../modules/orders/service.js';
import { advanceMockOrder } from '../modules/restaurant-orders/auto.js';
import { takeStaffAction } from '../modules/restaurant/service.js';
import { adminRecoverDispatch, escalateSilentDispatch, recoverableDispatches } from '../modules/taxi/recovery.js';
import { completeDelivery, respondToTaxi } from '../modules/taxi/service.js';
import { db as appDb } from '../lib/db.js';

// Local fake Telegram only. Companies/operators are synthetic ids; nothing is sent anywhere, no payment is real.
const CUSTOMER_TOKEN = '111111111:AAFakeCustomerTokenLocalOnly_0123456789';
const TAXI_TOKEN = '222222222:BBFakeTaxiTokenLocalOnlyXXXXXXXXXXX_01';
type Call = { token: string; method: string; body: Record<string, unknown> };
const calls: Call[] = [];
let messageId = 100;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    const parts = req.url!.split('/');
    const method = parts.pop()!;
    const token = parts.pop()!.replace(/^bot/, '');
    const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    const reply = (payload: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
    if (method === 'getUpdates') { setTimeout(() => reply({ ok: true, result: [] }), 150); return; }
    if (method === 'getMe') return reply({ ok: true, result: { id: Number(token.split(':')[0]), is_bot: true, first_name: 'T', username: 'fake_bot' } });
    calls.push({ token, method, body });
    if (method === 'sendMessage' || method === 'editMessageText') {
      return reply({ ok: true, result: { message_id: ++messageId, date: 0, chat: { id: Number(body.chat_id) || 1, type: 'private' }, text: String(body.text ?? '') } });
    }
    return reply({ ok: true, result: true });
  });
});

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const nonce = randomUUID().slice(0, 8);
const customerTg = String(randomInt(700000000001, 800000000000));
const opA = String(randomInt(900000000001, 920000000000));
const opB = String(randomInt(920000000001, 940000000000));
const adminTg = String(randomInt(940000000001, 960000000000));
const rando = String(randomInt(960000000001, 999000000000));
process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = adminTg;
delete process.env.SUPPORT_ADMIN_2_TELEGRAM_ID;
process.env.TAXI_OPERATOR_ALLOWLIST = `${opA},${opB}`;
delete process.env.RESTAURANT_MANUAL_ACCEPTANCE;
delete process.env.TAXI_BOT_TOKEN;
const ids: Record<string, string> = {};
const productIds: string[] = [];
let companyA = '';
let companyB = '';
let last4 = '';
let customerBot: Telegraf<any>;
let taxiBot: Telegraf<any>;
let apiRoot = '';
let updateId = 1;
let runCycle: (bot: Telegraf<any>, orderId?: string, operatorBot?: Telegraf<any>) => Promise<void>;

const from = (id: string) => ({ id: Number(id), is_bot: false, first_name: 'Tester' });
const chatOf = (id: string) => ({ id: Number(id), type: 'private' as const, first_name: 'Tester' });
const press = (bot: Telegraf<any>, user: string, data: string) => bot.handleUpdate({ update_id: updateId++, callback_query: {
  id: randomUUID(), from: from(user), chat_instance: 'ci', data, message: { message_id: 1, date: 0, chat: chatOf(user), text: 'x' } } } as never);
const say = (bot: Telegraf<any>, user: string, text: string) => bot.handleUpdate({ update_id: updateId++, message: {
  message_id: ++messageId, date: 0, chat: chatOf(user), from: from(user), text,
  ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }] } : {}) } } as never);
const texts = (token: string, chat: string, since = 0) => calls.slice(since).filter(c => c.token === token && String(c.body.chat_id) === chat
  && ['sendMessage', 'editMessageText'].includes(c.method)).map(c => String(c.body.text));
const taxiTexts = (chat: string, since = 0) => texts(TAXI_TOKEN, chat, since);
const row = (id: string) => db.order.findUniqueOrThrow({ where: { id } });
const attempts = (orderId: string) => db.taxiDispatch.findMany({ where: { orderId }, orderBy: { attemptNo: 'asc' } });
const active = (orderId: string) => db.taxiDispatch.count({ where: { orderId, status: { in: ['SCHEDULED', 'SENDING', 'REQUESTED', 'ACCEPTED', 'CANCELLATION_PENDING', 'ASSIGNED', 'NEEDS_HELP'] } } });
const makeDue = (id: string) => db.taxiDispatch.update({ where: { id }, data: { dueAt: new Date(Date.now() - 1000) } });
const NOTE_OK = 'Operator bilan gaplashdim, haydovchi yuborilmagan';

/** MOCK order (no taxi chosen: automatic assignment) cooked automatically; returns after the first dispatch was REQUESTED. */
async function requested(opts: { fallback?: boolean; company?: string } = {}) {
  const p = await db.product.create({ data: { restaurantId: ids.a!, name: `P${productIds.length}`, priceSom: randomInt(10_000, 900_000) } });
  productIds.push(p.id);
  const o = (await placeOrder(engine, {
    restaurantId: ids.a!, telegramUserId: customerTg, customerName: 'T', phone: '+998901234567', addressText: 'Test manzil',
    ...(opts.company ? { taxiCompanyId: opts.company } : {}), checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'MOCK',
    allowTaxiFallback: opts.fallback ?? true, autoTaxi: !opts.company, items: [{ productId: p.id, quantity: 1 }],
  }))!;
  await engine.ingestMock(BigInt(o.totalSom) * 100n, last4);
  assert.equal(await advanceMockOrder(o.id), true);
  const [d] = await attempts(o.id);
  await makeDue(d!.id);
  await runCycle(customerBot, o.id, taxiBot);
  return { order: o, dispatch: (await attempts(o.id))[0]! };
}

before(async () => {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  apiRoot = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  ids.a = (await db.restaurant.create({ data: { slug: `rc-${nonce}`, name: `RC ${nonce}`, pickupAddress: 'Pickup 1', pickupPhone: '+998900000001' } })).id;
  // names sort A before B: with automatic assignment A is the first company
  companyA = (await db.taxiCompany.create({ data: { name: `RC A ${nonce}`, isActive: true, operatorTelegramUserId: opA } })).id;
  companyB = (await db.taxiCompany.create({ data: { name: `RC B ${nonce}`, isActive: true, operatorTelegramUserId: opB } })).id;
  for (;;) {
    const c = String(randomInt(1000, 9999));
    if (await db.card.findUnique({ where: { last4: c } })) continue;
    last4 = c; await engine.addCard(c, true, ids.a!); break;
  }
  customerBot = createClientBot(CUSTOMER_TOKEN, engine, { apiRoot });
  customerBot.botInfo = await customerBot.telegram.getMe();
  taxiBot = createTaxiBot(TAXI_TOKEN, { apiRoot });
  taxiBot.botInfo = await taxiBot.telegram.getMe();
  const worker = await import('../modules/taxi/worker.js');
  runCycle = worker.runTaxiDispatchCycle as typeof runCycle;
});
after(async () => {
  const rids = Object.values(ids);
  const orders = (await db.order.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(o => o.id);
  await db.notificationLog.deleteMany({ where: { orderId: { in: orders } } });
  const pays = await db.payment.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } });
  await db.incomingTransaction.deleteMany({ where: { OR: [{ matchedPaymentId: { in: pays.map(p => p.id) } }, { cardLast4: last4 }] } });
  await db.taxiDispatch.deleteMany({ where: { orderId: { in: orders } } });
  await db.payment.deleteMany({ where: { id: { in: pays.map(p => p.id) } } });
  const cards = await db.card.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } });
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards.map(c => c.id) } } });
  await db.card.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.order.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.customer.deleteMany({ where: { telegramUserId: customerTg } });
  await db.product.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.restaurant.deleteMany({ where: { id: { in: rids } } });
  await db.taxiCompany.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await new Promise<void>(r => server.close(() => r()));
  await db.$disconnect();
  await appDb.$disconnect();
});

test('automatic assignment: an order without a chosen company gets the first eligible one; READY never creates a second dispatch', async () => {
  const { order, dispatch } = await requested();
  assert.equal(dispatch.taxiCompanyId, companyA);
  assert.equal((await row(order.id)).taxiCompanyId, companyA);
  assert.equal(dispatch.status, 'REQUESTED');
  await press(taxiBot, opA, `taxi:acc:${dispatch.id}`);
  await takeStaffAction({ actorSystemId: 'x', orderId: order.id, action: 'START_PREPARING', prepMinutes: 20 }).catch(() => undefined); // already preparing: harmless
  await takeStaffAction({ actorTelegramId: 'nobody', orderId: order.id, action: 'MARK_READY' }).catch(() => undefined);
  const { db: d2 } = await import('../lib/db.js');
  await d2.order.update({ where: { id: order.id }, data: { status: 'READY', readyAt: new Date() } }); // what MARK_READY does to the row
  await runCycle(customerBot, order.id, taxiBot);
  await runCycle(customerBot, order.id, taxiBot);
  assert.equal((await attempts(order.id)).length, 1, 'no second dispatch from READY or from repeated cycles');
  assert.equal(await active(order.id), 1);
});

test('explicit rejection with several companies falls back automatically, once, to a different company; history is kept', async () => {
  const { order, dispatch } = await requested();
  await Promise.all([1, 2, 3].map(() => press(taxiBot, opA, `taxi:none:${dispatch.id}`)));
  const list = await attempts(order.id);
  assert.equal(list.length, 2, 'exactly one fallback attempt even with three simultaneous presses');
  assert.deepEqual(list.map(a => [a.attemptNo, a.status, a.taxiCompanyId]), [[1, 'DECLINED', companyA], [2, 'SCHEDULED', companyB]]);
  assert.equal(await active(order.id), 1);
  const m0 = calls.length;
  await runCycle(customerBot, order.id, taxiBot);
  assert.equal(taxiTexts(opB, m0).filter(t => t.includes(`#${order.number}`)).length, 1, 'the second company is asked once');
  assert.equal(taxiTexts(opA, m0).filter(t => t.includes('Olib ketish')).length, 0, 'the company that declined is not asked again');
});

test('one company only: a rejection ends in the administrator queue, and the admin can retry the same company after attesting - exactly once', async () => {
  // temporarily only company A is eligible
  await db.taxiCompany.update({ where: { id: companyB }, data: { isActive: false } });
  try {
    const { order, dispatch } = await requested();
    await press(taxiBot, opA, `taxi:none:${dispatch.id}`);
    assert.equal((await attempts(order.id)).length, 1, 'nobody else to ask');
    assert.equal((await attempts(order.id))[0]!.status, 'DECLINED');
    const m0 = calls.length;
    await runCycle(customerBot, order.id, taxiBot);
    assert.ok(taxiTexts(adminTg, m0).some(t => t.includes(`#${order.number}`) && t.includes('/taxiadmin')), 'administrator is alerted through the taxi bot');
    await runCycle(customerBot, order.id, taxiBot);
    assert.equal(taxiTexts(adminTg, m0).filter(t => t.includes(`#${order.number}`)).length, 1, 'alerted once');
    assert.ok((await recoverableDispatches()).some(r => r.id === dispatch.id));

    // authorization, note and attestation
    await assert.rejects(adminRecoverDispatch({ adminTelegramId: rando, dispatchId: dispatch.id, action: 'RETRY_SAME', note: NOTE_OK }), /ADMIN_RUXSAT_YOQ/);
    await assert.rejects(adminRecoverDispatch({ adminTelegramId: adminTg, dispatchId: dispatch.id, action: 'RETRY_SAME', note: 'qisqa' }), /ADMIN_IZOH_NOTOGRI/);
    assert.equal((await attempts(order.id)).length, 1, 'refused attempts change nothing');

    const rs = await Promise.all([1, 2, 3].map(() => adminRecoverDispatch({ adminTelegramId: adminTg, dispatchId: dispatch.id, action: 'RETRY_SAME', note: NOTE_OK })));
    assert.equal(rs.filter(r => r.result === 'DONE').length, 1);
    assert.equal(rs.filter(r => r.result === 'STALE').length, 2);
    const list = await attempts(order.id);
    assert.deepEqual(list.map(a => [a.attemptNo, a.status, a.taxiCompanyId]), [[1, 'CANCELLED', companyA], [2, 'SCHEDULED', companyA]]);
    assert.equal(await active(order.id), 1);
    const ev = await db.orderEvent.findFirstOrThrow({ where: { orderId: order.id, action: 'TAXI_ADMIN_RETRY' } });
    assert.equal(ev.actorTelegramId, adminTg);
    assert.equal(ev.actorType, 'ADMIN');
    assert.equal((ev.details as { attestation: string }).attestation, 'NO_DRIVER_SENT');
    assert.equal((ev.details as { note: string }).note, NOTE_OK);
    const m1 = calls.length;
    await runCycle(customerBot, order.id, taxiBot);
    await runCycle(customerBot, order.id, taxiBot);
    assert.equal(taxiTexts(opA, m1).filter(t => t.includes(`#${order.number}`) && t.includes('Olib ketish')).length, 1, 'the operator gets one new request');
  } finally { await db.taxiCompany.update({ where: { id: companyB }, data: { isActive: true } }); }
});

test('administrator reassignment to another company; and a recorded "driver already sent" prevents any retry', async () => {
  const { order, dispatch } = await requested({ company: companyA, fallback: false });
  await press(taxiBot, opA, `taxi:none:${dispatch.id}`);
  assert.equal((await attempts(order.id)).length, 1, 'no consent to fallback: no automatic second company');
  const r = await adminRecoverDispatch({ adminTelegramId: adminTg, dispatchId: dispatch.id, action: 'REASSIGN', companyId: companyB, note: NOTE_OK });
  assert.equal(r.result, 'DONE');
  assert.deepEqual((await attempts(order.id)).map(a => [a.status, a.taxiCompanyId]), [['CANCELLED', companyA], ['SCHEDULED', companyB]]);
  assert.equal((await row(order.id)).taxiCompanyId, companyB);
  // the second company never answers; the admin establishes a car IS on the way -> recorded, not re-sent
  const second = (await attempts(order.id))[1]!;
  await db.taxiDispatch.update({ where: { id: second.id }, data: { status: 'NEEDS_HELP' } });
  const sent = await adminRecoverDispatch({ adminTelegramId: adminTg, dispatchId: second.id, action: 'DRIVER_SENT', note: 'Operator telefonda tasdiqladi: haydovchi yo‘lda' });
  assert.equal(sent.result, 'DONE');
  assert.equal((await attempts(order.id))[1]!.status, 'ASSIGNED');
  assert.equal((await attempts(order.id))[1]!.dispatchedBy, `admin:${adminTg}`);
  const again = await adminRecoverDispatch({ adminTelegramId: adminTg, dispatchId: second.id, action: 'RETRY_SAME', note: NOTE_OK });
  assert.equal(again.result, 'STALE', 'after a driver was sent nothing can be retried');
  assert.equal(await active(order.id), 1);
  // delivery is still confirmed by the assigned company's operator
  await db.order.update({ where: { id: order.id }, data: { status: 'READY', readyAt: new Date() } });
  await assert.rejects(completeDelivery({ actorTelegramId: opA, dispatchId: second.id }), /RUXSAT_YOQ/);
  assert.equal((await completeDelivery({ actorTelegramId: opB, dispatchId: second.id })).changed, true);
});

test('late operator answer racing the administrator: exactly one outcome, never two active bookings', async () => {
  const { order, dispatch } = await requested({ company: companyA, fallback: false });
  await db.taxiDispatch.update({ where: { id: dispatch.id }, data: { status: 'NEEDS_HELP' } });
  const [op, adm] = await Promise.allSettled([
    respondToTaxi({ actorTelegramId: opA, dispatchId: dispatch.id, action: 'SENT' }),
    adminRecoverDispatch({ adminTelegramId: adminTg, dispatchId: dispatch.id, action: 'RETRY_SAME', note: NOTE_OK }),
  ]);
  assert.equal(await active(order.id), 1, 'one active attempt whoever won');
  const list = await attempts(order.id);
  if (list.length === 1) { assert.equal(list[0]!.status, 'ASSIGNED'); assert.ok(adm.status === 'fulfilled' && adm.value.result === 'STALE'); }
  else { assert.equal(list[0]!.status, 'CANCELLED'); assert.equal(list[1]!.status, 'SCHEDULED'); assert.ok(op.status === 'fulfilled' && !op.value.changed); }
});

test('prolonged operator silence escalates to the administrators; the opt-in automatic fallback is audited and still one active booking', async () => {
  const { order, dispatch } = await requested({ fallback: true });
  await db.taxiDispatch.update({ where: { id: dispatch.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await runCycle(customerBot, order.id, taxiBot);
  assert.equal((await attempts(order.id))[0]!.status, 'CANCELLATION_PENDING');
  assert.equal((await attempts(order.id)).length, 1, 'silence alone never causes a second car');
  // reminders used up long ago
  await db.taxiDispatch.update({ where: { id: dispatch.id }, data: { cancelNoticeTries: 3, cancelNoticeAt: new Date(Date.now() - 3_600_000) } });
  const m0 = calls.length;
  await runCycle(customerBot, order.id, taxiBot);
  assert.equal((await attempts(order.id))[0]!.status, 'NEEDS_HELP');
  assert.ok(taxiTexts(adminTg, m0).some(t => t.includes(`#${order.number}`)), 'administrators are told');
  assert.equal((await attempts(order.id)).length, 1);

  // the explicit opt-in: reassign automatically after silence (two companies available)
  const second = await requested({ fallback: true });
  await db.taxiDispatch.update({ where: { id: second.dispatch.id }, data: { status: 'CANCELLATION_PENDING' } });
  assert.equal(await escalateSilentDispatch(second.dispatch.id, true), 'REASSIGNED');
  assert.deepEqual((await attempts(second.order.id)).map(a => [a.status, a.taxiCompanyId]), [['CANCELLED', companyA], ['SCHEDULED', companyB]]);
  const ev = await db.orderEvent.findFirstOrThrow({ where: { orderId: second.order.id, action: 'TAXI_AUTO_REASSIGNED_ON_SILENCE' } });
  assert.equal((ev.details as { risk: string }).risk, 'OPERATOR_SILENT_DRIVER_MAY_EXIST');
  assert.equal(await active(second.order.id), 1);
  // without consent to fallback the opt-in still escalates instead
  const third = await requested({ fallback: false, company: companyA });
  await db.taxiDispatch.update({ where: { id: third.dispatch.id }, data: { status: 'CANCELLATION_PENDING' } });
  assert.equal(await escalateSilentDispatch(third.dispatch.id, true), 'ESCALATED');
  assert.equal(await escalateSilentDispatch(third.dispatch.id, true), 'STALE', 'repeat is harmless');
});

test('/taxiadmin in the taxi bot: invisible to non-admins, works for admins with a written attestation', async () => {
  const { order, dispatch } = await requested({ company: companyA, fallback: false });
  await press(taxiBot, opA, `taxi:none:${dispatch.id}`);
  const mNo = calls.length;
  await say(taxiBot, opA, '/taxiadmin');
  await say(taxiBot, rando, '/taxiadmin');
  assert.equal(calls.slice(mNo).filter(c => c.token === TAXI_TOKEN && [String(opA), String(rando)].includes(String(c.body.chat_id)) && String(c.body.text ?? '').includes('Taksi muammolari')).length, 0);
  await press(taxiBot, rando, `tadm:go:retry:${dispatch.id}`);
  const m0 = calls.length;
  await say(taxiBot, adminTg, '/taxiadmin');
  assert.ok(calls.slice(m0).some(c => c.token === TAXI_TOKEN && String(c.body.chat_id) === adminTg && JSON.stringify(c.body.reply_markup ?? '').includes(`tadm:view:${dispatch.id}`)));
  await press(taxiBot, adminTg, `tadm:go:retry:${dispatch.id}`);
  await say(taxiBot, adminTg, 'qisqa');
  assert.equal((await attempts(order.id)).length, 1, 'too short: nothing happened');
  await say(taxiBot, adminTg, NOTE_OK);
  assert.deepEqual((await attempts(order.id)).map(a => a.status), ['CANCELLED', 'SCHEDULED']);
  // stray text from the admin afterwards is not consumed as a note
  const m1 = calls.length;
  await say(taxiBot, adminTg, 'salom');
  assert.equal((await attempts(order.id)).length, 2);
  void m1;
});
