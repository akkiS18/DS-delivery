import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { hashToken } from '../modules/admin-auth/service.js';
import { setSupportSync } from '../modules/admin-support/service.js';

// DS Admin A4a (support inbox, conversation, ticket actions). Needs a *_test database (the repo's DB guard). Two administrators are made up so the
// "somebody else owns it" paths can be exercised; SupportTicket rows go away with their orders, audit rows stay under the unique actor ids.
const db = new PrismaClient();
const app = buildApp(new PaymentEngineV3(db, defaultOptions, () => {}));
const tag = randomUUID().slice(0, 8);
const newId = () => `9${randomInt(100_000_000, 999_999_999)}${randomInt(100, 999)}`;
const adminA = newId();
const adminB = newId();
const tokenA = randomBytes(32).toString('base64url');
const tokenB = randomBytes(32).toString('base64url');
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const api = (method: 'GET' | 'POST', url: string, payload?: object, headers: Record<string, string> = as(tokenA)) =>
  app.inject({ method, url: `/api/v1/admin${url}`, headers, ...(payload ? { payload } : {}) });
const key = () => randomBytes(12).toString('base64url');

const saved = { ...process.env };
const synced: string[] = [];
const ids = { restaurant: '', customer: '', appCustomer: '' };
const orders: string[] = [];

async function makeTicket(opts: { app?: boolean } = {}): Promise<{ id: string; number: number }> {
  const customerId = opts.app ? ids.appCustomer : ids.customer;
  const order = await db.order.create({ data: { restaurantId: ids.restaurant, customerId, addressText: 'x', totalSom: 25_000, createdViaBot: true, status: 'COMPLETED' } });
  orders.push(order.id);
  const t = await db.supportTicket.create({ data: { orderId: order.id, customerId, message: 'Taom sovuq keldi' } });
  return { id: t.id, number: t.number };
}

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  process.env.ADMIN_APP_ENABLED = 'true';
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = adminA;
  process.env.SUPPORT_ADMIN_2_TELEGRAM_ID = adminB;
  setSupportSync(async id => { synced.push(id); });
  for (const [token, tg] of [[tokenA, adminA], [tokenB, adminB]] as const) {
    await db.adminSession.create({ data: { tokenHash: hashToken(token), telegramUserId: tg, expiresAt: new Date(Date.now() + 3_600_000) } });
  }
  ids.restaurant = (await db.restaurant.create({ data: { slug: `sup-${tag}`, name: `Yordam ${tag}` } })).id;
  ids.customer = (await db.customer.create({ data: { telegramUserId: String(randomInt(900000000001, 990000000000)), displayName: `Mijoz ${tag}`, phone: '+998901112233' } })).id;
  ids.appCustomer = (await db.customer.create({ data: { telegramUserId: null, displayName: `Ilova ${tag}` } })).id;
});

after(async () => {
  setSupportSync(null);
  await db.supportCallbackLog.deleteMany({ where: { actorTelegramId: { in: [adminA, adminB] } } });
  await db.order.deleteMany({ where: { id: { in: orders } } }); // tickets, messages and events cascade
  await db.customer.deleteMany({ where: { id: { in: [ids.customer, ids.appCustomer] } } });
  await db.restaurant.deleteMany({ where: { id: ids.restaurant } });
  await db.adminSession.deleteMany({ where: { telegramUserId: { in: [adminA, adminB] } } });
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  await app.close();
  await db.$disconnect();
});

test('every support route needs an admin session and the switch', async () => {
  for (const [m, u, body] of [
    ['GET', '/tickets', undefined], ['GET', '/tickets/x', undefined], ['POST', '/tickets/x/claim', { clientKey: key() }], ['POST', '/tickets/x/resolve', { clientKey: key() }],
    ['POST', '/tickets/x/reopen', { clientKey: key() }], ['POST', '/tickets/x/reassign', { clientKey: key(), targetTelegramId: '1' }], ['POST', '/tickets/x/reply', { clientKey: key(), text: 'salom' }],
  ] as const) {
    assert.equal((await api(m, u, body, {})).statusCode, 401, u);
    assert.equal((await api(m, u, body, as('x'.repeat(43)))).statusCode, 401, u);
  }
  process.env.ADMIN_APP_ENABLED = 'false';
  try { assert.equal((await api('GET', '/tickets')).statusCode, 404); } finally { process.env.ADMIN_APP_ENABLED = 'true'; }
});

test('a new ticket is in the inbox, waiting for an answer, and its thread starts with the customer message', async () => {
  const t = await makeTicket();
  const inbox = (await api('GET', '/tickets')).json();
  const row = inbox.active.find((r: { id: string }) => r.id === t.id);
  assert.ok(row, 'listed');
  assert.equal(row.status, 'OPEN');
  assert.equal(row.waiting, true);
  assert.equal(row.mine, false);
  assert.equal(row.customerName, `Mijoz ${tag}`);
  const th = (await api('GET', `/tickets/${t.id}`)).json();
  assert.equal(th.messages.length, 1);
  assert.equal(th.messages[0].from, 'CUSTOMER');
  assert.equal(th.messages[0].text, 'Taom sovuq keldi');
  assert.equal(th.customer.phone, '+998901112233');
  assert.equal(th.customer.viaApp, false);
  assert.deepEqual(th.others.map((o: { telegramId: string }) => o.telegramId), [adminB]);
  assert.equal((await api('GET', '/tickets/nope')).statusCode, 404);
});

test('claim: once, a retry with the same key is harmless, the other administrator is told who has it', async () => {
  const t = await makeTicket();
  const k = key();
  synced.length = 0;
  const first = await api('POST', `/tickets/${t.id}/claim`, { clientKey: k });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().result, 'DONE');
  assert.deepEqual(synced, [t.id], 'the Telegram copies are refreshed');
  const retry = await api('POST', `/tickets/${t.id}/claim`, { clientKey: k });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().result, 'DUPLICATE');
  const other = await api('POST', `/tickets/${t.id}/claim`, { clientKey: key() }, as(tokenB));
  assert.equal(other.statusCode, 409);
  assert.equal(other.json().error, 'ALREADY_CLAIMED');
  assert.equal(other.json().assignedAdminTelegramId, adminA);
  const row = (await api('GET', '/tickets')).json().active.find((r: { id: string }) => r.id === t.id);
  assert.equal(row.mine, true);
  assert.equal(row.status, 'IN_PROGRESS');
  assert.equal((await api('POST', '/tickets/nope/claim', { clientKey: key() })).statusCode, 404);
});

test('reply: stored once even when retried, only the owner may write, an empty text is refused', async () => {
  const t = await makeTicket({ app: true });
  await api('POST', `/tickets/${t.id}/claim`, { clientKey: key() });
  const k = key();
  const sent = await api('POST', `/tickets/${t.id}/reply`, { clientKey: k, text: '  Uzr, hozir tuzatamiz.  ' });
  assert.equal(sent.statusCode, 200, sent.body);
  assert.equal(sent.json().result, 'SENT');
  const again = await api('POST', `/tickets/${t.id}/reply`, { clientKey: k, text: '  Uzr, hozir tuzatamiz.  ' });
  assert.equal(again.json().result, 'DUPLICATE');
  const msgs = await db.supportTicketMessage.findMany({ where: { ticketId: t.id } });
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0]?.text, 'Uzr, hozir tuzatamiz.');
  assert.equal(msgs[0]?.senderType, 'ADMIN');
  assert.equal(msgs[0]?.telegramMessageId, null);
  assert.equal(msgs[0]?.clientKey, k);
  const th = (await api('GET', `/tickets/${t.id}`)).json();
  assert.equal(th.customer.viaApp, true);
  assert.equal(th.ticket.waiting, false, 'an admin wrote last');
  const foreign = await api('POST', `/tickets/${t.id}/reply`, { clientKey: key(), text: 'Men yozaman' }, as(tokenB));
  assert.equal(foreign.statusCode, 409);
  assert.equal(foreign.json().error, 'NOT_YOURS');
  assert.equal((await api('POST', `/tickets/${t.id}/reply`, { clientKey: key(), text: '   ' })).statusCode, 400);
  assert.equal((await api('POST', `/tickets/${t.id}/reply`, { clientKey: key(), text: 'x'.repeat(1001) })).statusCode, 400);
  assert.equal((await api('POST', `/tickets/${t.id}/reply`, { clientKey: 'short', text: 'salom' })).statusCode, 400, 'a weak client key is refused');
  assert.equal(await db.supportTicketMessage.count({ where: { ticketId: t.id } }), 1);
});

test('replying to a ticket nobody has taken takes it first, like Telegram quote-reply', async () => {
  const t = await makeTicket();
  const r = await api('POST', `/tickets/${t.id}/reply`, { clientKey: key(), text: 'Salom, ko‘ryapmiz' });
  assert.equal(r.statusCode, 200, r.body);
  const row = await db.supportTicket.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(row.status, 'IN_PROGRESS');
  assert.equal(row.assignedAdminTelegramId, adminA);
  assert.equal(await db.supportTicketMessage.count({ where: { ticketId: t.id } }), 1);
  // A ticket the first administrator already owns: the second administrator's reply does not take it over and writes nothing.
  const u = await makeTicket();
  await api('POST', `/tickets/${u.id}/claim`, { clientKey: key() });
  const blocked = await api('POST', `/tickets/${u.id}/reply`, { clientKey: key(), text: 'Men javob beraman' }, as(tokenB));
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().error, 'NOT_YOURS');
  assert.equal(await db.supportTicketMessage.count({ where: { ticketId: u.id } }), 0);
  assert.equal((await db.supportTicket.findUniqueOrThrow({ where: { id: u.id } })).assignedAdminTelegramId, adminA);
});

test('hand over, resolve and reopen follow the same rules as the bot', async () => {
  const t = await makeTicket();
  await api('POST', `/tickets/${t.id}/claim`, { clientKey: key() });
  const bad = await api('POST', `/tickets/${t.id}/reassign`, { clientKey: key(), targetTelegramId: '123456789' });
  assert.equal(bad.statusCode, 409);
  assert.equal(bad.json().error, 'INVALID_TARGET');
  const same = await api('POST', `/tickets/${t.id}/reassign`, { clientKey: key(), targetTelegramId: adminA });
  assert.equal(same.statusCode, 409);
  assert.equal(same.json().error, 'SAME_ADMIN');
  const moved = await api('POST', `/tickets/${t.id}/reassign`, { clientKey: key(), targetTelegramId: adminB });
  assert.equal(moved.statusCode, 200, moved.body);
  assert.equal((await db.supportTicket.findUniqueOrThrow({ where: { id: t.id } })).assignedAdminTelegramId, adminB);
  const notMine = await api('POST', `/tickets/${t.id}/resolve`, { clientKey: key() });
  assert.equal(notMine.statusCode, 409);
  assert.equal(notMine.json().error, 'NOT_YOURS');
  const done = await api('POST', `/tickets/${t.id}/resolve`, { clientKey: key() }, as(tokenB));
  assert.equal(done.statusCode, 200, done.body);
  const inbox = (await api('GET', '/tickets')).json();
  assert.ok(inbox.resolved.some((r: { id: string }) => r.id === t.id), 'shows under resolved');
  assert.ok(!inbox.active.some((r: { id: string }) => r.id === t.id));
  const reopened = await api('POST', `/tickets/${t.id}/reopen`, { clientKey: key() });
  assert.equal(reopened.statusCode, 200, reopened.body);
  const row = await db.supportTicket.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(row.status, 'OPEN');
  assert.equal(row.assignedAdminTelegramId, null);
  const notResolved = await api('POST', `/tickets/${t.id}/reopen`, { clientKey: key() });
  assert.equal(notResolved.statusCode, 409);
  assert.equal(notResolved.json().error, 'NOT_RESOLVED');
});

test('two taps at once claim a ticket exactly once', async () => {
  const t = await makeTicket();
  const [a, b] = await Promise.all([
    api('POST', `/tickets/${t.id}/claim`, { clientKey: key() }),
    api('POST', `/tickets/${t.id}/claim`, { clientKey: key() }, as(tokenB)),
  ]);
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 409]);
  const row = await db.supportTicket.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(row.status, 'IN_PROGRESS');
  assert.equal(await db.supportTicketEvent.count({ where: { ticketId: t.id, action: 'CLAIMED' } }), 1);
});
