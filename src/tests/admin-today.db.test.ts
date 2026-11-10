import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { hashToken } from '../modules/admin-auth/service.js';
import { tashkentDayStart, todaySummary } from '../modules/admin-today/service.js';

// DS Admin home screen numbers. Needs a *_test database (the repo's DB guard). The database may hold other rows, so every check compares the
// numbers BEFORE and AFTER this file's own rows. It deletes only what it created.
const db = new PrismaClient();
const app = buildApp(new PaymentEngineV3(db, defaultOptions, () => {}));
const tag = randomUUID().slice(0, 8);
const adminId = `9${randomInt(100_000_000, 999_999_999)}${randomInt(100, 999)}`;
const token = randomBytes(32).toString('base64url');
const auth = { authorization: `Bearer ${token}` };
const saved = { ...process.env };
const ids = { restaurant: '', customer: '', orders: [] as string[], ticket: '', incoming: '' };

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  process.env.ADMIN_APP_ENABLED = 'true';
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = adminId;
  delete process.env.SUPPORT_ADMIN_2_TELEGRAM_ID;
  await db.adminSession.create({ data: { tokenHash: hashToken(token), telegramUserId: adminId, expiresAt: new Date(Date.now() + 3_600_000) } });
  ids.restaurant = (await db.restaurant.create({ data: { slug: `today-${tag}`, name: `Today ${tag}` } })).id;
  ids.customer = (await db.customer.create({ data: { displayName: `today-${tag}` } })).id;
});

after(async () => {
  await db.supportTicket.deleteMany({ where: { id: ids.ticket } });
  await db.incomingTransaction.deleteMany({ where: { id: ids.incoming } });
  await db.payment.deleteMany({ where: { orderId: { in: ids.orders } } });
  await db.order.deleteMany({ where: { id: { in: ids.orders } } });
  await db.restaurant.deleteMany({ where: { id: ids.restaurant } });
  await db.customer.deleteMany({ where: { id: ids.customer } });
  await db.adminSession.deleteMany({ where: { telegramUserId: adminId } });
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  await app.close();
  await db.$disconnect();
});

const mk = async (status: string, totalSom: number, method: 'CARD' | 'CASH', extra: Record<string, unknown> = {}) => {
  const o = await db.order.create({ data: { restaurantId: ids.restaurant, customerId: ids.customer, addressText: 'today test', totalSom, status, createdViaBot: true, ...extra } as never });
  ids.orders.push(o.id);
  // Payment.isTest: a real card payment must be matched to a bank transaction (DB constraint); the order itself stays a real one (paymentIsTest false).
  await db.payment.create({ data: { orderId: o.id, restaurantId: ids.restaurant, amountTiyin: BigInt(totalSom) * 100n, method, status: method === 'CASH' ? 'CASH_ACCEPTED' : 'CONFIRMED_MANUAL', isTest: true } });
  return o.id;
};

test('the route needs an admin session and the switch', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/today' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/today', headers: { authorization: `Bearer ${'x'.repeat(43)}` } })).statusCode, 401);
  process.env.ADMIN_APP_ENABLED = 'false';
  try { assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/today', headers: auth })).statusCode, 404); } finally { process.env.ADMIN_APP_ENABLED = 'true'; }
  const ok = await app.inject({ method: 'GET', url: '/api/v1/admin/today', headers: auth });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers['cache-control'], 'no-store');
  const body = ok.json();
  assert.match(body.day, /^\d{4}-\d\d-\d\d$/);
  for (const k of ['orders', 'revenueSom', 'cashSom', 'commissionDue', 'openTickets', 'moneyReviews', 'generatedAt']) assert.ok(k in body, k);
});

test('counts only today\'s real orders: delivered, cancelled, in progress, revenue (paid and not cancelled) and its cash part', async () => {
  const before = await todaySummary();
  const dayStart = tashkentDayStart(new Date());
  await mk('COMPLETED', 40_000, 'CARD');                       // delivered, paid
  await mk('PREPARING', 30_000, 'CASH');                       // in progress, paid in cash
  await mk('CANCELLED', 20_000, 'CARD');                       // cancelled: no revenue
  await mk('PAYMENT_PENDING', 10_000, 'CARD');                 // in progress, not paid yet: no revenue
  await mk('COMPLETED', 99_000, 'CARD', { paymentIsTest: true });                                   // test payment: ignored
  await mk('COMPLETED', 98_000, 'CARD', { createdViaBot: false });                                  // not a customer order: ignored
  await mk('COMPLETED', 97_000, 'CARD', { createdAt: new Date(dayStart.getTime() - 3_600_000) });   // yesterday (Tashkent): ignored
  const after = await todaySummary();
  assert.equal(after.orders.total - before.orders.total, 4);
  assert.equal(after.orders.delivered - before.orders.delivered, 1);
  assert.equal(after.orders.cancelled - before.orders.cancelled, 1);
  assert.equal(after.orders.inProgress - before.orders.inProgress, 2);
  assert.equal(after.revenueSom - before.revenueSom, 70_000);
  assert.equal(after.cashSom - before.cashSom, 30_000);
  const viaApi = (await app.inject({ method: 'GET', url: '/api/v1/admin/today', headers: auth })).json();
  assert.equal(viaApi.orders.total, after.orders.total, 'the route returns the same numbers');
});

test('the day is the Tashkent calendar day (UTC+5)', () => {
  assert.equal(tashkentDayStart(new Date('2026-11-10T18:59:59Z')).toISOString(), '2026-11-09T19:00:00.000Z'); // 23:59 in Tashkent: still the 10th, which began at 19:00Z on the 9th
  assert.equal(tashkentDayStart(new Date('2026-11-10T19:00:00Z')).toISOString(), '2026-11-10T19:00:00.000Z'); // 00:00 on the 11th
});

test('open tickets and unhandled money reviews are counted', async () => {
  const before = await todaySummary();
  ids.ticket = (await db.supportTicket.create({ data: { customerId: ids.customer, message: `today ${tag}`, status: 'OPEN' } })).id;
  ids.incoming = (await db.incomingTransaction.create({ data: {
    sourceId: `today-${tag}`, source: 'GMAIL', cardLast4: '0000', amountTiyin: 12_300_000n, occurredAt: new Date(), emailReceivedAt: new Date(), status: 'REVIEW_REQUIRED', reason: 'NO_ACTIVE_PAYMENT',
  } })).id;
  const after = await todaySummary();
  assert.equal(after.openTickets - before.openTickets, 1);
  assert.equal(after.moneyReviews - before.moneyReviews, 1);
});
