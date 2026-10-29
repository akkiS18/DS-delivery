import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { hashToken } from '../modules/admin-auth/service.js';
import { setAdminMessenger } from '../modules/admin-auth/messenger.js';

// DS Admin A4b (taxi problems, taxi companies). Needs a *_test database (the repo's DB guard). Every row it makes is removed again; the audit
// table is append-only, so its rows stay under a unique actor id. Only synthetic companies and orders; nothing is sent anywhere.
const db = new PrismaClient();
const app = buildApp(new PaymentEngineV3(db, defaultOptions, () => {}));
const tag = randomUUID().slice(0, 8);
const adminId = `9${randomInt(100_000_000, 999_999_999)}${randomInt(100, 999)}`;
const token = randomBytes(32).toString('base64url');
const auth = { authorization: `Bearer ${token}` };
const api = (method: 'GET' | 'POST', url: string, payload?: object, headers: Record<string, string> = auth) =>
  app.inject({ method, url: `/api/v1/admin${url}`, headers, ...(payload ? { payload } : {}) });

const saved = { ...process.env };
const sent: Array<{ to: string; text: string }> = [];
const companyIds: string[] = [];
const orderIds: string[] = [];
const ids = { restaurant: '', customer: '' };
const NOTE_OK = 'Operator bilan gaplashdim, haydovchi yuborilmagan';

const createCompany = async (name: string) => {
  const r = await api('POST', '/taxi/companies', { name });
  assert.equal(r.statusCode, 201, r.body);
  const c = await db.taxiCompany.findUniqueOrThrow({ where: { name }, select: { id: true } });
  companyIds.push(c.id);
  return { ...r.json(), id: c.id } as { name: string; login: string; password: string; id: string };
};

/** A cooking order with a cleared payment and one attempt in the given state. */
async function problem(companyId: string, status: 'NEEDS_HELP' | 'DECLINED' | 'REQUESTED' = 'NEEDS_HELP') {
  const order = await db.order.create({ data: {
    restaurantId: ids.restaurant, customerId: ids.customer, addressText: 'Test manzil', totalSom: 40_000, createdViaBot: true, status: 'PREPARING', paymentIsTest: true,
    payment: { create: { restaurantId: ids.restaurant, amountTiyin: 4_000_000n, status: 'CONFIRMED_MANUAL', isTest: true } },
  } });
  orderIds.push(order.id);
  const d = await db.taxiDispatch.create({ data: { orderId: order.id, taxiCompanyId: companyId, attemptNo: 1, status, dueAt: new Date() } });
  await db.order.update({ where: { id: order.id }, data: { taxiCompanyId: companyId } });
  return { orderId: order.id, dispatchId: d.id };
}
const activeCount = (orderId: string) => db.taxiDispatch.count({ where: { orderId, status: { in: ['SCHEDULED', 'SENDING', 'REQUESTED', 'ACCEPTED', 'CANCELLATION_PENDING', 'ASSIGNED', 'NEEDS_HELP'] } } });

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  process.env.ADMIN_APP_ENABLED = 'true';
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = adminId;
  delete process.env.SUPPORT_ADMIN_2_TELEGRAM_ID;
  setAdminMessenger(async (to, text) => { sent.push({ to, text }); });
  await db.adminSession.create({ data: { tokenHash: hashToken(token), telegramUserId: adminId, expiresAt: new Date(Date.now() + 3_600_000) } });
  ids.restaurant = (await db.restaurant.create({ data: { slug: `tx-${tag}`, name: `Taksi ${tag}` } })).id;
  ids.customer = (await db.customer.create({ data: { telegramUserId: String(randomInt(900000000001, 990000000000)) } })).id;
});

after(async () => {
  setAdminMessenger(null);
  await db.order.deleteMany({ where: { id: { in: orderIds } } }); // dispatches and events cascade
  await db.taxiCompany.deleteMany({ where: { id: { in: companyIds } } }); // credential and sessions cascade
  await db.customer.deleteMany({ where: { id: ids.customer } });
  await db.restaurant.deleteMany({ where: { id: ids.restaurant } });
  await db.adminSession.deleteMany({ where: { telegramUserId: adminId } });
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  await app.close();
  await db.$disconnect();
});

test('every taxi route needs an admin session and the switch', async () => {
  for (const [m, u, body] of [
    ['GET', '/taxi/problems', undefined], ['GET', '/taxi/problems/x', undefined], ['POST', '/taxi/problems/x/recover', { action: 'DRIVER_SENT', note: NOTE_OK }],
    ['GET', '/taxi/companies', undefined], ['POST', '/taxi/companies', { name: 'Abc' }], ['POST', '/taxi/companies/x/password', undefined],
    ['GET', '/taxi/companies/x/removal', undefined], ['POST', '/taxi/companies/x/remove', { expected: 'DELETE' }],
  ] as const) {
    assert.equal((await api(m, u, body, {})).statusCode, 401, u);
    assert.equal((await api(m, u, body, { authorization: `Bearer ${'x'.repeat(43)}` })).statusCode, 401, u);
  }
  process.env.ADMIN_APP_ENABLED = 'false';
  try { assert.equal((await api('GET', '/taxi/problems')).statusCode, 404); } finally { process.env.ADMIN_APP_ENABLED = 'true'; }
});

test('a new company gets a one-time login, shows in the list as reachable, and a duplicate name is refused', async () => {
  sent.length = 0;
  const c = await createCompany(`Taksi Yangi ${tag}`);
  assert.equal(c.password.length, 14);
  assert.ok(c.login.length >= 2);
  assert.ok(sent.some(m => m.text.includes(c.login)), 'admins are told');
  assert.ok(sent.every(m => !m.text.includes(c.password)), 'the password is never sent to the chat');
  const list = (await api('GET', '/taxi/companies')).json().companies as Array<{ id: string; login: string | null; reachable: boolean; isActive: boolean }>;
  const row = list.find(x => x.id === c.id);
  assert.equal(row?.login, c.login);
  assert.equal(row?.reachable, true);
  const dup = await api('POST', '/taxi/companies', { name: `Taksi Yangi ${tag}` });
  assert.equal(dup.statusCode, 409);
  assert.equal(dup.json().error, 'COMPANY_EXISTS');
  assert.equal((await api('POST', '/taxi/companies', { name: 'A' })).statusCode, 400);
  assert.equal((await api('POST', '/taxi/companies', { name: 'Abc', extra: 1 })).statusCode, 400, 'strict body');
});

test('password reset by id gives a new password; an unknown id is 404', async () => {
  const c = await createCompany(`Taksi Parol ${tag}`);
  const before = await db.taxiCredential.findUniqueOrThrow({ where: { taxiCompanyId: c.id } });
  const r = await api('POST', `/taxi/companies/${c.id}/password`);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().login, c.login);
  assert.notEqual(r.json().password, c.password);
  const after = await db.taxiCredential.findUniqueOrThrow({ where: { taxiCompanyId: c.id } });
  assert.ok(after.passwordVersion > before.passwordVersion, 'old devices are signed out');
  assert.equal((await api('POST', '/taxi/companies/nope/password')).statusCode, 404);
});

test('removal: an empty company is deleted, one with history is archived, open work blocks, a stale confirmation does nothing', async () => {
  const empty = await createCompany(`Taksi Bosh ${tag}`);
  assert.equal((await api('GET', `/taxi/companies/${empty.id}/removal`)).json().plan.result, 'DELETE');
  const stale = await api('POST', `/taxi/companies/${empty.id}/remove`, { expected: 'ARCHIVE' });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error, 'CHANGED');
  assert.ok(await db.taxiCompany.findUnique({ where: { id: empty.id } }));
  const gone = await api('POST', `/taxi/companies/${empty.id}/remove`, { expected: 'DELETE' });
  assert.equal(gone.statusCode, 200, gone.body);
  assert.equal(gone.json().result, 'DELETED');
  assert.equal(await db.taxiCompany.findUnique({ where: { id: empty.id } }), null);

  const used = await createCompany(`Taksi Tarix ${tag}`);
  const p = await problem(used.id, 'REQUESTED');
  const blocked = await api('POST', `/taxi/companies/${used.id}/remove`, { expected: 'ARCHIVE' });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().error, 'REMOVAL_BLOCKED');
  assert.equal(blocked.json().reason, 'OPEN_DISPATCHES');
  await db.taxiDispatch.update({ where: { id: p.dispatchId }, data: { status: 'DELIVERED' } });
  assert.equal((await api('GET', `/taxi/companies/${used.id}/removal`)).json().plan.result, 'ARCHIVE');
  const arch = await api('POST', `/taxi/companies/${used.id}/remove`, { expected: 'ARCHIVE' });
  assert.equal(arch.statusCode, 200, arch.body);
  assert.equal(arch.json().result, 'ARCHIVED');
  const row = await db.taxiCompany.findUniqueOrThrow({ where: { id: used.id } });
  assert.equal(row.isActive, false);
  assert.ok(row.name.includes('[arxiv'));
  assert.ok(!(await api('GET', '/taxi/companies')).json().companies.some((c: { id: string }) => c.id === used.id), 'archived companies are not listed');
  assert.equal((await api('GET', '/taxi/companies/nope/removal')).statusCode, 404);
});

test('a stuck dispatch is listed with its history and the companies it can move to', async () => {
  const a = await createCompany(`Taksi A ${tag}`);
  const b = await createCompany(`Taksi B ${tag}`);
  const p = await problem(a.id);
  const list = (await api('GET', '/taxi/problems')).json().problems as Array<{ id: string; status: string; companyName: string }>;
  const row = list.find(x => x.id === p.dispatchId);
  assert.ok(row, 'listed');
  assert.equal(row.status, 'NEEDS_HELP');
  const d = (await api('GET', `/taxi/problems/${p.dispatchId}`)).json();
  assert.equal(d.open, true);
  assert.equal(d.history.length, 1);
  assert.ok(d.companies.some((c: { id: string }) => c.id === b.id));
  assert.equal((await api('GET', '/taxi/problems/nope')).statusCode, 404);
});

test('recovery: the note is required, "driver sent" records and creates nothing, a repeat is "changed"', async () => {
  const a = await createCompany(`Taksi N ${tag}`);
  const p = await problem(a.id);
  const short = await api('POST', `/taxi/problems/${p.dispatchId}/recover`, { action: 'RETRY_SAME', note: 'qisqa' });
  assert.equal(short.statusCode, 400);
  assert.equal(short.json().error, 'NOTE_INVALID');
  assert.equal((await db.taxiDispatch.findUniqueOrThrow({ where: { id: p.dispatchId } })).status, 'NEEDS_HELP', 'nothing happened');
  const withCompany = await api('POST', `/taxi/problems/${p.dispatchId}/recover`, { action: 'DRIVER_SENT', companyId: a.id, note: NOTE_OK });
  assert.equal(withCompany.statusCode, 400, 'a company only makes sense for REASSIGN');
  sent.length = 0;
  const ok = await api('POST', `/taxi/problems/${p.dispatchId}/recover`, { action: 'DRIVER_SENT', note: 'Haydovchi Akmal yuborilgan, operator tasdiqladi' });
  assert.equal(ok.statusCode, 200, ok.body);
  const d = await db.taxiDispatch.findUniqueOrThrow({ where: { id: p.dispatchId } });
  assert.equal(d.status, 'ASSIGNED');
  assert.equal(await db.taxiDispatch.count({ where: { orderId: p.orderId } }), 1, 'no second booking');
  assert.ok(sent.length >= 1, 'admins are told');
  const again = await api('POST', `/taxi/problems/${p.dispatchId}/recover`, { action: 'DRIVER_SENT', note: 'Haydovchi Akmal yuborilgan, operator tasdiqladi' });
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error, 'CHANGED');
  assert.equal((await api('POST', '/taxi/problems/nope/recover', { action: 'DRIVER_SENT', note: NOTE_OK })).statusCode, 404);
});

test('recovery: reassign and retry leave exactly one active attempt and keep the history', async () => {
  const a = await createCompany(`Taksi R1 ${tag}`);
  const b = await createCompany(`Taksi R2 ${tag}`);
  const p = await problem(a.id);
  const moved = await api('POST', `/taxi/problems/${p.dispatchId}/recover`, { action: 'REASSIGN', companyId: b.id, note: NOTE_OK });
  assert.equal(moved.statusCode, 200, moved.body);
  assert.equal(moved.json().companyName, b.name);
  const rows = await db.taxiDispatch.findMany({ where: { orderId: p.orderId }, orderBy: { attemptNo: 'asc' } });
  assert.deepEqual(rows.map(r => r.status), ['CANCELLED', 'SCHEDULED']);
  assert.equal(rows[1]?.taxiCompanyId, b.id);
  assert.equal(await activeCount(p.orderId), 1);
  // the first attempt is terminal now: acting on it again changes nothing
  const stale = await api('POST', `/taxi/problems/${p.dispatchId}/recover`, { action: 'RETRY_SAME', note: NOTE_OK });
  assert.equal(stale.statusCode, 409);
  assert.equal(await db.taxiDispatch.count({ where: { orderId: p.orderId } }), 2);

  const q = await problem(a.id, 'DECLINED');
  const retried = await api('POST', `/taxi/problems/${q.dispatchId}/recover`, { action: 'RETRY_SAME', note: NOTE_OK });
  assert.equal(retried.statusCode, 200, retried.body);
  const qrows = await db.taxiDispatch.findMany({ where: { orderId: q.orderId }, orderBy: { attemptNo: 'asc' } });
  assert.equal(qrows.length, 2);
  assert.equal(qrows[1]?.taxiCompanyId, a.id);
  assert.equal(await activeCount(q.orderId), 1);

  const r = await problem(a.id);
  const nobody = await api('POST', `/taxi/problems/${r.dispatchId}/recover`, { action: 'REASSIGN', companyId: 'doesnotexist', note: NOTE_OK });
  assert.equal(nobody.statusCode, 409);
  assert.equal(nobody.json().error, 'NO_COMPANY');
  assert.equal((await db.taxiDispatch.findUniqueOrThrow({ where: { id: r.dispatchId } })).status, 'NEEDS_HELP', 'a refused move leaves the attempt as it was');
});

test('two recover taps at once make one new attempt', async () => {
  const a = await createCompany(`Taksi C1 ${tag}`);
  const b = await createCompany(`Taksi C2 ${tag}`);
  const p = await problem(a.id);
  const [x, y] = await Promise.all([
    api('POST', `/taxi/problems/${p.dispatchId}/recover`, { action: 'REASSIGN', companyId: b.id, note: NOTE_OK }),
    api('POST', `/taxi/problems/${p.dispatchId}/recover`, { action: 'REASSIGN', companyId: b.id, note: NOTE_OK }),
  ]);
  assert.deepEqual([x.statusCode, y.statusCode].sort(), [200, 409]);
  assert.equal(await db.taxiDispatch.count({ where: { orderId: p.orderId } }), 2);
  assert.equal(await activeCount(p.orderId), 1);
});
