import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import type { Telegraf } from 'telegraf';
import { db } from '../lib/db.js';

const ADMIN_A = String(randomInt(100000000000, 400000000000));
const ADMIN_B = String(randomInt(400000000001, 700000000000));
process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = ADMIN_A;
process.env.SUPPORT_ADMIN_2_TELEGRAM_ID = ADMIN_B;
const { claimTicket, createTicket, resolveTicket } = await import('../modules/support/service.js');
const { addAdminReply, addCustomerMessage, reassignTicket, reopenTicket } = await import('../modules/support/conversation.js');
const { deliverSupportMessages } = await import('../bot/support-notify.js');

const owner = String(randomInt(700000000001, 800000000000));
const stranger = String(randomInt(800000000001, 900000000000));
let restaurantId = '';
const customerIds: string[] = [];
const ticketIds: string[] = [];
let msgSeq = 1;
const cb = () => randomUUID();
const mid = () => msgSeq++;

async function newOrder(telegramUserId: string): Promise<string> {
  const customer = await db.customer.upsert({ where: { telegramUserId }, update: {}, create: { telegramUserId } });
  if (!customerIds.includes(customer.id)) customerIds.push(customer.id);
  return (await db.order.create({ data: { restaurantId, customerId: customer.id, addressText: 'test', totalSom: 1000 } })).id;
}
async function newTicket(opts: { claimBy?: string; orderId?: string } = {}): Promise<string> {
  const orderId = opts.orderId ?? await newOrder(owner);
  const r = await createTicket({ telegramUserId: owner, orderId, message: 'Buyurtma kechikdi' });
  if (r.result !== 'CREATED') throw new Error(`unexpected ${r.result}`);
  ticketIds.push(r.ticketId);
  if (opts.claimBy) {
    const c = await claimTicket({ actorTelegramId: opts.claimBy, actorName: `Name ${opts.claimBy.slice(0, 3)}`, ticketId: r.ticketId, callbackQueryId: cb() });
    assert.equal(c.result, 'DONE');
  }
  return r.ticketId;
}
const get = (id: string) => db.supportTicket.findUniqueOrThrow({ where: { id } });

before(async () => {
  await db.$connect();
  restaurantId = (await db.restaurant.create({ data: { slug: `support-conv-${randomUUID()}`, name: 'Support conv test' } })).id;
});
after(async () => {
  await db.supportCallbackLog.deleteMany({ where: { ticketId: { in: ticketIds } } });
  await db.supportTicket.deleteMany({ where: { id: { in: ticketIds } } }); // cascades messages/events
  await db.order.deleteMany({ where: { restaurantId } });
  await db.customer.deleteMany({ where: { id: { in: customerIds } } });
  await db.restaurant.delete({ where: { id: restaurantId } });
  await db.$disconnect();
});

test('customer follow-up is stored with sender, ticket, timestamp and audit event; foreigners are rejected', async () => {
  const ticketId = await newTicket();
  const m = mid();
  const r = await addCustomerMessage({ telegramUserId: owner, ticketId, text: '  Yana yozaman  ', telegramMessageId: m });
  assert.equal(r.result, 'SENT');
  const row = await db.supportTicketMessage.findFirstOrThrow({ where: { ticketId } });
  assert.equal(row.senderType, 'CUSTOMER');
  assert.equal(row.senderTelegramId, owner);
  assert.equal(row.text, 'Yana yozaman');
  assert.ok(row.createdAt);
  assert.equal(row.deliveredAt, null);
  assert.equal(await db.supportTicketEvent.count({ where: { ticketId, action: 'CUSTOMER_MESSAGE' } }), 1);
  assert.deepEqual(await addCustomerMessage({ telegramUserId: stranger, ticketId, text: 'hujum', telegramMessageId: mid() }), { result: 'NOT_FOUND' });
  assert.deepEqual(await addCustomerMessage({ telegramUserId: owner, ticketId: 'nope', text: 'x', telegramMessageId: mid() }), { result: 'NOT_FOUND' });
  await assert.rejects(addCustomerMessage({ telegramUserId: owner, ticketId, text: 'x'.repeat(1001), telegramMessageId: mid() }));
  assert.equal(await db.supportTicketMessage.count({ where: { ticketId } }), 1);
});

test('a redelivered Telegram message is stored once (parallel and later)', async () => {
  const ticketId = await newTicket();
  const m = mid();
  const args = { telegramUserId: owner, ticketId, text: 'Takror xabar', telegramMessageId: m };
  const results = await Promise.all(Array.from({ length: 5 }, () => addCustomerMessage(args)));
  assert.equal(results.filter(r => r.result === 'SENT').length, 1);
  assert.equal(results.filter(r => r.result === 'DUPLICATE').length, 4);
  assert.deepEqual(await addCustomerMessage(args), { result: 'DUPLICATE' });
  assert.equal(await db.supportTicketMessage.count({ where: { ticketId } }), 1);
});

test('admin reply: only the assignee; not before claim; not after resolve', async () => {
  const ticketId = await newTicket();
  const reply = (actor: string) => addAdminReply({ actorTelegramId: actor, actorName: 'Admin', ticketId, text: 'Javob', telegramMessageId: mid() });
  assert.equal((await reply(ADMIN_A)).result, 'NOT_CLAIMED');
  await claimTicket({ actorTelegramId: ADMIN_A, actorName: 'Admin A', ticketId, callbackQueryId: cb() });
  assert.deepEqual(await reply(ADMIN_B), { result: 'NOT_YOURS', assignedAdminName: 'Admin A' });
  await assert.rejects(reply(stranger));
  await assert.rejects(reply(owner));
  assert.equal((await reply(ADMIN_A)).result, 'SENT');
  const row = await db.supportTicketMessage.findFirstOrThrow({ where: { ticketId, senderType: 'ADMIN' } });
  assert.equal(row.senderTelegramId, ADMIN_A);
  assert.equal(await db.supportTicketEvent.count({ where: { ticketId, action: 'ADMIN_REPLY' } }), 1);
  await resolveTicket({ actorTelegramId: ADMIN_A, ticketId, callbackQueryId: cb() });
  assert.equal((await reply(ADMIN_A)).result, 'ALREADY_RESOLVED');
  assert.equal((await addCustomerMessage({ telegramUserId: owner, ticketId, text: 'Kech', telegramMessageId: mid() })).result, 'ALREADY_RESOLVED');
});

test('reassign: concurrent attempts hand the ticket over exactly once; audit records from/to', async () => {
  const ticketId = await newTicket({ claimBy: ADMIN_A });
  const results = await Promise.all(Array.from({ length: 8 }, () => reassignTicket({
    actorTelegramId: ADMIN_A, ticketId, targetTelegramId: ADMIN_B, targetName: 'Admin B', callbackQueryId: cb() })));
  assert.equal(results.filter(r => r.result === 'DONE').length, 1);
  assert.equal(results.filter(r => r.result === 'SAME_ADMIN').length, 7);
  const t = await get(ticketId);
  assert.equal(t.status, 'IN_PROGRESS');
  assert.equal(t.assignedAdminTelegramId, ADMIN_B);
  assert.equal(t.assignedAdminName, 'Admin B');
  const ev = await db.supportTicketEvent.findMany({ where: { ticketId, action: 'REASSIGNED' } });
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0]!.details, { from: ADMIN_A, to: ADMIN_B });
  // the former owner can no longer reply or resolve
  assert.equal((await addAdminReply({ actorTelegramId: ADMIN_A, actorName: 'A', ticketId, text: 'x', telegramMessageId: mid() })).result, 'NOT_YOURS');
  assert.equal((await resolveTicket({ actorTelegramId: ADMIN_A, ticketId, callbackQueryId: cb() })).result, 'NOT_YOURS');
});

test('reassign: authorization, invalid target, wrong state and duplicate callbacks', async () => {
  const open = await newTicket();
  const args = (ticketId: string, actor: string, target: string) => ({
    actorTelegramId: actor, ticketId, targetTelegramId: target, targetName: 'N', callbackQueryId: cb() });
  assert.equal((await reassignTicket(args(open, ADMIN_A, ADMIN_B))).result, 'NOT_ACTIVE');
  const t = await newTicket({ claimBy: ADMIN_A });
  await assert.rejects(reassignTicket(args(t, stranger, ADMIN_B)));
  await assert.rejects(reassignTicket(args(t, owner, owner)));
  assert.equal((await reassignTicket(args(t, ADMIN_A, stranger))).result, 'INVALID_TARGET');
  assert.equal((await reassignTicket(args(t, ADMIN_B, ADMIN_A))).result, 'SAME_ADMIN'); // already A's
  assert.equal((await get(t)).assignedAdminTelegramId, ADMIN_A);
  // duplicate callback processed once
  const dup = { ...args(t, ADMIN_A, ADMIN_B) };
  const rs = await Promise.all([reassignTicket(dup), reassignTicket(dup), reassignTicket(dup)]);
  assert.equal(rs.filter(r => r.result === 'DONE').length, 1);
  assert.equal(rs.filter(r => r.result === 'DUPLICATE').length, 2);
  assert.deepEqual(await reassignTicket(dup), { result: 'DUPLICATE' });
  // admin B owns it now; A may only take it back for themselves
  assert.equal((await reassignTicket(args(t, ADMIN_A, ADMIN_A))).result, 'DONE');
  assert.equal((await get(t)).assignedAdminTelegramId, ADMIN_A);
});

test('reopen: RESOLVED returns to OPEN with no owner; guarded and idempotent', async () => {
  const ticketId = await newTicket({ claimBy: ADMIN_A });
  assert.equal((await reopenTicket({ actorTelegramId: ADMIN_A, ticketId, callbackQueryId: cb() })).result, 'NOT_RESOLVED');
  await assert.rejects(reopenTicket({ actorTelegramId: stranger, ticketId, callbackQueryId: cb() }));
  await resolveTicket({ actorTelegramId: ADMIN_A, ticketId, callbackQueryId: cb() });
  await db.supportTicket.update({ where: { id: ticketId }, data: { customerNotifiedAt: new Date() } });
  const args = { actorTelegramId: ADMIN_B, ticketId, callbackQueryId: cb() };
  const rs = await Promise.all([reopenTicket(args), reopenTicket(args), reopenTicket({ ...args, callbackQueryId: cb() })]);
  assert.equal(rs.filter(r => r.result === 'DONE').length, 1);
  const t = await get(ticketId);
  assert.equal(t.status, 'OPEN');
  assert.equal(t.assignedAdminTelegramId, null);
  assert.equal(t.resolvedAt, null);
  assert.equal(t.customerNotifiedAt, null); // customer is told again after the next resolve
  assert.equal(await db.supportTicketEvent.count({ where: { ticketId, action: 'REOPENED' } }), 1);
  // claim + resolve works again after reopening
  assert.equal((await claimTicket({ actorTelegramId: ADMIN_B, actorName: 'B', ticketId, callbackQueryId: cb() })).result, 'DONE');
  assert.equal((await resolveTicket({ actorTelegramId: ADMIN_B, ticketId, callbackQueryId: cb() })).result, 'DONE');
});

test('reopen is refused while another unresolved ticket exists for the order', async () => {
  const orderId = await newOrder(owner);
  const first = await newTicket({ orderId, claimBy: ADMIN_A });
  await resolveTicket({ actorTelegramId: ADMIN_A, ticketId: first, callbackQueryId: cb() });
  const second = await newTicket({ orderId });
  const r = await reopenTicket({ actorTelegramId: ADMIN_A, ticketId: first, callbackQueryId: cb() });
  assert.equal(r.result, 'ALREADY_ACTIVE');
  assert.equal((await get(first)).status, 'RESOLVED');
  assert.equal((await get(second)).status, 'OPEN');
});

type Sent = { to: string; text: string };
function fakeBot(fail: (to: string) => unknown) {
  const sent: Sent[] = [];
  const bot = { telegram: { sendMessage: async (to: string, text: string) => {
    const err = fail(to);
    if (err) throw err;
    sent.push({ to, text });
    return { message_id: 1 };
  } } } as unknown as Telegraf;
  return { bot, sent };
}

test('delivery: routed to the assignee/customer, marked delivered, never sent twice', async () => {
  const ticketId = await newTicket({ claimBy: ADMIN_A });
  await addCustomerMessage({ telegramUserId: owner, ticketId, text: 'Salom admin', telegramMessageId: mid() });
  await addAdminReply({ actorTelegramId: ADMIN_A, actorName: 'A', ticketId, text: 'Salom mijoz', telegramMessageId: mid() });
  const { bot, sent } = fakeBot(() => undefined);
  await Promise.all([deliverSupportMessages(bot, [ticketId]), deliverSupportMessages(bot, [ticketId])]);
  await deliverSupportMessages(bot, [ticketId]);
  assert.equal(sent.length, 2);
  assert.ok(sent.some(s => s.to === ADMIN_A && s.text.includes('Salom admin')));
  assert.ok(sent.some(s => s.to === owner && s.text.includes('Salom mijoz')));
  assert.equal(await db.supportTicketMessage.count({ where: { ticketId, deliveredAt: null } }), 0);
});

test('delivery: transient failure backs off and retries; 403 dead-letters and warns the sender', async () => {
  const ticketId = await newTicket({ claimBy: ADMIN_A });
  await addAdminReply({ actorTelegramId: ADMIN_A, actorName: 'A', ticketId, text: 'Javob 1', telegramMessageId: mid() });
  const transient = fakeBot(to => to === owner ? new Error('ETIMEDOUT') : undefined);
  await deliverSupportMessages(transient.bot, [ticketId]);
  let m = await db.supportTicketMessage.findFirstOrThrow({ where: { ticketId } });
  assert.equal(m.deliveryAttempts, 1);
  assert.equal(m.deliveredAt, null);
  assert.equal(m.failedAt, null);
  assert.ok(m.nextAttemptAt.getTime() > Date.now());
  await deliverSupportMessages(transient.bot, [ticketId]); // not due yet: no second attempt
  assert.equal((await db.supportTicketMessage.findFirstOrThrow({ where: { ticketId } })).deliveryAttempts, 1);
  // make it due, then the customer has blocked the bot
  await db.supportTicketMessage.updateMany({ where: { ticketId }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
  const blocked = fakeBot(to => to === owner ? Object.assign(new Error('Forbidden: bot was blocked'), { response: { error_code: 403 } }) : undefined);
  await deliverSupportMessages(blocked.bot, [ticketId]);
  m = await db.supportTicketMessage.findFirstOrThrow({ where: { ticketId } });
  assert.ok(m.failedAt);
  assert.equal(m.deliveryAttempts, 2);
  assert.ok(m.lastError);
  assert.ok(blocked.sent.some(s => s.to === ADMIN_A && s.text.includes('yetkazilmadi')));
  // a dead-lettered message is never picked up again
  await deliverSupportMessages(blocked.bot, [ticketId]);
  assert.equal((await db.supportTicketMessage.findFirstOrThrow({ where: { ticketId } })).deliveryAttempts, 2);
});
