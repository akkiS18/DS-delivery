import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { accrueCommissionTx } from '../modules/commission/ledger.js';
import { commissionStatements, settleRestaurant } from '../modules/commission/settlement.js';
import { waiveCommission } from '../modules/commission/waiver.js';
import { dateKey, markPayoutPaid, payoutDayDetail } from '../modules/admin-payouts/service.js';
import { financeSummary } from '../modules/restaurant-finance/service.js';

// Commission waiver (owner decision 2026-11-05). Needs a *_test database (the repo's DB guard). Orders are built directly (no Telegram, no money).
// The ledger, the waivers and the audit table are append-only: the ledger/waiver rows are removed through the test-cleanup switch, audit rows stay under a unique actor id.
delete process.env.COMMISSION_FLAT_SOM;
const db = new PrismaClient();
const tag = randomUUID().slice(0, 8);
const ADMIN = `9${randomInt(100_000_000, 999_999_999)}${randomInt(100, 999)}`;
const NOW = new Date();
const NEXT_WEEK = new Date(Date.now() + 10 * 86_400_000);
const saved = { admin1: process.env.SUPPORT_ADMIN_1_TELEGRAM_ID, admin2: process.env.SUPPORT_ADMIN_2_TELEGRAM_ID };
const ids = { pool: '', own: '', customer: '', platformCard: '', ownCard: '' };
const transactions: string[] = [];
const last4 = () => String(randomInt(1000, 9999));

async function delivered(restaurantId: string, cardId: string, som: number) {
  const tx = await db.incomingTransaction.create({
    data: { sourceId: `cw-${randomUUID()}`, source: 'test', cardLast4: '0000', amountTiyin: BigInt(som) * 100n, occurredAt: new Date() },
  });
  transactions.push(tx.id);
  const order = await db.order.create({ data: {
    restaurantId, customerId: ids.customer, addressText: 'x', totalSom: som, createdViaBot: true, status: 'PAYMENT_CONFIRMED', paymentIsTest: false,
    payment: { create: { restaurantId, amountTiyin: BigInt(som) * 100n, isTest: false, status: 'CONFIRMED_MANUAL', cardId, matchedTransactionId: tx.id } },
  } });
  await db.$transaction(async t => {
    await t.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
    await t.order.update({ where: { id: order.id }, data: { status: 'COMPLETED' } });
    await t.orderEvent.create({ data: { orderId: order.id, actorTelegramId: 'test', actorType: 'SYSTEM', action: 'TEST_DELIVERY', fromStatus: 'PAYMENT_CONFIRMED', toStatus: 'COMPLETED' } });
    assert.equal((await accrueCommissionTx(t, order.id, { id: 'system', type: 'SYSTEM' })).result, 'ACCRUED');
  });
  return db.order.findUniqueOrThrow({ where: { id: order.id }, select: { id: true, code: true } });
}

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = ADMIN;
  delete process.env.SUPPORT_ADMIN_2_TELEGRAM_ID;
  ids.pool = (await db.restaurant.create({ data: { slug: `cw-pool-${tag}`, name: `CW Pool ${tag}`, collectsToPlatform: true } })).id;
  ids.own = (await db.restaurant.create({ data: { slug: `cw-own-${tag}`, name: `CW Own ${tag}` } })).id;
  ids.customer = (await db.customer.create({ data: { telegramUserId: String(randomInt(900000000001, 990000000000)) } })).id;
  ids.platformCard = (await db.card.create({ data: { restaurantId: null, last4: last4(), holderName: 'TEST' } })).id;
  ids.ownCard = (await db.card.create({ data: { restaurantId: ids.own, last4: last4(), holderName: 'TEST' } })).id;
});

after(async () => {
  const rids = [ids.pool, ids.own];
  const orders = (await db.order.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(o => o.id);
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('ds.ledger_cleanup', 'on', true)`;
    await tx.commissionWaiver.deleteMany({ where: { restaurantId: { in: rids } } });
    await tx.commissionSettlementEntry.deleteMany({ where: { settlement: { restaurantId: { in: rids } } } });
    await tx.commissionSettlement.deleteMany({ where: { restaurantId: { in: rids } } });
    await tx.commissionEvent.deleteMany({ where: { entry: { restaurantId: { in: rids } } } });
    await tx.commissionEntry.deleteMany({ where: { restaurantId: { in: rids } } });
  });
  await db.payoutMark.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.payment.deleteMany({ where: { orderId: { in: orders } } });
  await db.incomingTransaction.deleteMany({ where: { id: { in: transactions } } });
  await db.order.deleteMany({ where: { id: { in: orders } } });
  await db.card.deleteMany({ where: { id: { in: [ids.platformCard, ids.ownCard] } } });
  await db.customer.deleteMany({ where: { id: ids.customer } });
  await db.restaurant.deleteMany({ where: { id: { in: rids } } });
  for (const [k, v] of [['SUPPORT_ADMIN_1_TELEGRAM_ID', saved.admin1], ['SUPPORT_ADMIN_2_TELEGRAM_ID', saved.admin2]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await db.$disconnect();
});

const REASON = 'Egasining o‘z buyurtmasi, komissiya olinmaydi';

test('a waived fee leaves the daily payout: payable is the whole 54 000 and the transfer can be recorded', async () => {
  const o = await delivered(ids.pool, ids.platformCard, 54_000);
  const before = await payoutDayDetail(dateKey(NOW), ids.pool);
  assert.equal(before!.commissionSom, 5_000);
  assert.equal(before!.payableSom, 49_000);

  const w = await waiveCommission({ adminId: ADMIN, orderCode: o.code, reason: REASON });
  assert.deepEqual(w, { result: 'WAIVED', orderCode: o.code, restaurantName: `CW Pool ${tag}`, amountSom: 5_000 });

  const after = await payoutDayDetail(dateKey(NOW), ids.pool);
  assert.equal(after!.commissionSom, 0);
  assert.equal(after!.payableSom, 54_000);
  assert.equal(after!.orders[0]!.commissionSom, 0);
  // the ledger entry itself is unchanged
  assert.equal((await db.commissionEntry.findUniqueOrThrow({ where: { orderId: o.id } })).amountSom, 5_000);

  assert.deepEqual(await markPayoutPaid({ adminId: ADMIN, date: dateKey(NOW), restaurantId: ids.pool, expectedSom: 54_000 }), { result: 'MARKED', amountSom: 54_000 });
  const fin = await financeSummary(ids.pool, {});
  assert.equal(fin.payout.unpaid.payableSom, 0, 'transferred: nothing left to pay');
  assert.equal(fin.commission.nettedByPlatform.som, 0, 'a waived fee is not netted either');
});

test('waiving twice, or from two taps at once, writes exactly one waiver', async () => {
  const o = await delivered(ids.pool, ids.platformCard, 30_000);
  const results = await Promise.all(Array.from({ length: 6 }, () => waiveCommission({ adminId: ADMIN, orderCode: o.code, reason: REASON })));
  assert.equal(results.filter(r => r.result === 'WAIVED').length, 1);
  assert.equal(results.filter(r => r.result === 'ALREADY_WAIVED').length, 5);
  const entry = await db.commissionEntry.findUniqueOrThrow({ where: { orderId: o.id }, include: { waiver: true } });
  assert.equal(entry.waiver!.waivedBy, ADMIN);
  assert.equal(await db.commissionWaiver.count({ where: { entryId: entry.id } }), 1);
  assert.equal(await db.commissionEvent.count({ where: { entryId: entry.id, action: 'WAIVED' } }), 1);
  assert.equal(await db.adminAuditEvent.count({ where: { actorId: ADMIN, action: 'COMMISSION_WAIVED', targetId: ids.pool } }) >= 1, true);
});

test('only a support administrator, with a written reason, for a real delivered order', async () => {
  const o = await delivered(ids.pool, ids.platformCard, 20_000);
  await assert.rejects(waiveCommission({ adminId: '1', orderCode: o.code, reason: REASON }), /ADMIN_RUXSAT_YOQ/);
  await assert.rejects(waiveCommission({ adminId: ADMIN, orderCode: o.code, reason: 'qisqa' }), /ADMIN_IZOH_NOTOGRI/);
  assert.equal(await db.commissionWaiver.count({ where: { entry: { orderId: o.id } } }), 0);
  assert.deepEqual(await waiveCommission({ adminId: ADMIN, orderCode: 'ZZZZZZ9', reason: REASON }), { result: 'NOT_FOUND' });
  assert.deepEqual(await waiveCommission({ adminId: ADMIN, orderCode: '!!', reason: REASON }), { result: 'NOT_FOUND' });
  const open = await db.order.create({ data: { restaurantId: ids.pool, customerId: ids.customer, addressText: 'x', totalSom: 10_000, createdViaBot: true, status: 'PREPARING', paymentIsTest: false } });
  const code = (await db.order.findUniqueOrThrow({ where: { id: open.id }, select: { code: true } })).code;
  assert.deepEqual(await waiveCommission({ adminId: ADMIN, orderCode: code, reason: REASON }), { result: 'NO_COMMISSION', orderCode: code });
});

test('an own-card order: the waived fee is not on the weekly statement; a settled one cannot be waived', async () => {
  const waived = await delivered(ids.own, ids.ownCard, 40_000);
  await delivered(ids.own, ids.ownCard, 40_000);
  const settledLater = await delivered(ids.own, ids.ownCard, 40_000);
  assert.deepEqual((await commissionStatements(NEXT_WEEK)).find(s => s.restaurantId === ids.own)!.due, { count: 3, amountSom: 15_000 });

  assert.equal((await waiveCommission({ adminId: ADMIN, orderCode: waived.code, reason: REASON })).result, 'WAIVED');
  assert.deepEqual((await commissionStatements(NEXT_WEEK)).find(s => s.restaurantId === ids.own)!.due, { count: 2, amountSom: 10_000 });
  const fin = await financeSummary(ids.own, {});
  assert.equal(fin.commission.outstandingLiability.som, 10_000);

  // the weekly settlement covers exactly the two unwaived entries
  const s = await settleRestaurant({ restaurantId: ids.own, adminId: ADMIN, expectedCount: 2, expectedSom: 10_000, note: 'bankda ko‘rildi, test yozuvi' }, NEXT_WEEK);
  assert.equal(s.result, 'SETTLED');
  assert.equal(await db.commissionSettlementEntry.count({ where: { entry: { orderId: waived.id } } }), 0);
  assert.deepEqual(await waiveCommission({ adminId: ADMIN, orderCode: settledLater.code, reason: REASON }), { result: 'SETTLED', orderCode: settledLater.code });
});

test('the database itself refuses to change or delete a waiver, and a second one for the same entry', async () => {
  const o = await delivered(ids.pool, ids.platformCard, 25_000);
  await waiveCommission({ adminId: ADMIN, orderCode: o.code, reason: REASON });
  const w = await db.commissionWaiver.findFirstOrThrow({ where: { entry: { orderId: o.id } } });
  await assert.rejects(db.commissionWaiver.update({ where: { id: w.id }, data: { reason: 'boshqa sabab yozildi' } }), /LEDGER_APPEND_ONLY/);
  await assert.rejects(db.commissionWaiver.delete({ where: { id: w.id } }), /LEDGER_APPEND_ONLY/);
  await assert.rejects(db.commissionWaiver.create({ data: { entryId: w.entryId, restaurantId: ids.pool, amountSom: 5_000, reason: REASON, waivedBy: ADMIN } }), /Unique constraint/);
  await assert.rejects(db.commissionWaiver.create({ data: { entryId: w.entryId, restaurantId: ids.pool, amountSom: 0, reason: REASON, waivedBy: ADMIN } }));
});
