import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { accrueCommissionTx } from '../modules/commission/ledger.js';
import { commissionStatements, settleRestaurant, weekStartTashkent } from '../modules/commission/settlement.js';
import { renderStatements } from '../bot/commission-admin.js';

// Stage 8C: weekly commission settlement. ds_delivery_test only. Orders are built directly (no Telegram, no money).
delete process.env.COMMISSION_FLAT_SOM;
const ADMIN = String(randomInt(100000000001, 200000000000));
const db = new PrismaClient();
const nonce = randomUUID().slice(0, 8);
const ids: Record<string, string> = {};
let customerId = '';
let savedAdmin: string | undefined;
const NEXT_WEEK = new Date(Date.now() + 10 * 86_400_000); // entries accrued "now" are in a closed week by then

/** A delivered, verified order with its commission accrued (what the delivery stage does). */
async function earned(restaurantId: string, som = 21_000) {
  const matched = await db.incomingTransaction.create({
    data: { sourceId: `cs-${randomUUID()}`, source: 'test', cardLast4: '0000', amountTiyin: BigInt(som) * 100n, occurredAt: new Date() },
  });
  const order = await db.order.create({ data: {
    restaurantId, customerId, addressText: 'x', totalSom: som, createdViaBot: true, status: 'PAYMENT_CONFIRMED', paymentIsTest: false,
    payment: { create: { restaurantId, amountTiyin: BigInt(som) * 100n, status: 'CONFIRMED_MANUAL', isTest: false, matchedTransactionId: matched.id } },
  } });
  const r = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
    await tx.order.update({ where: { id: order.id }, data: { status: 'COMPLETED' } });
    await tx.orderEvent.create({ data: { orderId: order.id, actorTelegramId: 'test', actorType: 'SYSTEM', action: 'TEST_DELIVERY', fromStatus: 'PAYMENT_CONFIRMED', toStatus: 'COMPLETED' } });
    return accrueCommissionTx(tx, order.id, { id: 'system', type: 'SYSTEM' });
  });
  assert.equal(r.result, 'ACCRUED');
  return { orderId: order.id, entryId: (r as { entryId: string }).entryId };
}
const statement = async (restaurantId: string, now: Date) => (await commissionStatements(now)).find(s => s.restaurantId === restaurantId);

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  savedAdmin = process.env.SUPPORT_ADMIN_1_TELEGRAM_ID;
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = ADMIN;
  for (const k of ['a', 'b']) ids[k] = (await db.restaurant.create({ data: { slug: `cs-${k}-${nonce}`, name: `CS ${k.toUpperCase()} ${nonce}` } })).id;
  customerId = (await db.customer.create({ data: { telegramUserId: String(randomInt(900000000001, 990000000000)) } })).id;
});

after(async () => {
  if (savedAdmin === undefined) delete process.env.SUPPORT_ADMIN_1_TELEGRAM_ID; else process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = savedAdmin;
  const rids = Object.values(ids);
  const orders = (await db.order.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(o => o.id);
  await db.$transaction(async tx => { // ledger and settlements are append-only; this switch exists for exactly this cleanup
    await tx.$executeRaw`SELECT set_config('ds.ledger_cleanup', 'on', true)`;
    await tx.commissionSettlementEntry.deleteMany({ where: { settlement: { restaurantId: { in: rids } } } });
    await tx.commissionSettlement.deleteMany({ where: { restaurantId: { in: rids } } });
    await tx.commissionEvent.deleteMany({ where: { entry: { restaurantId: { in: rids } } } });
    await tx.commissionEntry.deleteMany({ where: { restaurantId: { in: rids } } });
  });
  await db.supportTicket.deleteMany({ where: { orderId: { in: orders } } });
  const pays = await db.payment.findMany({ where: { restaurantId: { in: rids } }, select: { id: true, matchedTransactionId: true } });
  await db.payment.deleteMany({ where: { id: { in: pays.map(p => p.id) } } });
  await db.incomingTransaction.deleteMany({ where: { id: { in: pays.map(p => p.matchedTransactionId).filter((x): x is string => !!x) } } });
  await db.order.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.customer.deleteMany({ where: { id: customerId } });
  await db.restaurant.deleteMany({ where: { id: { in: rids } } });
  await db.$disconnect();
});

test('the week is Monday 00:00 to Monday 00:00 in Asia/Tashkent', () => {
  assert.equal(weekStartTashkent(new Date('2026-10-21T12:00:00Z')).toISOString(), '2026-10-18T19:00:00.000Z'); // Wednesday -> Monday 19 Oct 00:00 +05
  assert.equal(weekStartTashkent(new Date('2026-10-18T19:00:00Z')).toISOString(), '2026-10-18T19:00:00.000Z'); // exactly Monday 00:00
  assert.equal(weekStartTashkent(new Date('2026-10-18T18:59:59Z')).toISOString(), '2026-10-11T19:00:00.000Z'); // one second earlier: still last week (Sunday 23:59 local)
  assert.equal(weekStartTashkent(new Date('2026-10-25T20:00:00Z')).toISOString(), '2026-10-25T19:00:00.000Z'); // Monday 01:00 local
});

test('statements split what is due, what an open ticket holds and the running week', async () => {
  const a1 = await earned(ids.a!);
  await earned(ids.a!);
  const held = await earned(ids.a!);
  await earned(ids.b!);
  assert.deepEqual((await statement(ids.a!, new Date()))!.current, { count: 3, amountSom: 15_000 }, 'this week is not collectable yet');
  assert.equal((await statement(ids.a!, new Date()))!.due.count, 0);
  const due = await statement(ids.a!, NEXT_WEEK);
  assert.deepEqual(due!.due, { count: 3, amountSom: 15_000 });
  assert.deepEqual((await statement(ids.b!, NEXT_WEEK))!.due, { count: 1, amountSom: 5_000 });

  const ticket = await db.supportTicket.create({ data: { orderId: held.orderId, customerId, message: 'buyurtma kelmadi' } });
  const s = await statement(ids.a!, NEXT_WEEK);
  assert.deepEqual(s!.due, { count: 2, amountSom: 10_000 });
  assert.deepEqual(s!.held, { count: 1, amountSom: 5_000 });
  const view = renderStatements([s!]);
  assert.match(view.text, /CS A/);
  assert.match(view.text, /2 ta • 10,000 so‘m/);
  assert.ok(JSON.stringify(view.keyboard?.reply_markup).includes(`com:ask:${ids.a}`));
  await db.supportTicket.update({ where: { id: ticket.id }, data: { status: 'RESOLVED', resolvedAt: new Date(), assignedAdminTelegramId: ADMIN, assignedAdminName: 'Admin' } });
  assert.deepEqual((await statement(ids.a!, NEXT_WEEK))!.due, { count: 3, amountSom: 15_000 }, 'a resolved ticket releases the commission');
  void a1;
});

test('only an administrator, with a real note, and only for the amounts they confirmed on screen', async () => {
  const input = { restaurantId: ids.a!, expectedCount: 3, expectedSom: 15_000, note: 'Bankda 15 000 kirim ko‘rildi, 22.10 14:05' };
  await assert.rejects(settleRestaurant({ ...input, adminId: '999' }, NEXT_WEEK), /ADMIN_RUXSAT_YOQ/);
  await assert.rejects(settleRestaurant({ ...input, adminId: ADMIN, note: 'qisqa' }, NEXT_WEEK), /ADMIN_IZOH_NOTOGRI/);
  assert.deepEqual(await settleRestaurant({ ...input, adminId: ADMIN, expectedSom: 10_000 }, NEXT_WEEK), { result: 'CHANGED', count: 3, amountSom: 15_000 });
  assert.deepEqual(await settleRestaurant({ ...input, adminId: ADMIN, expectedCount: 2 }, NEXT_WEEK), { result: 'CHANGED', count: 3, amountSom: 15_000 });
  assert.equal(await db.commissionSettlement.count({ where: { restaurantId: ids.a } }), 0, 'nothing was recorded by the refusals');
  // the running week is never collectable
  assert.deepEqual(await settleRestaurant({ ...input, adminId: ADMIN }, new Date()), { result: 'NOTHING_DUE' });
});

test('settling records the covered entries once; a double press or a second administrator cannot record it again', async () => {
  const input = { restaurantId: ids.a!, adminId: ADMIN, expectedCount: 3, expectedSom: 15_000, note: 'Bankda 15 000 kirim ko‘rildi, 22.10 14:05' };
  const [x, y] = await Promise.all([settleRestaurant(input, NEXT_WEEK), settleRestaurant(input, NEXT_WEEK)]);
  assert.deepEqual([x.result, y.result].sort(), ['NOTHING_DUE', 'SETTLED']);
  const settlement = await db.commissionSettlement.findFirstOrThrow({ where: { restaurantId: ids.a }, include: { entries: true } });
  assert.equal(settlement.entryCount, 3);
  assert.equal(settlement.amountSom, 15_000);
  assert.equal(settlement.confirmedBy, ADMIN);
  assert.equal(settlement.entries.length, 3);
  assert.equal(await db.commissionSettlement.count({ where: { restaurantId: ids.a } }), 1);
  assert.equal(await statement(ids.a!, NEXT_WEEK), undefined, 'nothing left to collect');
  const events = await db.commissionEvent.findMany({ where: { entryId: { in: settlement.entries.map(e => e.entryId) }, action: 'SETTLED' } });
  assert.equal(events.length, 3);
  assert.deepEqual(await settleRestaurant(input, NEXT_WEEK), { result: 'NOTHING_DUE' });
  // the other restaurant is untouched
  assert.deepEqual((await statement(ids.b!, NEXT_WEEK))!.due, { count: 1, amountSom: 5_000 });
  // a commission earned afterwards is a new debt
  await earned(ids.a!);
  assert.deepEqual((await statement(ids.a!, NEXT_WEEK))!.due, { count: 1, amountSom: 5_000 });
});

test('the database keeps settlements honest: own restaurant only, one settlement per entry, never edited or deleted', async () => {
  const settlement = await db.commissionSettlement.findFirstOrThrow({ where: { restaurantId: ids.a }, include: { entries: true } });
  const foreign = await db.commissionEntry.findFirstOrThrow({ where: { restaurantId: ids.b } });
  await assert.rejects(db.commissionSettlementEntry.create({ data: { settlementId: settlement.id, entryId: foreign.id } }), /SETTLEMENT_RESTAURANT_MISMATCH/);
  await assert.rejects(db.commissionSettlementEntry.create({ data: { settlementId: settlement.id, entryId: settlement.entries[0]!.entryId } }), /Unique constraint|unique/i);
  await assert.rejects(db.commissionSettlement.update({ where: { id: settlement.id }, data: { amountSom: 1 } }), /LEDGER_APPEND_ONLY/);
  await assert.rejects(db.commissionSettlement.delete({ where: { id: settlement.id } }), /LEDGER_APPEND_ONLY|foreign key|violates/i);
  await assert.rejects(db.commissionSettlement.create({ data: { restaurantId: ids.a!, cutoffAt: new Date(), entryCount: 1, amountSom: 5000, confirmedBy: ADMIN, note: 'short' } }), /CommissionSettlement_note_len|check constraint/i);
  await assert.rejects(db.commissionSettlement.create({ data: { restaurantId: ids.a!, cutoffAt: new Date(), entryCount: 0, amountSom: 0, confirmedBy: ADMIN, note: 'long enough note here' } }), /CommissionSettlement_positive|check constraint/i);
});
