import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { hashToken } from '../modules/admin-auth/service.js';
import { accrueCommissionTx } from '../modules/commission/ledger.js';
import { commissionStatements, settleRestaurant } from '../modules/commission/settlement.js';
import { dateKey, dayStart } from '../modules/admin-payouts/service.js';

// DS Admin A5a (daily payout report). Needs a *_test database (the repo's DB guard). Orders are built directly (no Telegram, no money).
// Every row it makes is removed again; the audit table is append-only (rows stay under a unique actor id).
delete process.env.COMMISSION_FLAT_SOM;
const db = new PrismaClient();
const app = buildApp(new PaymentEngineV3(db, defaultOptions, () => {}));
const tag = randomUUID().slice(0, 8);
const adminId = `9${randomInt(100_000_000, 999_999_999)}${randomInt(100, 999)}`;
const token = randomBytes(32).toString('base64url');
const auth = { authorization: `Bearer ${token}` };
const api = (url: string, headers: Record<string, string> = auth) => app.inject({ method: 'GET', url: `/api/v1/admin${url}`, headers });
const post = (url: string, payload: unknown, headers: Record<string, string> = auth) => app.inject({ method: 'POST', url: `/api/v1/admin${url}`, headers, payload: payload as object });

const saved = { ...process.env };
const ids = { pool: '', own: '', customer: '', platformCard: '', ownCard: '' };
const transactions: string[] = [];
const NOW = new Date();
const YESTERDAY = new Date(dayStart(dateKey(NOW)).getTime() - 12 * 3600_000); // noon-ish yesterday, Tashkent
const last4 = () => String(randomInt(1000, 9999));

/** A delivered order paid by card (on `cardId`) or by cash, with its commission accrued. */
async function delivered(restaurantId: string, opts: { cardId?: string; som: number; at: Date; cash?: boolean; status?: string }) {
  const tx = opts.cash ? null : await db.incomingTransaction.create({
    data: { sourceId: `po-${randomUUID()}`, source: 'test', cardLast4: '0000', amountTiyin: BigInt(opts.som) * 100n, occurredAt: new Date() },
  });
  if (tx) transactions.push(tx.id);
  const order = await db.order.create({ data: {
    restaurantId, customerId: ids.customer, addressText: 'x', totalSom: opts.som, createdViaBot: true, status: 'PAYMENT_CONFIRMED', paymentIsTest: false,
    payment: { create: {
      restaurantId, amountTiyin: BigInt(opts.som) * 100n, isTest: false,
      ...(opts.cash ? { method: 'CASH', status: 'CASH_ACCEPTED' } : { status: opts.status ?? 'CONFIRMED_MANUAL', cardId: opts.cardId, matchedTransactionId: tx!.id }),
    } },
  } });
  await db.$transaction(async t => {
    await t.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
    await t.order.update({ where: { id: order.id }, data: { status: 'COMPLETED' } });
    await t.orderEvent.create({ data: { orderId: order.id, actorTelegramId: 'test', actorType: 'SYSTEM', action: 'TEST_DELIVERY', fromStatus: 'PAYMENT_CONFIRMED', toStatus: 'COMPLETED', createdAt: opts.at } });
    const r = await accrueCommissionTx(t, order.id, { id: 'system', type: 'SYSTEM' });
    assert.equal(r.result, 'ACCRUED');
  });
  return order;
}

async function sentRefund(orderId: string, som: number, sentAt: Date) {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { payment: true } });
  return db.refundRequest.create({ data: {
    orderId, paymentId: order.payment!.id, kind: 'CUSTOMER_CANCEL', status: 'SENT', reasonCode: 'CHANGED_MIND', paidAmountTiyin: BigInt(som) * 100n, approvedAmountTiyin: BigInt(som) * 100n,
    orderStatusBefore: 'COMPLETED', paymentStatusAtRequest: 'CONFIRMED_MANUAL', requestedBy: 'test', requestedByType: 'CUSTOMER',
    sentBy: 'staff', sentAt, bankReference: 'TEST-REF-1234',
  } });
}

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  process.env.ADMIN_APP_ENABLED = 'true';
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = adminId;
  delete process.env.SUPPORT_ADMIN_2_TELEGRAM_ID;
  await db.adminSession.create({ data: { tokenHash: hashToken(token), telegramUserId: adminId, expiresAt: new Date(Date.now() + 3_600_000) } });
  ids.pool = (await db.restaurant.create({ data: { slug: `po-pool-${tag}`, name: `Pool ${tag}`, collectsToPlatform: true } })).id;
  ids.own = (await db.restaurant.create({ data: { slug: `po-own-${tag}`, name: `Own ${tag}` } })).id;
  ids.customer = (await db.customer.create({ data: { telegramUserId: String(randomInt(900000000001, 990000000000)) } })).id;
  ids.platformCard = (await db.card.create({ data: { restaurantId: null, last4: last4(), holderName: 'TEST' } })).id;
  ids.ownCard = (await db.card.create({ data: { restaurantId: ids.own, last4: last4(), holderName: 'TEST' } })).id;
});

after(async () => {
  const rids = [ids.pool, ids.own];
  const orders = (await db.order.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(o => o.id);
  await db.$transaction(async tx => { // the ledger is append-only; this switch exists for exactly this cleanup
    await tx.$executeRaw`SELECT set_config('ds.ledger_cleanup', 'on', true)`;
    await tx.commissionSettlementEntry.deleteMany({ where: { settlement: { restaurantId: { in: rids } } } });
    await tx.commissionSettlement.deleteMany({ where: { restaurantId: { in: rids } } });
    await tx.commissionEvent.deleteMany({ where: { entry: { restaurantId: { in: rids } } } });
    await tx.commissionEntry.deleteMany({ where: { restaurantId: { in: rids } } });
  });
  await db.payoutMark.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.refundRequest.deleteMany({ where: { orderId: { in: orders } } });
  await db.supportTicket.deleteMany({ where: { orderId: { in: orders } } });
  await db.payment.deleteMany({ where: { orderId: { in: orders } } });
  await db.incomingTransaction.deleteMany({ where: { id: { in: transactions } } });
  await db.order.deleteMany({ where: { id: { in: orders } } });
  await db.card.deleteMany({ where: { id: { in: [ids.platformCard, ids.ownCard] } } });
  await db.customer.deleteMany({ where: { id: ids.customer } });
  await db.restaurant.deleteMany({ where: { id: { in: rids } } });
  await db.adminSession.deleteMany({ where: { telegramUserId: adminId } });
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  await app.close();
  await db.$disconnect();
});

test('payout routes need an admin session and the switch; bad parameters are refused', async () => {
  for (const u of ['/payouts', `/payouts/${dateKey(NOW)}/x`]) {
    assert.equal((await api(u, {})).statusCode, 401, u);
    assert.equal((await api(u, { authorization: `Bearer ${'x'.repeat(43)}` })).statusCode, 401, u);
  }
  assert.equal((await api('/payouts?days=0')).statusCode, 400);
  assert.equal((await api('/payouts?days=99')).statusCode, 400);
  assert.equal((await api(`/payouts/2026-13-45/${ids.pool}`)).statusCode, 400);
  assert.equal((await api(`/payouts/2026-02-30/${ids.pool}`)).statusCode, 400);
  process.env.ADMIN_APP_ENABLED = 'false';
  try { assert.equal((await api('/payouts')).statusCode, 404); } finally { process.env.ADMIN_APP_ENABLED = 'true'; }
});

test('the report: delivered pool orders minus commission minus sent refunds, per Tashkent day; other money is not in it', async () => {
  const a = await delivered(ids.pool, { cardId: ids.platformCard, som: 40_000, at: NOW });
  const b = await delivered(ids.pool, { cardId: ids.platformCard, som: 30_000, at: NOW });
  await db.supportTicket.create({ data: { orderId: b.id, customerId: ids.customer, message: 'muammo' } });
  await delivered(ids.pool, { cardId: ids.platformCard, som: 20_000, at: YESTERDAY });
  // not pool money: the restaurant's own card, cash
  await delivered(ids.own, { cardId: ids.ownCard, som: 50_000, at: NOW });
  await delivered(ids.pool, { som: 60_000, at: NOW, cash: true });
  // paid and cooking, not delivered: shown as "in progress", not payable
  const cooking = await db.incomingTransaction.create({ data: { sourceId: `po-${randomUUID()}`, source: 'test', cardLast4: '0000', amountTiyin: 2_500_000n, occurredAt: new Date() } });
  transactions.push(cooking.id);
  await db.order.create({ data: {
    restaurantId: ids.pool, customerId: ids.customer, addressText: 'x', totalSom: 25_000, createdViaBot: true, status: 'PREPARING', paymentIsTest: false,
    payment: { create: { restaurantId: ids.pool, amountTiyin: 2_500_000n, status: 'CONFIRMED_MANUAL', isTest: false, cardId: ids.platformCard, matchedTransactionId: cooking.id } },
  } });
  // the restaurant refunded part of order A today; a refund of a cancelled order is not the restaurant's cost
  await sentRefund(a.id, 10_000, NOW);

  const report = (await api('/payouts?days=3')).json() as {
    days: Array<{ date: string; totalPayableSom: number; restaurants: Array<{ restaurantId: string; orders: number; collectedSom: number; commissionSom: number; refundsSom: number; payableSom: number; withOpenTicket: number }> }>;
    inProgress: Array<{ restaurantId: string; orders: number; amountSom: number }>;
  };
  assert.equal(report.days.length, 3);
  assert.equal(report.days[0]!.date, dateKey(NOW));
  const today = report.days[0]!.restaurants.find(r => r.restaurantId === ids.pool)!;
  assert.deepEqual({ ...today, restaurantId: undefined, name: undefined }, {
    restaurantId: undefined, name: undefined, orders: 2, collectedSom: 70_000, commissionSom: 10_000, refundsSom: 10_000, payableSom: 50_000, withOpenTicket: 1, paid: null,
  });
  assert.ok(!report.days[0]!.restaurants.some(r => r.restaurantId === ids.own), 'a restaurant that holds its own money is not in the payout');
  const yesterday = report.days[1]!.restaurants.find(r => r.restaurantId === ids.pool)!;
  assert.equal(yesterday.orders, 1);
  assert.equal(yesterday.payableSom, 15_000);
  assert.deepEqual(report.inProgress.find(p => p.restaurantId === ids.pool), { restaurantId: ids.pool, name: `Pool ${tag}`, orders: 1, amountSom: 25_000 });
  assert.ok(report.days[0]!.totalPayableSom >= 50_000);
});

test('detail lists the orders and refunds behind a restaurant day; an empty day is 404', async () => {
  const d = (await api(`/payouts/${dateKey(NOW)}/${ids.pool}`)).json() as { orders: Array<{ collectedSom: number; commissionSom: number; openTicket: boolean }>; refunds: Array<{ amountSom: number; status: string }> };
  assert.equal(d.orders.length, 2);
  assert.deepEqual(d.orders.map(o => o.collectedSom).sort(), [30_000, 40_000]);
  assert.ok(d.orders.every(o => o.commissionSom === 5_000));
  assert.equal(d.orders.filter(o => o.openTicket).length, 1);
  assert.deepEqual(d.refunds.map(r => [r.amountSom, r.status]), [[10_000, 'SENT']]);
  assert.equal((await api(`/payouts/${dateKey(NOW)}/${ids.own}`)).statusCode, 404);
  assert.equal((await api(`/payouts/2020-01-01/${ids.pool}`)).statusCode, 404);
});

test('the refund of a cancelled order is not the restaurant\'s cost and is not deducted from the payout', async () => {
  const cancelledTx = await db.incomingTransaction.create({ data: { sourceId: `po-${randomUUID()}`, source: 'test', cardLast4: '0000', amountTiyin: 1_500_000n, occurredAt: new Date() } });
  transactions.push(cancelledTx.id);
  const cancelled = await db.order.create({ data: {
    restaurantId: ids.pool, customerId: ids.customer, addressText: 'x', totalSom: 15_000, createdViaBot: true, status: 'CANCELLED', paymentIsTest: false,
    payment: { create: { restaurantId: ids.pool, amountTiyin: 1_500_000n, status: 'CONFIRMED_MANUAL', isTest: false, cardId: ids.platformCard, matchedTransactionId: cancelledTx.id } },
  } });
  await sentRefund(cancelled.id, 15_000, NOW);
  const today = ((await api('/payouts?days=1')).json() as { days: Array<{ restaurants: Array<{ restaurantId: string; refundsSom: number }> }> }).days[0]!.restaurants.find(r => r.restaurantId === ids.pool)!;
  assert.equal(today.refundsSom, 10_000, 'only the refund of the delivered order counts');
});

type Row = { restaurantId: string; payableSom: number; paid: { amountSom: number } | null };
const todayRow = async () => ((await api('/payouts?days=1')).json() as { days: Array<{ restaurants: Row[] }> }).days[0]!.restaurants.find(r => r.restaurantId === ids.pool)!;

test('"o\'tkazdim": the amount on the screen must still be the amount due; one live mark per restaurant and day, even from two phones', async () => {
  const day = dateKey(NOW);
  const url = `/payouts/${day}/${ids.pool}/paid`;
  assert.equal((await post(url, { expectedSom: 50_000 }, {})).statusCode, 401);
  assert.equal((await post(url, { expectedSom: 50_000, extra: 1 })).statusCode, 400, 'strict body');
  assert.equal((await post(url, { expectedSom: 0 })).statusCode, 400);
  assert.equal((await post(url, { expectedSom: 50_000, note: 'x'.repeat(301) })).statusCode, 400);

  // a stale screen (a refund or a late delivery moved the amount): nothing is written, the new amount is returned
  const stale = await post(url, { expectedSom: 45_000 });
  assert.equal(stale.statusCode, 409);
  assert.deepEqual(stale.json(), { error: 'CHANGED', amountSom: 50_000 });
  assert.equal(await db.payoutMark.count({ where: { restaurantId: ids.pool } }), 0);

  // two phones tap at once: exactly one mark
  const both = await Promise.all([post(url, { expectedSom: 50_000, note: 'Click orqali o\'tkazildi' }), post(url, { expectedSom: 50_000 })]);
  assert.deepEqual(both.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal(both.find(r => r.statusCode === 409)!.json().error, 'ALREADY_PAID');
  assert.equal(await db.payoutMark.count({ where: { restaurantId: ids.pool, day, revokedAt: null } }), 1);
  assert.equal((await todayRow()).paid?.amountSom, 50_000);
  assert.equal(((await api(`/payouts/${day}/${ids.pool}`)).json() as { paid: { amountSom: number } | null }).paid?.amountSom, 50_000);
  assert.equal(await db.adminAuditEvent.count({ where: { actorId: adminId, action: 'PAYOUT_MARKED', targetId: ids.pool } }), 1);
});

test('after the mark, a new refund moves the amount: the report shows both numbers so the difference is visible', async () => {
  const first = await db.order.findFirstOrThrow({ where: { restaurantId: ids.pool, status: 'COMPLETED', totalSom: 30_000 } });
  await sentRefund(first.id, 5_000, NOW);
  const row = await todayRow();
  assert.equal(row.payableSom, 45_000);
  assert.equal(row.paid?.amountSom, 50_000, 'the mark keeps what was actually transferred');
});

test('taking the mark back needs a written reason and keeps the row; then it can be marked again', async () => {
  const day = dateKey(NOW);
  const undo = `/payouts/${day}/${ids.pool}/unpaid`;
  assert.equal((await post(undo, { note: 'qisqa' })).statusCode, 400);
  assert.equal((await post(undo, {}, {})).statusCode, 401);
  assert.equal((await post(undo, { note: 'Adashib bosildi, hali o\'tkazmadim' })).statusCode, 200);
  assert.equal((await post(undo, { note: 'Yana bekor qilish urinishi' })).statusCode, 409, 'nothing left to undo');
  const rows = await db.payoutMark.findMany({ where: { restaurantId: ids.pool, day } });
  assert.equal(rows.length, 1);
  assert.ok(rows[0]!.revokedAt && rows[0]!.revokedBy === adminId && rows[0]!.revokeNote);
  assert.equal((await todayRow()).paid, null);
  assert.equal(await db.adminAuditEvent.count({ where: { actorId: adminId, action: 'PAYOUT_UNMARKED', targetId: ids.pool } }), 1);
  // the amount now due is 45 000 and can be marked again (a new row, the old one stays as history)
  assert.equal((await post(`/payouts/${day}/${ids.pool}/paid`, { expectedSom: 45_000 })).statusCode, 200);
  assert.equal(await db.payoutMark.count({ where: { restaurantId: ids.pool, day } }), 2);
});

test('marking refuses a day with nothing due, a future day and an unknown restaurant', async () => {
  const day = dateKey(NOW);
  assert.equal((await post(`/payouts/${day}/${ids.own}/paid`, { expectedSom: 5_000 })).statusCode, 404, 'own-card restaurant has no pool money');
  assert.equal((await post(`/payouts/${day}/nope-${tag}/paid`, { expectedSom: 5_000 })).statusCode, 404);
  const future = dateKey(new Date(Date.now() + 3 * 86_400_000));
  assert.equal((await post(`/payouts/${future}/${ids.pool}/paid`, { expectedSom: 1_000 })).statusCode, 400);
  assert.equal((await post(`/payouts/2026-13-45/${ids.pool}/paid`, { expectedSom: 1_000 })).statusCode, 400);
});

test('the weekly commission statement skips platform-collected orders, so nothing is billed twice; own-card and cash orders stay', async () => {
  const later = new Date(Date.now() + 10 * 86_400_000); // entries accrued "now" are in a closed week by then
  const pool = (await commissionStatements(later)).find(s => s.restaurantId === ids.pool);
  // the pool restaurant's only entries that remain are the CASH order (the restaurant holds that money itself)
  assert.deepEqual(pool?.due, { count: 1, amountSom: 5_000 });
  const own = (await commissionStatements(later)).find(s => s.restaurantId === ids.own);
  assert.deepEqual(own?.due, { count: 1, amountSom: 5_000 });
  // settling the pool restaurant covers exactly the cash entry, never the platform-collected ones
  const r = await settleRestaurant({ restaurantId: ids.pool, adminId, expectedCount: 1, expectedSom: 5_000, note: 'Naqd buyurtma komissiyasi bankda tekshirildi' }, later);
  assert.equal(r.result, 'SETTLED');
  assert.equal(await db.commissionEntry.count({ where: { restaurantId: ids.pool, settlement: null } }), 3, 'the three platform-collected entries stay unsettled (netted in the payout)');
});
