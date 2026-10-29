import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { hashToken } from '../modules/admin-auth/service.js';
import { setAdminMessenger } from '../modules/admin-auth/messenger.js';
import { accrueCommissionTx } from '../modules/commission/ledger.js';

// DS Admin A3a (platform settings, restaurant on/off, commission). Needs a *_test database (the repo's DB guard). The platform settings it flips are
// saved first and put back afterwards; AdminAuditEvent is append-only, so its rows stay under a unique actor id.
const db = new PrismaClient();
const app = buildApp(new PaymentEngineV3(db, defaultOptions, () => {}));
const tag = randomUUID().slice(0, 8);
const adminId = `9${randomInt(100_000_000, 999_999_999)}${randomInt(100, 999)}`;
const token = randomBytes(32).toString('base64url');
const auth = { authorization: `Bearer ${token}` };
const api = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object, headers: Record<string, string> = auth) =>
  app.inject({ method, url: `/api/v1/admin${url}`, headers, ...(payload ? { payload } : {}) });

const KEYS = ['real_payments_open', 'cash_orders_enabled', 'service_fee_mode', 'service_fee_percent_bp', 'taxi_dispatch_mode', 'rating_ranking_enabled'];
const saved = { ...process.env };
let savedSettings: Array<{ key: string; value: string }> = [];
const sent: Array<{ to: string; text: string }> = [];
const ids = { restaurant: '', customer: '', order: '' };

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  process.env.ADMIN_APP_ENABLED = 'true';
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = adminId;
  delete process.env.SUPPORT_ADMIN_2_TELEGRAM_ID;
  delete process.env.COMMISSION_FLAT_SOM;
  setAdminMessenger(async (to, text) => { sent.push({ to, text }); });
  await db.adminSession.create({ data: { tokenHash: hashToken(token), telegramUserId: adminId, expiresAt: new Date(Date.now() + 3_600_000) } });
  savedSettings = await db.platformSetting.findMany({ where: { key: { in: KEYS } }, select: { key: true, value: true } });
  await db.platformSetting.deleteMany({ where: { key: { in: KEYS } } }); // start from the defaults
  ids.restaurant = (await db.restaurant.create({ data: { slug: `plat-${tag}`, name: `Platforma ${tag}` } })).id;
  ids.customer = (await db.customer.create({ data: { telegramUserId: String(randomInt(900000000001, 990000000000)) } })).id;
});

after(async () => {
  setAdminMessenger(null);
  await db.platformSetting.deleteMany({ where: { key: { in: KEYS } } });
  for (const s of savedSettings) await db.platformSetting.create({ data: { key: s.key, value: s.value } });
  await db.$transaction(async tx => { // the ledger is append-only; this switch exists for exactly this cleanup
    await tx.$executeRaw`SELECT set_config('ds.ledger_cleanup', 'on', true)`;
    await tx.commissionEvent.deleteMany({ where: { entry: { restaurantId: ids.restaurant } } });
    await tx.commissionEntry.deleteMany({ where: { restaurantId: ids.restaurant } });
  });
  const pays = await db.payment.findMany({ where: { restaurantId: ids.restaurant }, select: { id: true, matchedTransactionId: true } });
  await db.payment.deleteMany({ where: { id: { in: pays.map(p => p.id) } } });
  await db.incomingTransaction.deleteMany({ where: { id: { in: pays.map(p => p.matchedTransactionId).filter((x): x is string => !!x) } } });
  await db.order.deleteMany({ where: { restaurantId: ids.restaurant } });
  await db.restaurantSession.deleteMany({ where: { restaurantId: ids.restaurant } });
  await db.customer.deleteMany({ where: { id: ids.customer } });
  await db.restaurant.deleteMany({ where: { id: ids.restaurant } });
  await db.adminSession.deleteMany({ where: { telegramUserId: adminId } });
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  await app.close();
  await db.$disconnect();
});

const audits = (action: string) => db.adminAuditEvent.count({ where: { actorId: adminId, action } });
const settings = async () => (await api('GET', '/settings')).json();

test('every platform route needs an admin session and the switch', async () => {
  for (const [m, u] of [['GET', '/settings'], ['GET', '/ratings'], ['GET', '/restaurants'], ['GET', '/commission']] as const) {
    assert.equal((await api(m, u, undefined, {})).statusCode, 401, u);
    assert.equal((await api(m, u, undefined, { authorization: `Bearer ${'x'.repeat(43)}` })).statusCode, 401, u);
  }
  for (const [u, body] of [['/settings/payments', { open: true }], ['/settings/cash', { enabled: false }], ['/settings/fee', { mode: 'FLAT' }],
    ['/settings/taxi-mode', { mode: 'READY' }], ['/settings/ranking', { enabled: true }], ['/restaurants/x/active', { active: false }]] as const) {
    assert.equal((await api('PUT', u, body, {})).statusCode, 401, u);
  }
  assert.equal((await api('POST', '/commission/x/settle', { expectedCount: 1, expectedSom: 1, note: 'x'.repeat(12) }, {})).statusCode, 401);
  process.env.ADMIN_APP_ENABLED = 'false';
  try { assert.equal((await api('GET', '/settings')).statusCode, 404); } finally { process.env.ADMIN_APP_ENABLED = 'true'; }
});

test('defaults: real payments closed, cash on, flat fee, taxi at "Tayyor", ranking off', async () => {
  const s = await settings();
  assert.equal(s.payments.open, false);
  assert.equal(s.cash.enabled, true);
  assert.ok(s.cash.maxOrderSom >= 10_000);
  assert.equal(s.fee.mode, 'FLAT');
  assert.equal(s.taxiMode, 'READY');
  assert.equal(s.ranking.enabled, false);
});

test('real payments: refused while a blocker exists (same rules as /payments), never opened by this test, closing is audited and announced', async () => {
  const before = await settings();
  if (before.payments.blockers.length) {
    const r = await api('PUT', '/settings/payments', { open: true });
    assert.equal(r.statusCode, 409);
    assert.equal(r.json().error, 'BLOCKED');
    assert.deepEqual(r.json().blockers, before.payments.blockers);
    assert.equal((await settings()).payments.open, false, 'refused: still closed');
  }
  assert.equal((await api('PUT', '/settings/payments', { open: 'yes' })).statusCode, 400);
  const closed = await api('PUT', '/settings/payments', { open: false });
  assert.equal(closed.statusCode, 200);
  assert.equal(closed.json().result, 'CHANGED', 'a missing row becomes an explicit, audited "closed"');
  assert.equal((await api('PUT', '/settings/payments', { open: false })).json().result, 'UNCHANGED');
  assert.equal(await audits('REAL_PAYMENTS_CLOSED'), 1);
  assert.ok(sent.some(m => m.to === adminId && /Real to‘lov yopildi/.test(m.text)), 'the administrator is told on Telegram');
});

test('cash: switch off and on, a second tap changes nothing, each change is audited and announced', async () => {
  const off = await api('PUT', '/settings/cash', { enabled: false });
  assert.equal(off.json().result, 'CHANGED');
  assert.equal(off.json().settings.cash.enabled, false);
  assert.equal((await api('PUT', '/settings/cash', { enabled: false })).json().result, 'UNCHANGED');
  assert.equal((await api('PUT', '/settings/cash', { enabled: true })).json().result, 'CHANGED');
  assert.equal(await audits('CASH_ORDERS_DISABLED'), 1);
  assert.equal(await audits('CASH_ORDERS_ENABLED'), 1);
  assert.ok(sent.some(m => /Naqd to‘lov o‘chirildi/.test(m.text)));
  assert.equal((await api('PUT', '/settings/cash', { enabled: 'no' })).statusCode, 400);
  assert.equal((await api('PUT', '/settings/cash', { enabled: true, extra: 1 })).statusCode, 400, 'unknown fields are refused');
});

test('fee: modes, percent range and precision, unchanged is a no-op', async () => {
  const pct = await api('PUT', '/settings/fee', { mode: 'PERCENT', percent: 8 });
  assert.equal(pct.json().result, 'CHANGED');
  assert.deepEqual(pct.json().settings.fee, { mode: 'PERCENT', percentBp: 800 });
  assert.equal((await api('PUT', '/settings/fee', { mode: 'PERCENT', percent: 8 })).json().result, 'UNCHANGED');
  assert.equal((await api('PUT', '/settings/fee', { mode: 'PERCENT', percent: 7.25 })).json().settings.fee.percentBp, 725);
  for (const bad of [{ mode: 'PERCENT', percent: 0.5 }, { mode: 'PERCENT', percent: 26 }, { mode: 'PERCENT', percent: 8.123 }, { mode: 'BOGUS' }, { mode: 'PERCENT', percent: '8' }]) {
    assert.equal((await api('PUT', '/settings/fee', bad)).statusCode, 400, JSON.stringify(bad));
  }
  assert.equal((await settings()).fee.percentBp, 725, 'refused calls change nothing');
  const tiered = await api('PUT', '/settings/fee', { mode: 'TIERED' });
  assert.equal(tiered.json().settings.fee.mode, 'TIERED');
  assert.equal(tiered.json().settings.fee.percentBp, 725, 'the stored percent survives a mode change');
  assert.equal((await api('PUT', '/settings/fee', { mode: 'FLAT' })).json().settings.fee.mode, 'FLAT');
  assert.ok((await audits('SERVICE_FEE_MODE_CHANGED')) >= 4);
});

test('taxi mode and ranking switches', async () => {
  assert.equal((await api('PUT', '/settings/taxi-mode', { mode: 'LEAD' })).json().settings.taxiMode, 'LEAD');
  assert.equal((await api('PUT', '/settings/taxi-mode', { mode: 'LEAD' })).json().result, 'UNCHANGED');
  assert.equal((await api('PUT', '/settings/taxi-mode', { mode: 'READY' })).json().settings.taxiMode, 'READY');
  assert.equal((await api('PUT', '/settings/taxi-mode', { mode: 'SOON' })).statusCode, 400);
  assert.equal((await api('PUT', '/settings/ranking', { enabled: true })).json().settings.ranking.enabled, true);
  assert.equal((await api('PUT', '/settings/ranking', { enabled: false })).json().settings.ranking.enabled, false);
  const r = (await api('GET', '/ratings')).json();
  assert.equal(r.rankingOn, false);
  assert.ok(Array.isArray(r.restaurants) && Array.isArray(r.lowRecent));
  assert.ok(r.reasonLabels.COLD, 'reason tags come with their Uzbek labels');
});

test('restaurants: listed, suspended (sessions revoked, audited, announced), resumed, two taps give one change, unknown is not found', async () => {
  const listed = (await api('GET', '/restaurants')).json().restaurants as Array<{ id: string; isActive: boolean }>;
  // The list is the first 50 by name; a crowded test database may push this one out, so only check the shape and then act by id.
  assert.ok(Array.isArray(listed));
  await db.restaurantSession.create({ data: { restaurantId: ids.restaurant, tokenHash: `t-${tag}`, passwordVersion: 1, expiresAt: new Date(Date.now() + 3_600_000) } });
  const taps = await Promise.all([1, 2].map(() => api('PUT', `/restaurants/${ids.restaurant}/active`, { active: false })));
  assert.deepEqual(taps.map(t => t.json().result).sort(), ['CHANGED', 'UNCHANGED']);
  const changed = taps.find(t => t.json().result === 'CHANGED')!.json();
  assert.equal(changed.signedOut, 1);
  assert.equal((await db.restaurant.findUniqueOrThrow({ where: { id: ids.restaurant } })).isActive, false);
  assert.equal((await db.restaurantSession.count({ where: { restaurantId: ids.restaurant, revokedAt: null } })), 0);
  assert.equal(await audits('RESTAURANT_SUSPENDED'), 1);
  assert.ok(sent.some(m => /to‘xtatildi \(DS Admin ilovasi\)/.test(m.text)));
  assert.equal((await api('PUT', `/restaurants/${ids.restaurant}/active`, { active: true })).json().result, 'CHANGED');
  assert.equal(await audits('RESTAURANT_RESUMED'), 1);
  assert.equal((await api('PUT', '/restaurants/does-not-exist/active', { active: true })).statusCode, 404);
  assert.equal((await api('PUT', `/restaurants/${ids.restaurant}/active`, { active: 'maybe' })).statusCode, 400);
});

test('commission: statement lists the running week, settling needs a real note and something due, and never records on a mismatch', async () => {
  const som = 21_000;
  const matched = await db.incomingTransaction.create({ data: { sourceId: `pl-${randomUUID()}`, source: 'test', cardLast4: '0000', amountTiyin: BigInt(som) * 100n, occurredAt: new Date() } });
  const order = await db.order.create({ data: {
    restaurantId: ids.restaurant, customerId: ids.customer, addressText: 'x', totalSom: som, createdViaBot: true, status: 'PAYMENT_CONFIRMED', paymentIsTest: false,
    payment: { create: { restaurantId: ids.restaurant, amountTiyin: BigInt(som) * 100n, status: 'CONFIRMED_MANUAL', isTest: false, matchedTransactionId: matched.id } },
  } });
  ids.order = order.id;
  const accrued = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
    await tx.order.update({ where: { id: order.id }, data: { status: 'COMPLETED' } });
    await tx.orderEvent.create({ data: { orderId: order.id, actorTelegramId: 'test', actorType: 'SYSTEM', action: 'TEST_DELIVERY', fromStatus: 'PAYMENT_CONFIRMED', toStatus: 'COMPLETED' } });
    return accrueCommissionTx(tx, order.id, { id: 'system', type: 'SYSTEM' });
  });
  assert.equal(accrued.result, 'ACCRUED');

  const st = (await api('GET', '/commission')).json().statements.find((x: { restaurantId: string }) => x.restaurantId === ids.restaurant);
  assert.ok(st, 'a restaurant with an unsettled entry is listed');
  assert.equal(st.current.count, 1, 'the running week is not collectable yet');
  assert.equal(st.due.count, 0);

  const short = await api('POST', `/commission/${ids.restaurant}/settle`, { expectedCount: 1, expectedSom: 5000, note: 'qisqa' });
  assert.equal(short.statusCode, 400);
  assert.equal(short.json().error, 'NOTE_INVALID');
  const none = await api('POST', `/commission/${ids.restaurant}/settle`, { expectedCount: 1, expectedSom: 5000, note: 'Bank hisobida ko‘rildi, 30.10 kuni' });
  assert.equal(none.statusCode, 409);
  assert.equal(none.json().error, 'NOTHING_DUE', 'only closed weeks are due');
  assert.equal(await db.commissionSettlement.count({ where: { restaurantId: ids.restaurant } }), 0, 'nothing was recorded');
  assert.equal((await api('POST', `/commission/${ids.restaurant}/settle`, { expectedCount: 0, expectedSom: 1, note: 'x'.repeat(20) })).statusCode, 400);
  assert.equal((await api('POST', `/commission/${ids.restaurant}/settle`, { expectedCount: 1, expectedSom: 1, note: 'x'.repeat(20), extra: 1 })).statusCode, 400);
});
