import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { attemptKey, setRestaurantPassword } from '../modules/restaurant-auth/service.js';
import { accrueCommissionTx } from '../modules/commission/ledger.js';
import { settleRestaurant } from '../modules/commission/settlement.js';
import { waiveCommission } from '../modules/commission/waiver.js';
import { dateKey, markPayoutPaid } from '../modules/admin-payouts/service.js';
import { financeLedger, financeOverview } from '../modules/restaurant-finance/overview.js';
import { MAX_FAILED, financeState, generatePin, issueFinancePin, lockFinance, requireFinanceUnlocked, unlockFinance } from '../modules/restaurant-finance/pin.js';

// Finance PIN + the simple money view (owner decision 2026-11-05). Needs a *_test database (the repo's DB guard). Orders are built directly.
delete process.env.COMMISSION_FLAT_SOM;
const db = new PrismaClient();
const app = buildApp(new PaymentEngineV3(db, defaultOptions, () => {}));
const tag = randomUUID().slice(0, 8);
const ADMIN = `9${randomInt(100_000_000, 999_999_999)}${randomInt(100, 999)}`;
const saved = { a1: process.env.SUPPORT_ADMIN_1_TELEGRAM_ID, a2: process.env.SUPPORT_ADMIN_2_TELEGRAM_ID };
const ids = { pool: '', own: '', other: '', customer: '', platformCard: '', ownCard: '' };
const transactions: string[] = [];
const ips: string[] = [];
const PW = `Finance-${randomUUID()}`;
const last4 = () => String(randomInt(1000, 9999));
const NEXT_WEEK = new Date(Date.now() + 10 * 86_400_000);

async function order(restaurantId: string, o: { cardId?: string; som: number; cash?: boolean; test?: boolean; status?: string }) {
  const tx = o.cash ? null : await db.incomingTransaction.create({ data: { sourceId: `fo-${randomUUID()}`, source: 'test', cardLast4: '0000', amountTiyin: BigInt(o.som) * 100n, occurredAt: new Date() } });
  if (tx) transactions.push(tx.id);
  const created = await db.order.create({ data: {
    restaurantId, customerId: ids.customer, addressText: 'x', totalSom: o.som, createdViaBot: true, status: 'PAYMENT_CONFIRMED', paymentIsTest: !!o.test,
    payment: { create: { restaurantId, amountTiyin: BigInt(o.som) * 100n, isTest: !!o.test, ...(o.cash ? { method: 'CASH', status: 'CASH_ACCEPTED' } : { status: 'CONFIRMED_MANUAL', cardId: o.cardId, matchedTransactionId: tx!.id }) } },
  } });
  await db.$transaction(async t => {
    await t.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${created.id} FOR UPDATE`;
    await t.order.update({ where: { id: created.id }, data: { status: 'COMPLETED' } });
    await t.orderEvent.create({ data: { orderId: created.id, actorTelegramId: 'test', actorType: 'SYSTEM', action: 'TEST_DELIVERY', fromStatus: 'PAYMENT_CONFIRMED', toStatus: 'COMPLETED' } });
    await accrueCommissionTx(t, created.id, { id: 'system', type: 'SYSTEM' }); // a test order is not eligible: that is part of what is checked
  });
  return db.order.findUniqueOrThrow({ where: { id: created.id }, select: { id: true, code: true } });
}

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = ADMIN;
  delete process.env.SUPPORT_ADMIN_2_TELEGRAM_ID;
  ids.pool = (await db.restaurant.create({ data: { slug: `fp-pool-${tag}`, name: `FP Pool ${tag}`, collectsToPlatform: true } })).id;
  ids.own = (await db.restaurant.create({ data: { slug: `fp-own-${tag}`, name: `FP Own ${tag}` } })).id;
  ids.other = (await db.restaurant.create({ data: { slug: `fp-other-${tag}`, name: `FP Other ${tag}` } })).id;
  ids.customer = (await db.customer.create({ data: { telegramUserId: String(randomInt(900000000001, 990000000000)) } })).id;
  ids.platformCard = (await db.card.create({ data: { restaurantId: null, last4: last4(), holderName: 'TEST' } })).id;
  ids.ownCard = (await db.card.create({ data: { restaurantId: ids.own, last4: last4(), holderName: 'TEST' } })).id;
  await setRestaurantPassword({ slug: `fp-pool-${tag}`, password: PW });
});

after(async () => {
  const rids = [ids.pool, ids.own, ids.other];
  const orders = (await db.order.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(o => o.id);
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('ds.ledger_cleanup', 'on', true)`;
    await tx.commissionWaiver.deleteMany({ where: { restaurantId: { in: rids } } });
    await tx.commissionSettlementEntry.deleteMany({ where: { settlement: { restaurantId: { in: rids } } } });
    await tx.commissionSettlement.deleteMany({ where: { restaurantId: { in: rids } } });
    await tx.commissionEvent.deleteMany({ where: { entry: { restaurantId: { in: rids } } } });
    await tx.commissionEntry.deleteMany({ where: { restaurantId: { in: rids } } });
  });
  await db.restaurantLoginAttempt.deleteMany({ where: { keyHash: { in: [attemptKey('slug', `fp-pool-${tag}`), ...ips.map(ip => attemptKey('ip', ip))] } } });
  await db.payoutMark.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.payment.deleteMany({ where: { orderId: { in: orders } } });
  await db.incomingTransaction.deleteMany({ where: { id: { in: transactions } } });
  await db.order.deleteMany({ where: { id: { in: orders } } });
  await db.card.deleteMany({ where: { id: { in: [ids.platformCard, ids.ownCard] } } });
  await db.customer.deleteMany({ where: { id: ids.customer } });
  await db.restaurant.deleteMany({ where: { id: { in: rids } } }); // sessions, credentials and PINs cascade
  for (const [k, v] of [['SUPPORT_ADMIN_1_TELEGRAM_ID', saved.a1], ['SUPPORT_ADMIN_2_TELEGRAM_ID', saved.a2]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await app.close();
  await db.$disconnect();
});

const session = async () => (await db.restaurantSession.create({ data: { tokenHash: randomUUID() + randomUUID(), restaurantId: ids.pool, passwordVersion: 1, expiresAt: new Date(Date.now() + 3_600_000) } })).id;

test('generated codes are 4 digits and never trivial', () => {
  for (let i = 0; i < 2000; i++) {
    const pin = generatePin();
    assert.match(pin, /^\d{4}$/);
    assert.ok(!/^(\d)\1{3}$/.test(pin), pin);
    assert.ok(!['0123', '1234', '2345', '3456', '4567', '5678', '6789', '3210', '4321', '5432', '6543', '7654', '8765', '9876'].includes(pin), pin);
  }
});

test('only a support administrator issues a code; it is stored hashed; re-issuing replaces it and closes open unlocks', async () => {
  await assert.rejects(issueFinancePin({ adminId: '1', restaurantId: ids.pool }), /ADMIN_RUXSAT_YOQ/);
  assert.deepEqual(await issueFinancePin({ adminId: ADMIN, restaurantId: 'nope' }), { result: 'NOT_FOUND' });
  const first = await issueFinancePin({ adminId: ADMIN, restaurantId: ids.pool });
  assert.equal(first.result, 'ISSUED');
  const pin1 = (first as { pin: string }).pin;
  const row = await db.restaurantFinancePin.findUniqueOrThrow({ where: { restaurantId: ids.pool } });
  assert.ok(!row.pinHash.includes(pin1) && row.pinHash.startsWith('$argon2'), 'only a hash is stored');

  const sid = await session();
  assert.equal((await unlockFinance({ sessionId: sid, restaurantId: ids.pool, pin: pin1 })).result, 'UNLOCKED');
  assert.equal((await financeState(sid, ids.pool)).unlocked, true);
  const second = await issueFinancePin({ adminId: ADMIN, restaurantId: ids.pool });
  const pin2 = (second as { pin: string }).pin;
  assert.equal((await financeState(sid, ids.pool)).unlocked, false, 're-issuing locks every open screen');
  if (pin2 !== pin1) assert.equal((await unlockFinance({ sessionId: sid, restaurantId: ids.pool, pin: pin1 })).result, 'WRONG', 'the old code is dead');
  assert.equal((await unlockFinance({ sessionId: sid, restaurantId: ids.pool, pin: pin2 })).result, 'UNLOCKED');
});

test('wrong codes are counted; five in a row lock the code, even for the right one; parallel guesses cannot skip the limit', async () => {
  const { pin } = await issueFinancePin({ adminId: ADMIN, restaurantId: ids.pool }) as { pin: string };
  const wrong = pin === '7391' ? '7392' : '7391';
  const sid = await session();
  assert.deepEqual(await unlockFinance({ sessionId: sid, restaurantId: ids.pool, pin: wrong }), { result: 'WRONG', attemptsLeft: MAX_FAILED - 1 });
  assert.equal((await unlockFinance({ sessionId: sid, restaurantId: ids.pool, pin })).result, 'UNLOCKED', 'a right code resets the counter');
  await lockFinance(sid, ids.pool);
  const results = await Promise.all(Array.from({ length: 12 }, () => unlockFinance({ sessionId: sid, restaurantId: ids.pool, pin: wrong })));
  assert.equal(results.filter(r => r.result === 'WRONG').length, MAX_FAILED - 1, 'exactly four wrong answers, then the lock');
  assert.equal(results.filter(r => r.result === 'LOCKED').length, 12 - (MAX_FAILED - 1));
  const locked = await unlockFinance({ sessionId: sid, restaurantId: ids.pool, pin });
  assert.equal(locked.result, 'LOCKED', 'the right code does not help while locked');
  await db.restaurantFinancePin.update({ where: { restaurantId: ids.pool }, data: { lockedUntil: new Date(Date.now() - 1000) } });
  assert.equal((await unlockFinance({ sessionId: sid, restaurantId: ids.pool, pin })).result, 'UNLOCKED', 'after the lock ran out');
});

test('the guard: no code = strict endpoints refuse and old ones stay open; with a code both need the unlock; locking closes it', async () => {
  await assert.rejects(requireFinanceUnlocked(await session(), ids.other, { strict: true }), /FINANCE_NO_PIN/);
  await requireFinanceUnlocked(await session(), ids.other, { strict: false });
  const { pin } = await issueFinancePin({ adminId: ADMIN, restaurantId: ids.pool }) as { pin: string };
  const sid = await session();
  await assert.rejects(requireFinanceUnlocked(sid, ids.pool, { strict: true }), /FINANCE_LOCKED/);
  await assert.rejects(requireFinanceUnlocked(sid, ids.pool, { strict: false }), /FINANCE_LOCKED/);
  await unlockFinance({ sessionId: sid, restaurantId: ids.pool, pin });
  await requireFinanceUnlocked(sid, ids.pool, { strict: true });
  await lockFinance(sid, ids.pool);
  await assert.rejects(requireFinanceUnlocked(sid, ids.pool, { strict: true }), /FINANCE_LOCKED/);
  // an expired window is closed too
  await unlockFinance({ sessionId: sid, restaurantId: ids.pool, pin });
  await db.restaurantSession.update({ where: { id: sid }, data: { financeUnlockedUntil: new Date(Date.now() - 1000) } });
  await assert.rejects(requireFinanceUnlocked(sid, ids.pool, { strict: true }), /FINANCE_LOCKED/);
});

test('over HTTP: 401 without a session, 423 while locked, the numbers after the unlock, 204 on lock', async () => {
  const { pin } = await issueFinancePin({ adminId: ADMIN, restaurantId: ids.pool }) as { pin: string };
  const ip = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`; ips.push(ip);
  const login = await app.inject({ method: 'POST', url: '/api/v1/restaurant/auth/login', payload: { slug: `fp-pool-${tag}`, password: PW }, remoteAddress: ip });
  assert.equal(login.statusCode, 200);
  const auth = { authorization: `Bearer ${login.json().accessToken}` };
  const call = (method: 'GET' | 'POST', url: string, payload?: object) => app.inject({ method, url: `/api/v1/restaurant/finance${url}`, headers: auth, ...(payload ? { payload } : {}) });
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/restaurant/finance/overview' })).statusCode, 401);
  for (const u of ['/overview', '/ledger', '/summary', '/orders', '/commissions', '/refunds']) assert.equal((await call('GET', u)).statusCode, 423, u);
  assert.equal((await call('GET', '/state')).json().unlocked, false);
  assert.equal((await call('POST', '/unlock', { pin: 'abcd' })).statusCode, 400);
  const wrong = pin === '7391' ? '7392' : '7391';
  const bad = await call('POST', '/unlock', { pin: wrong });
  assert.equal(bad.statusCode, 403);
  assert.equal(bad.json().attemptsLeft, MAX_FAILED - 1);
  assert.equal((await call('POST', '/unlock', { pin })).statusCode, 200);
  assert.equal((await call('GET', '/overview')).statusCode, 200);
  assert.equal((await call('GET', '/ledger?limit=5')).statusCode, 200);
  assert.equal((await call('GET', '/ledger?filter=bogus')).statusCode, 400);
  assert.equal((await call('GET', '/ledger?from=2026-13-45')).statusCode, 400);
  assert.equal((await call('POST', '/lock')).statusCode, 204);
  assert.equal((await call('GET', '/overview')).statusCode, 423);
});

test('the main numbers: platform card (earned, paid out, remaining), own card (fee owed, settled), cash apart, tests never count', async () => {
  // platform-card restaurant: 54 000 with its 5 000 fee waived, 20 000 with the fee, a cash order and a test order
  const mine = await order(ids.pool, { cardId: ids.platformCard, som: 54_000 });
  await order(ids.pool, { cardId: ids.platformCard, som: 20_000 });
  await order(ids.pool, { som: 30_000, cash: true });
  await order(ids.pool, { cardId: ids.platformCard, som: 99_000, test: true });
  let o = await financeOverview(ids.pool);
  assert.equal(o.platformCard.orders, 2);
  assert.equal(o.platformCard.collectedSom, 74_000);
  assert.equal(o.platformCard.platformFeeSom, 10_000);
  assert.equal(o.platformCard.restaurantEarnedSom, 64_000);
  assert.equal(o.platformCard.remainingSom, 64_000);
  assert.equal(o.cash.orders, 1);
  assert.equal(o.cash.collectedSom, 30_000);

  assert.equal((await waiveCommission({ adminId: ADMIN, orderCode: mine.code, reason: 'Egasining o‘z buyurtmasi, komissiya olinmaydi' })).result, 'WAIVED');
  o = await financeOverview(ids.pool);
  assert.equal(o.platformCard.platformFeeSom, 5_000, 'the waived fee is not the platform\'s earning');
  assert.equal(o.platformCard.restaurantEarnedSom, 69_000);

  // the owner transferred all of it by hand
  const detail = await markPayoutPaid({ adminId: ADMIN, date: dateKey(new Date()), restaurantId: ids.pool, expectedSom: 69_000 });
  assert.deepEqual(detail, { result: 'MARKED', amountSom: 69_000 });
  o = await financeOverview(ids.pool);
  assert.equal(o.platformCard.paidOutSom, 69_000);
  assert.equal(o.platformCard.remainingSom, 0);

  // own-card restaurant: the fee is owed to the platform until an administrator records the settlement
  await order(ids.own, { cardId: ids.ownCard, som: 40_000 });
  await order(ids.own, { cardId: ids.ownCard, som: 25_000 });
  o = await financeOverview(ids.own);
  assert.equal(o.ownCard.orders, 2);
  assert.equal(o.ownCard.restaurantEarnedSom, 55_000);
  assert.equal(o.ownCard.platformFeeSom, 10_000);
  assert.equal(o.ownCard.feeRemainingSom, 10_000);
  assert.equal((await settleRestaurant({ restaurantId: ids.own, adminId: ADMIN, expectedCount: 2, expectedSom: 10_000, note: 'bankda ko‘rildi, test yozuvi' }, NEXT_WEEK)).result, 'SETTLED');
  o = await financeOverview(ids.own);
  assert.equal(o.ownCard.feeSettledSom, 10_000);
  assert.equal(o.ownCard.feeRemainingSom, 0);
  assert.equal(o.platformCard.orders, 0, 'a restaurant never sees another one\'s money');
});

test('the history: delivered orders and recorded payouts, newest first, filtered, paged, with totals for the whole range', async () => {
  const all = await financeLedger(ids.pool, { filter: 'all', limit: 50 });
  const income = all.items.filter(i => i.kind === 'INCOME');
  assert.equal(income.length, 3, 'two card orders and one cash order; the test order is not there');
  assert.equal(all.items.filter(i => i.kind === 'PAYOUT').length, 1);
  assert.equal(all.totals.orders, 3);
  assert.equal(all.totals.collectedSom, 104_000);
  assert.equal(all.totals.paidOutSom, 69_000);
  const times = all.items.map(i => i.at);
  assert.deepEqual([...times].sort().reverse(), times, 'newest first');

  const cash = await financeLedger(ids.pool, { filter: 'cash', limit: 50 });
  assert.deepEqual(cash.items.map(i => (i.kind === 'INCOME' ? i.source : 'x')), ['cash']);
  assert.equal(cash.totals.collectedSom, 30_000);
  const card = await financeLedger(ids.pool, { filter: 'card', limit: 50 });
  assert.equal(card.totals.orders, 2);
  assert.ok(card.items.some(i => i.kind === 'PAYOUT'), 'payouts belong to the card view');

  const p1 = await financeLedger(ids.pool, { filter: 'all', limit: 2 });
  assert.equal(p1.items.length, 2);
  assert.ok(p1.nextCursor);
  assert.equal(p1.totals.orders, 3, 'totals are for the range, not the page');
  const p2 = await financeLedger(ids.pool, { filter: 'all', limit: 2, cursor: p1.nextCursor! });
  assert.equal(p2.items.length, 2);
  assert.equal(p2.nextCursor, null);
  assert.deepEqual(new Set([...p1.items, ...p2.items].map(i => i.id)).size, 4, 'no line twice, none missing');

  const today = dateKey(new Date());
  assert.equal((await financeLedger(ids.pool, { filter: 'all', limit: 50, from: today, to: today })).totals.orders, 3);
  assert.equal((await financeLedger(ids.pool, { filter: 'all', limit: 50, to: '2020-01-01' })).totals.orders, 0);
  assert.equal((await financeLedger(ids.own, { filter: 'all', limit: 50 })).items.every(i => i.kind === 'INCOME' && i.source === 'own'), true);
});
