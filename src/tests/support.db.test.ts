import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { db } from '../lib/db.js';

const ADMIN_A = String(randomInt(100000000000, 400000000000));
const ADMIN_B = String(randomInt(400000000001, 700000000000));
process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = ADMIN_A;
process.env.SUPPORT_ADMIN_2_TELEGRAM_ID = ADMIN_B;
const {
  claimTicket, createTicket, resolveTicket, listActiveTickets, listCustomerTickets,
} = await import('../modules/support/service.js');

const owner = String(randomInt(700000000001, 800000000000));
const stranger = String(randomInt(800000000001, 900000000000));
let restaurantId = '';
const customerIds: string[] = [];
const orderIds: Record<string, string> = {};
const ticketIds: string[] = [];

async function newOrder(telegramUserId: string): Promise<string> {
  const customer = await db.customer.upsert({ where: { telegramUserId }, update: {}, create: { telegramUserId } });
  if (!customerIds.includes(customer.id)) customerIds.push(customer.id);
  const order = await db.order.create({
    data: { restaurantId, customerId: customer.id, addressText: 'test address', totalSom: 1000 },
  });
  return order.id;
}
async function newTicket(): Promise<string> {
  const orderId = await newOrder(owner);
  const r = await createTicket({ telegramUserId: owner, orderId, message: 'Buyurtma kechikdi' });
  assert.equal(r.result, 'CREATED');
  if (r.result !== 'CREATED') throw new Error('unreachable');
  ticketIds.push(r.ticketId);
  return r.ticketId;
}
const cb = () => randomUUID();

before(async () => {
  await db.$connect();
  restaurantId = (await db.restaurant.create({ data: { slug: `support-test-${randomUUID()}`, name: 'Support test' } })).id;
  orderIds.stranger = await newOrder(stranger);
});
after(async () => {
  await db.supportCallbackLog.deleteMany({ where: { ticketId: { in: ticketIds } } });
  await db.supportTicket.deleteMany({ where: { id: { in: ticketIds } } });
  await db.order.deleteMany({ where: { restaurantId } });
  await db.customer.deleteMany({ where: { id: { in: customerIds } } });
  await db.restaurant.delete({ where: { id: restaurantId } });
  await db.$disconnect();
});

test('ownership: foreign and unknown orders are rejected identically', async () => {
  const foreign = await createTicket({ telegramUserId: owner, orderId: orderIds.stranger!, message: 'Boshqaning buyurtmasi' });
  const missing = await createTicket({ telegramUserId: owner, orderId: 'nope', message: 'Mavjud emas buyurtma' });
  assert.deepEqual(foreign, { result: 'NOT_FOUND' });
  assert.deepEqual(missing, { result: 'NOT_FOUND' });
  assert.equal(await db.supportTicket.count({ where: { orderId: orderIds.stranger } }), 0);
});

test('one unresolved ticket per order; concurrent submits create exactly one', async () => {
  const orderId = await newOrder(owner);
  const results = await Promise.all(Array.from({ length: 6 }, () =>
    createTicket({ telegramUserId: owner, orderId, message: 'Takroriy murojaat' })));
  const created = results.filter(r => r.result === 'CREATED');
  assert.equal(created.length, 1);
  assert.equal(results.filter(r => r.result === 'ALREADY_OPEN').length, 5);
  for (const r of created) if (r.result === 'CREATED') ticketIds.push(r.ticketId);
});

test('a customer only lists their own tickets', async () => {
  await newTicket();
  assert.ok((await listCustomerTickets(owner)).length >= 1);
  assert.equal((await listCustomerTickets(stranger)).length, 0);
});

test('concurrent claims by both admins: exactly one winner, loser sees the owner', async () => {
  const ticketId = await newTicket();
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => claimTicket({
    actorTelegramId: i % 2 ? ADMIN_A : ADMIN_B, actorName: i % 2 ? 'Admin A' : 'Admin B',
    ticketId, callbackQueryId: cb(),
  })));
  assert.equal(results.filter(r => r.result === 'DONE').length, 1);
  const t = await db.supportTicket.findUniqueOrThrow({ where: { id: ticketId } });
  assert.equal(t.status, 'IN_PROGRESS');
  for (const r of results) {
    if (r.result === 'ALREADY_CLAIMED') {
      assert.equal(r.assignedAdminTelegramId, t.assignedAdminTelegramId);
      assert.equal(r.assignedAdminName, t.assignedAdminName);
    } else assert.equal(r.result, 'DONE');
  }
  assert.equal(await db.supportTicketEvent.count({ where: { ticketId, action: 'CLAIMED' } }), 1);
});

test('unauthorized users cannot claim, resolve or list', async () => {
  const ticketId = await newTicket();
  await assert.rejects(claimTicket({ actorTelegramId: stranger, actorName: 'x', ticketId, callbackQueryId: cb() }));
  await assert.rejects(claimTicket({ actorTelegramId: owner, actorName: 'x', ticketId, callbackQueryId: cb() }));
  await assert.rejects(resolveTicket({ actorTelegramId: stranger, ticketId, callbackQueryId: cb() }));
  await assert.rejects(listActiveTickets(stranger));
  const t = await db.supportTicket.findUniqueOrThrow({ where: { id: ticketId } });
  assert.equal(t.status, 'OPEN');
  assert.equal(t.assignedAdminTelegramId, null);
});

test('duplicate callback delivery is processed once (parallel and later)', async () => {
  const ticketId = await newTicket();
  const args = { actorTelegramId: ADMIN_A, actorName: 'Admin A', ticketId, callbackQueryId: cb() };
  const parallel = await Promise.all(Array.from({ length: 5 }, () => claimTicket(args)));
  assert.equal(parallel.filter(r => r.result === 'DONE').length, 1);
  assert.equal(parallel.filter(r => r.result === 'DUPLICATE').length, 4);
  assert.deepEqual(await claimTicket(args), { result: 'DUPLICATE' });
  assert.equal(await db.supportTicketEvent.count({ where: { ticketId } }), 2); // CREATED + CLAIMED
});

test('workflow: only the assignee resolves; audit trail is complete', async () => {
  const ticketId = await newTicket();
  assert.equal((await resolveTicket({ actorTelegramId: ADMIN_A, ticketId, callbackQueryId: cb() })).result, 'NOT_CLAIMED');
  assert.equal((await claimTicket({ actorTelegramId: ADMIN_A, actorName: 'Admin A', ticketId, callbackQueryId: cb() })).result, 'DONE');
  assert.deepEqual(await resolveTicket({ actorTelegramId: ADMIN_B, ticketId, callbackQueryId: cb() }),
    { result: 'NOT_YOURS', assignedAdminName: 'Admin A' });
  assert.equal((await db.supportTicket.findUniqueOrThrow({ where: { id: ticketId } })).status, 'IN_PROGRESS');
  assert.equal((await resolveTicket({ actorTelegramId: ADMIN_A, ticketId, callbackQueryId: cb() })).result, 'DONE');
  assert.equal((await resolveTicket({ actorTelegramId: ADMIN_A, ticketId, callbackQueryId: cb() })).result, 'ALREADY_RESOLVED');
  assert.equal((await claimTicket({ actorTelegramId: ADMIN_B, actorName: 'Admin B', ticketId, callbackQueryId: cb() })).result, 'ALREADY_RESOLVED');
  const t = await db.supportTicket.findUniqueOrThrow({ where: { id: ticketId } });
  assert.equal(t.status, 'RESOLVED');
  assert.ok(t.resolvedAt);
  assert.equal(t.customerNotifiedAt, null); // pending for the notifier
  const actions = (await db.supportTicketEvent.findMany({ where: { ticketId } })).map(e => e.action);
  for (const a of ['CREATED', 'CLAIMED', 'RESOLVED', 'RESOLVE_REJECTED']) assert.ok(actions.includes(a), a);
});

test('database rejects an ownerless IN_PROGRESS ticket', async () => {
  const ticketId = await newTicket();
  await assert.rejects(db.$executeRaw`UPDATE "SupportTicket" SET "status" = 'IN_PROGRESS' WHERE "id" = ${ticketId}`);
});
