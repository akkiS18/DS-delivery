import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Telegraf } from 'telegraf';
import { buildApp } from '../app.js';
import { createClientBot } from '../bot/client.js';
import { createTaxiBot } from '../bot/taxi-bot.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { placeOrder } from '../modules/orders/service.js';
import { advanceMockOrder } from '../modules/restaurant-orders/auto.js';
import { eligibleCompanyWhere } from '../modules/taxi/assignment.js';
import { taxiAttemptKey } from '../modules/taxi-app/auth.js';
import { createTaxiCompanyByAdmin, resetTaxiAccessByAdmin } from '../modules/taxi-app/provision.js';
import { db as appDb } from '../lib/db.js';

// The DS Taxi app API. Local fake Telegram only (to prove the app channel sends nothing to Telegram); ds_delivery_test only; MOCK payments.
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

process.env.RESTAURANT_LOGIN_MAX_FAILURES = '50';
process.env.RESTAURANT_LOGIN_IP_MAX_FAILURES = '1000';
const ADMIN = String(randomInt(100000000001, 200000000000));
const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const app = buildApp(engine);
const nonce = randomUUID().slice(0, 8);
const customerTg = String(randomInt(700000000001, 800000000000));
const opTg = String(randomInt(900000000001, 940000000000));
const rando = String(randomInt(980000000001, 999000000000));
process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = ADMIN;
delete process.env.SUPPORT_ADMIN_2_TELEGRAM_ID;
delete process.env.TAXI_TELEGRAM_ENABLED;
process.env.TAXI_OPERATOR_ALLOWLIST = opTg;
delete process.env.RESTAURANT_MANUAL_ACCEPTANCE;
delete process.env.TAXI_BOT_TOKEN;

const companyIds: string[] = [];
const ips: string[] = [];
const productIds: string[] = [];
let restaurantId = '';
let last4 = '';
let apiRoot = '';
let customerBot: Telegraf<any>;
let taxiBot: Telegraf<any>;
let runCycle: (bot: Telegraf<any>, orderId?: string, operatorBot?: Telegraf<any>) => Promise<void>;

const ip = () => { const v = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`; ips.push(v); return v; };
const logins: string[] = [];
async function newCompany(label: string) {
  const r = await createTaxiCompanyByAdmin({ adminId: ADMIN, name: `TA ${label} ${nonce}` });
  const company = await db.taxiCompany.findUniqueOrThrow({ where: { name: r.name } });
  companyIds.push(company.id);
  logins.push(r.login);
  return { id: company.id, login: r.login, password: r.password, name: r.name };
}
async function signIn(c: { login: string; password: string }, address = ip()) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/taxi/auth/login', remoteAddress: address, payload: { login: c.login, password: c.password } });
  return { res, token: res.statusCode === 200 ? (res.json() as { accessToken: string }).accessToken : '' };
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const get = (token: string, url: string) => app.inject({ method: 'GET', url: `/api/v1/taxi${url}`, headers: auth(token) });
const act = (token: string, id: string, action: string) =>
  app.inject({ method: 'POST', url: `/api/v1/taxi/requests/${id}/action`, headers: auth(token), payload: { action } });

/** A MOCK order cooked automatically for the given company; returns once its dispatch was sent (REQUESTED). */
async function requestedFor(companyId: string) {
  const p = await db.product.create({ data: { restaurantId, name: `P${productIds.length}`, priceSom: randomInt(10_000, 900_000) } });
  productIds.push(p.id);
  const o = (await placeOrder(engine, {
    restaurantId, telegramUserId: customerTg, customerName: 'T', phone: '+998901234567', addressText: 'Chilonzor 5, uy 12', taxiCompanyId: companyId,
    checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'MOCK', items: [{ productId: p.id, quantity: 1 }],
  }))!;
  await engine.ingestMock(BigInt(o.totalSom) * 100n, last4);
  assert.equal(await advanceMockOrder(o.id), true);
  const [d] = await db.taxiDispatch.findMany({ where: { orderId: o.id } });
  await db.taxiDispatch.update({ where: { id: d!.id }, data: { dueAt: new Date(Date.now() - 1000) } });
  await runCycle(customerBot, o.id, taxiBot);
  return { order: o, dispatch: await db.taxiDispatch.findUniqueOrThrow({ where: { id: d!.id } }) };
}
const sentTo = (chat: string, since = 0) => calls.slice(since).filter(c => c.method === 'sendMessage' && String(c.body.chat_id) === chat).map(c => String(c.body.text));

before(async () => {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  apiRoot = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  restaurantId = (await db.restaurant.create({ data: { slug: `ta-${nonce}`, name: `Kafe ${nonce}`, pickupAddress: 'Amir Temur 1', pickupPhone: '+998900000001' } })).id;
  for (;;) {
    const c = String(randomInt(1000, 9999));
    if (await db.card.findUnique({ where: { last4: c } })) continue;
    last4 = c; await engine.addCard(c, true, restaurantId); break;
  }
  customerBot = createClientBot(CUSTOMER_TOKEN, engine, { apiRoot });
  customerBot.botInfo = await customerBot.telegram.getMe();
  taxiBot = createTaxiBot(TAXI_TOKEN, { apiRoot });
  taxiBot.botInfo = await taxiBot.telegram.getMe();
  runCycle = (await import('../modules/taxi/worker.js')).runTaxiDispatchCycle as typeof runCycle;
});

after(async () => {
  const orders = (await db.order.findMany({ where: { restaurantId }, select: { id: true } })).map(o => o.id);
  await db.notificationLog.deleteMany({ where: { orderId: { in: orders } } });
  const pays = await db.payment.findMany({ where: { restaurantId }, select: { id: true } });
  await db.incomingTransaction.deleteMany({ where: { OR: [{ matchedPaymentId: { in: pays.map(p => p.id) } }, { cardLast4: last4 }] } });
  await db.taxiDispatch.deleteMany({ where: { orderId: { in: orders } } });
  await db.payment.deleteMany({ where: { id: { in: pays.map(p => p.id) } } });
  const cards = await db.card.findMany({ where: { restaurantId }, select: { id: true } });
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards.map(c => c.id) } } });
  await db.card.deleteMany({ where: { restaurantId } });
  await db.order.deleteMany({ where: { restaurantId } });
  await db.customer.deleteMany({ where: { telegramUserId: customerTg } });
  await db.product.deleteMany({ where: { restaurantId } });
  await db.restaurant.deleteMany({ where: { id: restaurantId } });
  await db.restaurantLoginAttempt.deleteMany({ where: { keyHash: { in: logins.map(l => taxiAttemptKey('login', l)).concat(ips.map(i => taxiAttemptKey('ip', i))) } } });
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('ds.ledger_cleanup', 'on', true)`;
    await tx.adminAuditEvent.deleteMany({ where: { actorId: ADMIN } });
  });
  await db.taxiCompany.deleteMany({ where: { id: { in: companyIds } } }); // credentials and sessions cascade
  await new Promise<void>(r => server.close(() => r()));
  await app.close();
  await db.$disconnect();
  await appDb.$disconnect();
});

test('administrators only: creating a company and its app login, and a password reset', async () => {
  await assert.rejects(createTaxiCompanyByAdmin({ adminId: rando, name: `TA nobody ${nonce}` }), /ADMIN_RUXSAT_YOQ/);
  await assert.rejects(resetTaxiAccessByAdmin({ adminId: rando, ref: 'anything' }), /ADMIN_RUXSAT_YOQ/);
  const c = await newCompany('login');
  const cred = await db.taxiCredential.findUniqueOrThrow({ where: { taxiCompanyId: c.id } });
  assert.ok(cred.passwordHash.startsWith('$argon2id$'), 'stored as Argon2id');
  assert.ok(!cred.passwordHash.includes(c.password));
  assert.equal((await db.adminAuditEvent.count({ where: { actorId: ADMIN, action: 'TAXI_COMPANY_CREATED', targetId: c.id } })), 1);
  assert.ok(!JSON.stringify(await db.adminAuditEvent.findMany({ where: { targetId: c.id } })).includes(c.password), 'the password is never audited');
  await assert.rejects(createTaxiCompanyByAdmin({ adminId: ADMIN, name: c.name }), /KOMPANIYA_BOR/);
});

test('sign-in: right password works, wrong/unknown look the same, a reset signs every device out', async () => {
  const c = await newCompany('auth');
  const bad = await signIn({ login: c.login, password: 'wrong-password-123' });
  const unknown = await signIn({ login: `nobody-${nonce}`, password: 'wrong-password-123' });
  assert.equal(bad.res.statusCode, 401);
  assert.deepEqual(bad.res.json(), unknown.res.json());
  const ok = await signIn(c);
  assert.equal(ok.res.statusCode, 200);
  assert.equal(JSON.stringify(ok.res.json()).includes(c.password), false);
  assert.equal((await get(ok.token, '/auth/me')).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/taxi/requests' })).statusCode, 401, 'no token');
  assert.equal((await get('x'.repeat(43), '/requests')).statusCode, 401, 'garbage token');

  const reset = await resetTaxiAccessByAdmin({ adminId: ADMIN, ref: c.login });
  assert.equal(reset?.login, c.login);
  assert.notEqual(reset?.password, c.password);
  assert.equal((await get(ok.token, '/requests')).statusCode, 401, 'the old session is gone');
  assert.equal((await signIn(c)).res.statusCode, 401, 'the old password is gone');
  assert.equal((await signIn({ login: c.login, password: reset!.password })).res.statusCode, 200);

  await db.taxiCompany.update({ where: { id: c.id }, data: { isActive: false } });
  assert.equal((await signIn({ login: c.login, password: reset!.password })).res.statusCode, 403, 'an inactive company cannot sign in');
});

test('throttle: repeated wrong passwords lock the login (429)', async () => {
  const c = await newCompany('lock');
  process.env.RESTAURANT_LOGIN_MAX_FAILURES = '3';
  try {
    const address = ip();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await signIn({ login: c.login, password: 'wrong-password-123' }, address)).res.statusCode);
    assert.ok(codes.includes(429), `got ${codes.join(',')}`);
    assert.equal((await signIn(c, address)).res.statusCode, 429, 'even the right password waits while locked');
  } finally { process.env.RESTAURANT_LOGIN_MAX_FAILURES = '50'; }
});

test('app-only company: the request reaches the app without any Telegram message; an offline app alerts the administrator once', async () => {
  const c = await newCompany('flow');
  const m0 = calls.length;
  const first = await requestedFor(c.id);
  assert.equal(first.dispatch.status, 'REQUESTED', 'a company reachable only through the app is not stuck in NEEDS_HELP');
  assert.equal(first.dispatch.telegramMessageId, null);
  assert.equal(calls.slice(m0).filter(x => x.token === TAXI_TOKEN && x.method === 'sendMessage' && String(x.body.chat_id) !== ADMIN).length, 0, 'nothing was sent to any operator');
  const alerts = sentTo(ADMIN, m0).filter(t => t.includes(`#${first.order.code}`));
  assert.equal(alerts.length, 1, 'nobody was looking at the app: the administrator is told at once');
  assert.ok(alerts[0]!.includes('ilovasi'));

  const { token } = await signIn(c);
  const list = (await get(token, '/requests')).json() as { active: Array<Record<string, any>>; history: unknown[]; company: { id: string } };
  assert.equal(list.company.id, c.id);
  assert.equal(list.active.length, 1);
  const r = list.active[0]!;
  assert.equal(r.id, first.dispatch.id);
  assert.equal(r.status, 'REQUESTED');
  assert.equal(r.attention, true, 'a new request rings');
  assert.deepEqual(r.actions, ['ACCEPT', 'NO_TAXI']);
  assert.equal(r.restaurant.address, 'Amir Temur 1');
  assert.equal(r.delivery.address, 'Chilonzor 5, uy 12');
  assert.equal(r.delivery.customerPhone, '+998901234567');

  // the app is online now: the next request does not raise the offline alert
  const m1 = calls.length;
  const second = await requestedFor(c.id);
  assert.equal(sentTo(ADMIN, m1).filter(t => t.includes(`#${second.order.code}`)).length, 0);
  assert.equal(((await get(token, '/requests')).json() as { active: unknown[] }).active.length, 2);
});

test('operator answers in the app: accept -> taxi sent -> delivered, with the same guards as the bot; a repeat changes nothing', async () => {
  const c = await newCompany('act');
  const { token } = await signIn(c);
  const { order, dispatch } = await requestedFor(c.id);

  assert.equal((await act(token, dispatch.id, 'SENT')).statusCode, 200, 'a stale step is a no-op, not an error');
  assert.equal((await db.taxiDispatch.findUniqueOrThrow({ where: { id: dispatch.id } })).status, 'REQUESTED', '"taxi sent" straight from a fresh request changed nothing');
  const accept = (await act(token, dispatch.id, 'ACCEPT')).json() as { changed: boolean; request: { status: string; actions: string[]; attention: boolean } };
  assert.equal(accept.changed, true);
  assert.equal(accept.request.status, 'ACCEPTED');
  assert.deepEqual(accept.request.actions, ['SENT', 'NO_TAXI']);
  assert.equal(accept.request.attention, false, 'once answered it stops ringing');
  assert.equal(((await act(token, dispatch.id, 'ACCEPT')).json() as { changed: boolean }).changed, false, 'second accept: nothing happens');

  const sent = (await act(token, dispatch.id, 'SENT')).json() as { request: { status: string; actions: string[]; deliverBlockedReason: string | null } };
  assert.equal(sent.request.status, 'ASSIGNED');
  assert.deepEqual(sent.request.actions, ['DELIVERED']);
  assert.ok(sent.request.deliverBlockedReason, 'the food is not ready yet');
  const early = await act(token, dispatch.id, 'DELIVERED');
  assert.equal(early.statusCode, 409);
  assert.equal((early.json() as { error: string }).error, 'BUYURTMA_HALI_TAYYOR_EMAS');
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'PREPARING', 'taxi dispatch alone never completes an order');

  await db.order.update({ where: { id: order.id }, data: { status: 'READY', readyAt: new Date() } });
  const done = await Promise.all([1, 2, 3].map(() => act(token, dispatch.id, 'DELIVERED')));
  assert.deepEqual(done.map(r => r.statusCode), [200, 200, 200]);
  assert.equal(done.filter(r => (r.json() as { changed: boolean }).changed).length, 1, 'exactly one delivery confirmation under concurrency');
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'COMPLETED');
  const ev = await db.orderEvent.findFirstOrThrow({ where: { orderId: order.id, action: 'DELIVERY_CONFIRMED' } });
  assert.equal(ev.actorType, 'TAXI_OPERATOR');
  assert.equal(ev.actorTelegramId, `app:${c.id}`);
  const list = (await get(token, '/requests')).json() as { active: unknown[]; history: Array<{ id: string; status: string }> };
  assert.equal(list.active.length, 0);
  assert.deepEqual(list.history.map(h => [h.id, h.status]), [[dispatch.id, 'DELIVERED']]);
});

test('a company only ever sees and answers its own requests; a foreign id looks exactly like a missing one', async () => {
  const a = await newCompany('iso-a');
  const b = await newCompany('iso-b');
  const tokenA = (await signIn(a)).token;
  const tokenB = (await signIn(b)).token;
  const { dispatch } = await requestedFor(a.id);
  assert.equal(((await get(tokenB, '/requests')).json() as { active: unknown[] }).active.length, 0);
  const foreign = await get(tokenB, `/requests/${dispatch.id}`);
  const missing = await get(tokenB, '/requests/doesnotexist123');
  assert.equal(foreign.statusCode, 404);
  assert.deepEqual(foreign.json(), missing.json());
  const attack = await act(tokenB, dispatch.id, 'ACCEPT');
  assert.equal(attack.statusCode, 404);
  assert.equal((await db.taxiDispatch.findUniqueOrThrow({ where: { id: dispatch.id } })).status, 'REQUESTED', 'untouched');
  assert.equal((await act(tokenA, dispatch.id, 'ACCEPT')).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/taxi/requests/${dispatch.id}/action`, headers: auth(tokenA), payload: { action: 'HACK' } })).statusCode, 400, 'unknown actions are refused');
});

test('silence: an unanswered request still escalates to the administrators when the company uses only the app', async () => {
  const c = await newCompany('silent');
  const { token } = await signIn(c);
  const { order, dispatch } = await requestedFor(c.id);
  await db.taxiDispatch.update({ where: { id: dispatch.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const m0 = calls.length;
  await runCycle(customerBot, order.id, taxiBot);
  let d = await db.taxiDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
  assert.equal(d.status, 'CANCELLATION_PENDING');
  await runCycle(customerBot, order.id, taxiBot);
  d = await db.taxiDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
  assert.equal(d.cancelNoticeTries, 1, 'the clarification reminders are still counted (they drive the escalation)');
  const view = ((await get(token, '/requests')).json() as { active: Array<{ status: string; attention: boolean; actions: string[] }> }).active[0]!;
  assert.deepEqual([view.status, view.attention, view.actions], ['CANCELLATION_PENDING', true, ['SENT', 'NO_TAXI']], 'the app keeps asking until the operator clarifies');
  assert.ok(sentTo(ADMIN, m0).some(t => t.includes(`#${order.code}`) && t.includes('/taxiadmin')), 'the administrators are alerted');
});

test('Telegram switch: with the taxi Telegram panel off only app companies are eligible; with it on, a company with both gets the message too', async () => {
  const appOnly = await newCompany('elig');
  const telegramOnly = await db.taxiCompany.create({ data: { name: `TA tg ${nonce}`, isActive: true, operatorTelegramUserId: opTg } });
  companyIds.push(telegramOnly.id);
  const both = await db.taxiCompany.findMany({ where: { ...eligibleCompanyWhere({ TAXI_OPERATOR_ALLOWLIST: opTg } as never), id: { in: [appOnly.id, telegramOnly.id] } }, select: { id: true } });
  assert.deepEqual(both.map(x => x.id).sort(), [appOnly.id, telegramOnly.id].sort());
  const off = await db.taxiCompany.findMany({ where: { ...eligibleCompanyWhere({ TAXI_TELEGRAM_ENABLED: 'false' } as never), id: { in: [appOnly.id, telegramOnly.id] } }, select: { id: true } });
  assert.deepEqual(off.map(x => x.id), [appOnly.id]);

  // a company reachable both ways: the operator's Telegram chat is messaged as before AND the app has it
  await resetTaxiAccessByAdmin({ adminId: ADMIN, ref: telegramOnly.name }); // gives it an app login
  const m0 = calls.length;
  const { order, dispatch } = await requestedFor(telegramOnly.id);
  assert.equal(dispatch.status, 'REQUESTED');
  assert.ok(dispatch.telegramMessageId !== null);
  assert.ok(sentTo(opTg, m0).some(t => t.includes(`#${order.code}`)));
});
