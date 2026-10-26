import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Telegraf } from 'telegraf';
import { buildApp } from '../app.js';
import { signInitData } from '../modules/miniapp/auth.js';
import { hashToken } from '../modules/miniapp/guest.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { db as appDb } from '../lib/db.js';

// Support chat inside the customer apps (Mini App + Android guest) against ds_delivery_test. Telegram is never contacted: the bot is a
// recording stub. Every row created here is deleted by id in after().
const BOT_TOKEN = '123456789:AAFakeSupportAppTokenLocalOnly_0123456789';
const ADMIN_A = String(randomInt(100000000000, 400000000000));
const ADMIN_B = String(randomInt(400000000001, 700000000000));
process.env.BOT_TOKEN = BOT_TOKEN;
process.env.MINIAPP_ENABLED = 'true';
process.env.ANDROID_GUEST_ENABLED = 'true';
process.env.GUEST_BOOTSTRAP_PER_IP_HOUR = '1000';
process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = ADMIN_A;
process.env.SUPPORT_ADMIN_2_TELEGRAM_ID = ADMIN_B;
const { claimTicket, resolveTicket, ticketByNumber } = await import('../modules/support/service.js');
const { addAdminReply } = await import('../modules/support/conversation.js');
const { deliverSupportMessages } = await import('../bot/support-notify.js');
const { registerSupportHandlers } = await import('../bot/support.js');

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const app = buildApp(engine);
const nonce = randomUUID().slice(0, 8);
const tgNo = () => String(randomInt(1_000_000_000_000, 1_900_000_000_000));
const customerIds = new Set<string>();
const tgUsers: string[] = [];
let restaurantId = '';
let seq = 1;

const tma = (userId: string) => `tma ${signInitData({
  auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAH',
  user: JSON.stringify({ id: Number(userId), first_name: 'Tg', username: 'tguser' }),
}, BOT_TOKEN)}`;
const call = (method: 'GET' | 'POST', url: string, auth: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1/miniapp${url}`, payload: payload as object | undefined, headers: { authorization: auth } });

async function newGuest(): Promise<{ auth: string; id: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/miniapp/guest/session', payload: { installationId: `sa${nonce}-${randomUUID()}` } });
  assert.equal(res.statusCode, 201, res.body);
  const token = res.json().token as string;
  const g = await db.guestSession.findFirstOrThrow({ where: { tokenHash: hashToken(token) } });
  customerIds.add(g.customerId);
  return { auth: `Bearer ${token}`, id: g.customerId };
}
async function orderFor(customerId: string): Promise<string> {
  return (await db.order.create({ data: { restaurantId, customerId, addressText: 'test', totalSom: 10_000 } })).id;
}
const clientKey = () => `k-${randomUUID()}`;

before(async () => {
  await db.$connect();
  restaurantId = (await db.restaurant.create({ data: { slug: `support-app-${nonce}`, name: 'Support app test' } })).id;
});
after(async () => {
  for (const tg of tgUsers) { const c = await db.customer.findUnique({ where: { telegramUserId: tg }, select: { id: true } }); if (c) customerIds.add(c.id); }
  const all = [...customerIds];
  const tickets = (await db.supportTicket.findMany({ where: { customerId: { in: all } }, select: { id: true } })).map(t => t.id);
  await db.supportCallbackLog.deleteMany({ where: { ticketId: { in: tickets } } });
  await db.supportTicket.deleteMany({ where: { customerId: { in: all } } }); // cascades messages/events/notifications
  await db.order.deleteMany({ where: { restaurantId } });
  await db.guestSession.deleteMany({ where: { customerId: { in: all } } });
  await db.customer.deleteMany({ where: { id: { in: all } } });
  await db.restaurant.deleteMany({ where: { id: restaurantId } });
  await app.close();
  await db.$disconnect();
  await appDb.$disconnect();
});

test('a guest (no Telegram) opens a ticket for their own order from the app; a retry returns the same ticket', async () => {
  const g = await newGuest();
  const orderId = await orderFor(g.id);
  const first = await call('POST', `/orders/${orderId}/support`, g.auth, { message: 'To‘lov o‘tkazdim, tasdiqlanmadi' });
  assert.equal(first.statusCode, 201, first.body);
  const { ticketId, created } = first.json() as { ticketId: string; created: boolean };
  assert.equal(created, true);
  const again = await call('POST', `/orders/${orderId}/support`, g.auth, { message: 'Yana yozaman' });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().ticketId, ticketId);
  assert.equal(again.json().created, false);
  assert.equal(await db.supportTicket.count({ where: { orderId } }), 1);
  const ev = await db.supportTicketEvent.findFirstOrThrow({ where: { ticketId, action: 'CREATED' } });
  assert.equal(ev.actorTelegramId, `app:${g.id}`);
});

test('a foreign or unknown order and ticket look the same (404); bodies are strictly validated', async () => {
  const a = await newGuest();
  const b = await newGuest();
  const orderA = await orderFor(a.id);
  assert.equal((await call('POST', `/orders/${orderA}/support`, b.auth, { message: 'Begona buyurtma' })).statusCode, 404);
  assert.equal((await call('POST', '/orders/nope/support', a.auth, { message: 'Mavjud emas' })).statusCode, 404);
  assert.equal((await call('POST', `/orders/${orderA}/support`, a.auth, { message: 'xx' })).statusCode, 400);
  assert.equal((await call('POST', `/orders/${orderA}/support`, a.auth, { message: 'Yetarli uzunlik', customerId: b.id })).statusCode, 400);
  const created = await call('POST', `/orders/${orderA}/support`, a.auth, { message: 'Mening muammom' });
  const ticketId = created.json().ticketId as string;
  assert.equal((await call('GET', `/support/${ticketId}`, b.auth)).statusCode, 404);
  assert.equal((await call('POST', `/support/${ticketId}/messages`, b.auth, { text: 'hujum', clientKey: clientKey() })).statusCode, 404);
  assert.equal((await call('GET', '/support', b.auth)).json().tickets.length, 0);
  assert.equal((await call('POST', `/support/${ticketId}/messages`, a.auth, { text: '   ', clientKey: clientKey() })).statusCode, 400);
  assert.equal((await call('POST', `/support/${ticketId}/messages`, a.auth, { text: 'ok', clientKey: 'short' })).statusCode, 400);
});

test('chat: app message reaches the owner admin, the admin reply reaches an app-only customer, unread is tracked and cleared on open', async () => {
  const g = await newGuest();
  const orderId = await orderFor(g.id);
  const ticketId = (await call('POST', `/orders/${orderId}/support`, g.auth, { message: 'Pul o‘tkazdim' })).json().ticketId as string;
  const number = (await db.supportTicket.findUniqueOrThrow({ where: { id: ticketId } })).number;
  assert.equal((await ticketByNumber(number))?.id, ticketId);
  assert.equal(await ticketByNumber(-1), null);

  const key = clientKey();
  const sent = await call('POST', `/support/${ticketId}/messages`, g.auth, { text: 'Hali ham tasdiqlanmadi', clientKey: key });
  assert.equal(sent.statusCode, 201, sent.body);
  const dup = await call('POST', `/support/${ticketId}/messages`, g.auth, { text: 'Hali ham tasdiqlanmadi', clientKey: key });
  assert.equal(dup.statusCode, 200);
  assert.equal(dup.json().sent, false);
  assert.equal(await db.supportTicketMessage.count({ where: { ticketId } }), 1);

  // The admin gets it (unclaimed: every admin); an admin must own the ticket to answer.
  const sends: Array<{ to: string; text: string }> = [];
  const bot = { telegram: { sendMessage: async (to: string, text: string) => { sends.push({ to, text }); return { message_id: seq++ }; } } } as unknown as Telegraf;
  await deliverSupportMessages(bot, [ticketId]);
  assert.deepEqual(sends.map(s => s.to).sort(), [ADMIN_A, ADMIN_B].sort());
  assert.match(sends[0]!.text, new RegExp(`Murojaat #${number}`));
  assert.equal((await claimTicket({ actorTelegramId: ADMIN_A, actorName: 'A', ticketId, callbackQueryId: randomUUID() })).result, 'DONE');

  assert.equal((await call('GET', '/support/unread', g.auth)).json().unread, 0);
  assert.equal((await addAdminReply({ actorTelegramId: ADMIN_A, actorName: 'A', ticketId, text: 'Tekshiryapmiz', telegramMessageId: seq++ })).result, 'SENT');
  sends.length = 0;
  await deliverSupportMessages(bot, [ticketId]);
  assert.equal(sends.length, 0, 'an app-only customer has no Telegram to message');
  assert.ok((await db.supportTicketMessage.findFirstOrThrow({ where: { ticketId, senderType: 'ADMIN' } })).deliveredAt, 'marked delivered, not retried forever');

  assert.equal((await call('GET', '/support/unread', g.auth)).json().unread, 1);
  const list = (await call('GET', '/support', g.auth)).json().tickets as Array<{ id: string; unread: boolean; lastFrom: string; lastText: string; orderCode: string }>;
  assert.equal(list[0]!.unread, true);
  assert.equal(list[0]!.lastFrom, 'ADMIN');
  assert.equal(list[0]!.lastText, 'Tekshiryapmiz');

  const thread = (await call('GET', `/support/${ticketId}`, g.auth)).json() as { messages: Array<{ from: string; text: string }>; ticket: { status: string } };
  assert.deepEqual(thread.messages.map(m => [m.from, m.text]), [['CUSTOMER', 'Pul o‘tkazdim'], ['CUSTOMER', 'Hali ham tasdiqlanmadi'], ['ADMIN', 'Tekshiryapmiz']]);
  assert.equal(thread.ticket.status, 'IN_PROGRESS');
  assert.equal(JSON.stringify(thread).includes(ADMIN_A), false, 'no admin identity reaches the customer');
  assert.equal((await call('GET', '/support/unread', g.auth)).json().unread, 0, 'opening the chat marks it read');

  // Resolution is unread too; after it the customer cannot write into the closed ticket, but can open a new one.
  assert.equal((await resolveTicket({ actorTelegramId: ADMIN_A, ticketId, callbackQueryId: randomUUID() })).result, 'DONE');
  assert.equal((await call('GET', '/support/unread', g.auth)).json().unread, 1);
  assert.equal((await call('POST', `/support/${ticketId}/messages`, g.auth, { text: 'Kech yozdim', clientKey: clientKey() })).statusCode, 409);
  const next = await call('POST', `/orders/${orderId}/support`, g.auth, { message: 'Yana muammo bor' });
  assert.equal(next.statusCode, 201);
  assert.notEqual(next.json().ticketId, ticketId);
});

test('a Telegram (Mini App) customer is also messaged in Telegram and the app chat shows the same thread', async () => {
  const tg = tgNo(); tgUsers.push(tg);
  const auth = tma(tg);
  const customer = await db.customer.create({ data: { telegramUserId: tg } });
  customerIds.add(customer.id);
  const orderId = await orderFor(customer.id);
  const ticketId = (await call('POST', `/orders/${orderId}/support`, auth, { message: 'Mini Appdan yozdim' })).json().ticketId as string;
  assert.equal((await claimTicket({ actorTelegramId: ADMIN_B, actorName: 'B', ticketId, callbackQueryId: randomUUID() })).result, 'DONE');
  await addAdminReply({ actorTelegramId: ADMIN_B, actorName: 'B', ticketId, text: 'Javob', telegramMessageId: seq++ });
  const sends: Array<{ to: string }> = [];
  const bot = { telegram: { sendMessage: async (to: string) => { sends.push({ to }); return { message_id: seq++ }; } } } as unknown as Telegraf;
  await deliverSupportMessages(bot, [ticketId]);
  assert.deepEqual(sends.map(s => s.to), [tg]);
  const thread = (await call('GET', `/support/${ticketId}`, auth)).json() as { messages: Array<{ text: string }> };
  assert.deepEqual(thread.messages.map(m => m.text), ['Mini Appdan yozdim', 'Javob']);
});

test('flood guards: at most 5 open tickets per customer and 10 unanswered messages per ticket', async () => {
  const g = await newGuest();
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    const o = await orderFor(g.id);
    const r = await call('POST', `/orders/${o}/support`, g.auth, { message: `Muammo raqam ${i}` });
    assert.equal(r.statusCode, 201, r.body);
    ids.push(r.json().ticketId);
  }
  const sixth = await call('POST', `/orders/${await orderFor(g.id)}/support`, g.auth, { message: 'Oltinchi murojaat' });
  assert.equal(sixth.statusCode, 429);
  assert.equal(sixth.json().error, 'KOP_OCHIQ_MUROJAAT');
  for (let i = 0; i < 10; i++) assert.equal((await call('POST', `/support/${ids[0]}/messages`, g.auth, { text: `xabar ${i}`, clientKey: clientKey() })).statusCode, 201);
  // (the request-rate limiter allows 20/min; stay under it and look at the domain rule)
  const over = await call('POST', `/support/${ids[0]}/messages`, g.auth, { text: 'o‘n birinchi', clientKey: clientKey() });
  assert.equal(over.statusCode, 429);
  assert.equal(over.json().error, 'KOP_XABAR');
});

test('concurrent identical sends (same clientKey) store one message', async () => {
  const g = await newGuest();
  const o = await orderFor(g.id);
  const ticketId = (await call('POST', `/orders/${o}/support`, g.auth, { message: 'Parallel sinov' })).json().ticketId as string;
  const key = clientKey();
  const rs = await Promise.all(Array.from({ length: 5 }, () => call('POST', `/support/${ticketId}/messages`, g.auth, { text: 'bir xil', clientKey: key })));
  assert.ok(rs.every(r => r.statusCode === 200 || r.statusCode === 201));
  assert.equal(rs.filter(r => r.statusCode === 201).length, 1);
  assert.equal(await db.supportTicketMessage.count({ where: { ticketId } }), 1);
});

test('Telegram reply of an admin to a ticket message answers that customer in the app (an unclaimed ticket is claimed by the replier)', async () => {
  const g = await newGuest();
  const orderId = await orderFor(g.id);
  const ticketId = (await call('POST', `/orders/${orderId}/support`, g.auth, { message: 'Telegramdan javob kutyapman' })).json().ticketId as string;
  const number = (await db.supportTicket.findUniqueOrThrow({ where: { id: ticketId } })).number;

  const BOT_ID = 777000111;
  // Telegraf builds a fresh API client per update, so the Bot API is faked with a local server instead of a stubbed method.
  const api = createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      sent.push({ method: String(req.url).split('/').pop() ?? '', payload: body ? JSON.parse(body) as Record<string, unknown> : {} });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, result: { message_id: seq++, chat: { id: 1 }, date: 0, text: 'ok' } }));
    });
  });
  await new Promise<void>(r => api.listen(0, '127.0.0.1', r));
  const bot = new Telegraf('123456789:AAFakeQuoteReplyTokenLocalOnly_0123456789', { telegram: { apiRoot: `http://127.0.0.1:${(api.address() as AddressInfo).port}` } });
  const sent: Array<{ method: string; payload: Record<string, unknown> }> = [];
  bot.botInfo = { id: BOT_ID, is_bot: true, first_name: 'DS', username: 'ds_fake_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false } as typeof bot.botInfo;
  registerSupportHandlers(bot);
  const update = (replyText: string | null, text: string, from = ADMIN_A) => ({
    update_id: seq++,
    message: {
      message_id: seq++, date: Math.floor(Date.now() / 1000), chat: { id: Number(from), type: 'private', first_name: 'A' }, from: { id: Number(from), is_bot: false, first_name: 'A' }, text,
      ...(replyText ? { reply_to_message: { message_id: seq++, date: 0, chat: { id: Number(from), type: 'private' }, from: { id: BOT_ID, is_bot: true, first_name: 'DS' }, text: replyText } } : {}),
    },
  });

  // A reply to something that is not a ticket message, or from a non-admin, changes nothing.
  await bot.handleUpdate(update('Boshqa xabar', 'salom') as never);
  await bot.handleUpdate(update(`🎫 Murojaat #${number} — ochiq`, 'hujum', tgNo()) as never);
  assert.equal(await db.supportTicketMessage.count({ where: { ticketId } }), 0);

  await bot.handleUpdate(update(`🎫 Murojaat #${number} — ochiq`, 'Tekshirib ko‘rdik, pulingiz keldi') as never);
  const t = await db.supportTicket.findUniqueOrThrow({ where: { id: ticketId } });
  assert.equal(t.status, 'IN_PROGRESS');
  assert.equal(t.assignedAdminTelegramId, ADMIN_A);
  const thread = (await call('GET', `/support/${ticketId}`, g.auth)).json() as { messages: Array<{ from: string; text: string }> };
  assert.deepEqual(thread.messages.map(m => [m.from, m.text]), [['CUSTOMER', 'Telegramdan javob kutyapman'], ['ADMIN', 'Tekshirib ko‘rdik, pulingiz keldi']]);

  // The other admin may not answer a ticket that A owns.
  await bot.handleUpdate(update(`💬 Murojaat #${number} — mijoz yozdi:`, 'men ham yozaman', ADMIN_B) as never);
  assert.equal(await db.supportTicketMessage.count({ where: { ticketId, senderType: 'ADMIN' } }), 1);
  // Further replies by the owner keep working.
  await bot.handleUpdate(update(`💬 Murojaat #${number} — mijoz yozdi:`, 'Yana bir gap') as never);
  assert.equal(await db.supportTicketMessage.count({ where: { ticketId, senderType: 'ADMIN' } }), 2);
  api.close();
});
