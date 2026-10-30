import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { hashToken } from '../modules/admin-auth/service.js';
import { placeOrder } from '../modules/orders/service.js';
import { recordStrike } from '../modules/customer-strikes/service.js';

// DS Admin A5b (customer strikes and blocks). Needs a *_test database (the repo's DB guard). MOCK payments only.
process.env.MAX_OPEN_UNPAID_ORDERS = '0';
delete process.env.RESTAURANT_MANUAL_ACCEPTANCE;
const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const app = buildApp(engine);
const tag = randomUUID().slice(0, 8);
const adminId = `9${randomInt(100_000_000, 999_999_999)}${randomInt(100, 999)}`;
const token = randomBytes(32).toString('base64url');
const auth = { authorization: `Bearer ${token}` };
const api = (method: 'GET' | 'POST', url: string, payload?: object, headers: Record<string, string> = auth) =>
  app.inject({ method, url: `/api/v1/admin${url}`, headers, ...(payload ? { payload } : {}) });

const saved = { ...process.env };
const ids = { restaurant: '', product: '', taxi: '', customer: '', other: '' };
const tgOf = { customer: String(randomInt(900000000001, 960000000000)), other: String(randomInt(960000000001, 990000000000)) };
const cards: string[] = [];
const NOTE = 'Mijoz buyurtmani olmadi, restoran bilan telefonda tekshirildi';

const place = (method: 'CARD' | 'CASH', tg = tgOf.customer) => placeOrder(engine, {
  restaurantId: ids.restaurant, telegramUserId: tg, customerName: 'Tester', phone: '+998901234567', addressText: 'Test manzil',
  taxiCompanyId: ids.taxi, checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'MOCK', items: [{ productId: ids.product, quantity: 1 }], paymentMethod: method,
});
const refusal = async (p: Promise<unknown>) => { try { await p; return 'NO_ERROR'; } catch (e) { return e instanceof Error ? e.message : String(e); } };
const standing = async () => ((await api('GET', `/customers/${ids.customer}`)).json() as { strikes: number; cashAllowed: boolean; blocked: boolean });
const strike = () => api('POST', `/customers/${ids.customer}/strikes`, { note: NOTE });

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  process.env.ADMIN_APP_ENABLED = 'true';
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = adminId;
  delete process.env.SUPPORT_ADMIN_2_TELEGRAM_ID;
  await db.adminSession.create({ data: { tokenHash: hashToken(token), telegramUserId: adminId, expiresAt: new Date(Date.now() + 3_600_000) } });
  ids.restaurant = (await db.restaurant.create({ data: { slug: `cu-${tag}`, name: `Mijoz ${tag}`, pickupAddress: 'Pickup', pickupPhone: '+998900000001', defaultPrepMinutes: 30 } })).id;
  ids.product = (await db.product.create({ data: { restaurantId: ids.restaurant, name: `osh-${tag}`, priceSom: 25_000 } })).id;
  ids.taxi = (await db.taxiCompany.create({ data: { name: `Cu Taxi ${randomUUID()}`, operatorTelegramUserId: String(randomInt(900000000001, 990000000000)), isActive: true } })).id;
  ids.customer = (await db.customer.create({ data: { telegramUserId: tgOf.customer, displayName: `Sinovchi ${tag}`, phone: '+998935550011' } })).id;
  ids.other = (await db.customer.create({ data: { telegramUserId: tgOf.other, displayName: `Boshqa ${tag}` } })).id;
  for (;;) {
    const c = String(randomInt(1000, 9999));
    if (await db.card.findUnique({ where: { last4: c } })) continue;
    cards.push(c); await engine.addCard(c, true, ids.restaurant); break;
  }
});

after(async () => {
  const cids = [ids.customer, ids.other];
  const orders = (await db.order.findMany({ where: { restaurantId: ids.restaurant }, select: { id: true } })).map(o => o.id);
  await db.customerStrike.deleteMany({ where: { customerId: { in: cids } } });
  await db.$transaction(async tx => { // the audit trail is append-only; this switch exists for exactly this cleanup
    await tx.$executeRaw`SELECT set_config('ds.ledger_cleanup', 'on', true)`;
    await tx.adminAuditEvent.deleteMany({ where: { actorId: adminId } });
  });
  await db.notificationLog.deleteMany({ where: { orderId: { in: orders } } });
  await db.taxiDispatch.deleteMany({ where: { orderId: { in: orders } } });
  await db.payment.deleteMany({ where: { orderId: { in: orders } } });
  await db.order.deleteMany({ where: { id: { in: orders } } });
  const cardRows = await db.card.findMany({ where: { restaurantId: ids.restaurant }, select: { id: true } });
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cardRows.map(c => c.id) } } });
  await db.incomingTransaction.deleteMany({ where: { cardLast4: { in: cards } } });
  await db.card.deleteMany({ where: { restaurantId: ids.restaurant } });
  await db.customer.deleteMany({ where: { id: { in: cids } } });
  await db.product.deleteMany({ where: { restaurantId: ids.restaurant } });
  await db.taxiCompany.deleteMany({ where: { id: ids.taxi } });
  await db.restaurant.deleteMany({ where: { id: ids.restaurant } });
  await db.adminSession.deleteMany({ where: { telegramUserId: adminId } });
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  await app.close();
  await db.$disconnect();
});

test('every customer route needs an admin session and the switch', async () => {
  for (const [m, u, body] of [['GET', '/customers', undefined], ['GET', '/customers/x', undefined], ['POST', '/customers/x/strikes', { note: NOTE }], ['POST', '/customers/x/block', { note: NOTE }]] as const) {
    assert.equal((await api(m, u, body, {})).statusCode, 401, u);
    assert.equal((await api(m, u, body, { authorization: `Bearer ${'x'.repeat(43)}` })).statusCode, 401, u);
  }
  process.env.ADMIN_APP_ENABLED = 'false';
  try { assert.equal((await api('GET', '/customers')).statusCode, 404); } finally { process.env.ADMIN_APP_ENABLED = 'true'; }
});

test('a customer with no strikes orders by card and in cash', async () => {
  const s0 = await standing();
  assert.equal(s0.strikes, 0);
  assert.equal(s0.cashAllowed, true);
  assert.equal(s0.blocked, false);
  assert.equal(await refusal(place('CASH')), 'NO_ERROR');
  assert.equal(await refusal(place('CARD')), 'NO_ERROR');
});

test('one strike closes cash for that customer only; card orders still work', async () => {
  const short = await api('POST', `/customers/${ids.customer}/strikes`, { note: 'qisqa' });
  assert.equal(short.statusCode, 400);
  assert.equal(short.json().error, 'NOTE_INVALID');
  const res = await strike();
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().standing.strikes, 1);
  assert.equal(res.json().standing.cashAllowed, false);
  assert.equal(res.json().standing.blocked, false);
  assert.equal(await refusal(place('CASH')), 'NAQD_TOLOV_YOPIQ');
  assert.equal(await refusal(place('CARD')), 'NO_ERROR');
  assert.equal(await refusal(place('CASH', tgOf.other)), 'NO_ERROR', 'another customer is untouched');
  assert.equal(await db.adminAuditEvent.count({ where: { actorId: adminId, action: 'CUSTOMER_STRIKE_ADDED' } }), 1);
});

test('five active strikes block the customer completely; revoking one lifts the block but cash stays closed', async () => {
  for (let i = 0; i < 4; i++) assert.equal((await strike()).statusCode, 201);
  const s = await standing();
  assert.equal(s.strikes, 5);
  assert.equal(s.blocked, true);
  assert.equal(await refusal(place('CARD')), 'MIJOZ_BLOKLANGAN');
  assert.equal(await refusal(place('CASH')), 'MIJOZ_BLOKLANGAN');
  const detail = (await api('GET', `/customers/${ids.customer}`)).json() as { strikeLines: Array<{ id: string }> };
  const one = detail.strikeLines[0]!.id;
  assert.equal((await api('POST', `/customers/${ids.customer}/strikes/${one}/revoke`, { note: 'ok' })).statusCode, 400, 'a revoke needs a real note');
  const ok = await api('POST', `/customers/${ids.customer}/strikes/${one}/revoke`, { note: NOTE });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual(ok.json().standing, { strikes: 4, cashAllowed: false, blocked: false, manuallyBlocked: false });
  assert.equal(await refusal(place('CARD')), 'NO_ERROR');
  assert.equal(await refusal(place('CASH')), 'NAQD_TOLOV_YOPIQ');
  assert.equal((await api('POST', `/customers/${ids.customer}/strikes/${one}/revoke`, { note: NOTE })).statusCode, 409, 'revoking twice changes nothing');
  assert.equal((await api('POST', `/customers/${ids.customer}/strikes/nope/revoke`, { note: NOTE })).statusCode, 404);
});

test('two revokes of the same strike at once revoke it exactly once', async () => {
  const detail = (await api('GET', `/customers/${ids.customer}`)).json() as { strikeLines: Array<{ id: string; revokedAt: string | null }> };
  const live = detail.strikeLines.find(l => l.revokedAt === null)!;
  const [a, b] = await Promise.all([
    api('POST', `/customers/${ids.customer}/strikes/${live.id}/revoke`, { note: NOTE }),
    api('POST', `/customers/${ids.customer}/strikes/${live.id}/revoke`, { note: NOTE }),
  ]);
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 409]);
  assert.equal(await db.adminAuditEvent.count({ where: { actorId: adminId, action: 'CUSTOMER_STRIKE_REVOKED' } }), 2);
});

test('a strike tied to an order is recorded once however often it is sent (the restaurant button tapped twice)', async () => {
  const order = await place('CARD', tgOf.other);
  const orderId = (order as { id: string }).id;
  const [a, b] = await Promise.all([1, 2].map(() => recordStrike({ customerId: ids.other, orderId, source: 'ADMIN', reportedBy: adminId, note: NOTE })));
  assert.deepEqual([a!.result, b!.result].sort(), ['ADDED', 'ALREADY_RECORDED']);
  assert.equal(await db.customerStrike.count({ where: { customerId: ids.other, orderId } }), 1);
  await db.customerStrike.deleteMany({ where: { customerId: ids.other } });
});

test('a manual block stops all ordering and is lifted with a note; repeats change nothing', async () => {
  const res = await api('POST', `/customers/${ids.other}/block`, { note: NOTE });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().standing.blocked, true);
  assert.equal(await refusal(place('CARD', tgOf.other)), 'MIJOZ_BLOKLANGAN');
  assert.equal((await api('POST', `/customers/${ids.other}/block`, { note: NOTE })).statusCode, 409);
  assert.equal((await api('POST', `/customers/${ids.other}/unblock`, { note: 'ok' })).statusCode, 400);
  assert.equal((await api('POST', `/customers/${ids.other}/unblock`, { note: NOTE })).statusCode, 200);
  assert.equal(await refusal(place('CARD', tgOf.other)), 'NO_ERROR');
  assert.equal((await api('POST', `/customers/${ids.other}/unblock`, { note: NOTE })).statusCode, 409);
  assert.equal((await api('POST', '/customers/nope/block', { note: NOTE })).statusCode, 404);
});

test('the list shows customers with a strike or block; search finds by Telegram id, phone fragment and name', async () => {
  await db.customer.update({ where: { id: ids.customer }, data: { displayName: `Sinovchi ${tag}`, phone: '+998935550011' } }); // checkout overwrote both
  const flagged = (await api('GET', '/customers')).json() as { customers: Array<{ id: string; strikes: number }> };
  assert.ok(flagged.customers.some(c => c.id === ids.customer && c.strikes === 3));
  assert.ok(!flagged.customers.some(c => c.id === ids.other), 'unblocked and strike-free: not flagged');
  for (const q of [tgOf.customer, '5550011', `Sinovchi ${tag}`.toLowerCase()]) {
    const found = (await api('GET', `/customers?q=${encodeURIComponent(q)}`)).json() as { customers: Array<{ id: string }> };
    assert.ok(found.customers.some(c => c.id === ids.customer), `found by ${q}`);
  }
  assert.deepEqual(((await api('GET', '/customers?q=x')).json() as { customers: unknown[] }).customers, [], 'too short to search');
});
