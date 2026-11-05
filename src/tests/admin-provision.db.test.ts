import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { hashToken } from '../modules/admin-auth/service.js';
import { setAdminMessenger } from '../modules/admin-auth/messenger.js';

// DS Admin A3b (add restaurant, password, staff link, photo, delete/archive). Needs a *_test database (the repo's DB guard). Every restaurant it
// makes is removed again; AdminAuditEvent is append-only, so its rows stay under a unique actor id.
const db = new PrismaClient();
const app = buildApp(new PaymentEngineV3(db, defaultOptions, () => {}));
const tag = randomUUID().slice(0, 8);
const adminId = `9${randomInt(100_000_000, 999_999_999)}${randomInt(100, 999)}`;
const token = randomBytes(32).toString('base64url');
const auth = { authorization: `Bearer ${token}` };
const api = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object | Buffer, headers: Record<string, string> = auth) =>
  app.inject({ method, url: `/api/v1/admin${url}`, headers, ...(payload ? { payload } : {}) });

const saved = { ...process.env };
const sent: Array<{ to: string; text: string }> = [];
const madeSlugs: string[] = [];
const madeIds: string[] = [];
let customerId = '';

// A valid PNG signature padded past the minimum size: the server only sniffs the magic bytes.
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 7)]);
const png2 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(3000, 9)]);

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  process.env.ADMIN_APP_ENABLED = 'true';
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = adminId;
  delete process.env.SUPPORT_ADMIN_2_TELEGRAM_ID;
  setAdminMessenger(async (to, text) => { sent.push({ to, text }); });
  await db.adminSession.create({ data: { tokenHash: hashToken(token), telegramUserId: adminId, expiresAt: new Date(Date.now() + 3_600_000) } });
  customerId = (await db.customer.create({ data: { telegramUserId: String(randomInt(900000000001, 990000000000)) } })).id;
});

after(async () => {
  setAdminMessenger(null);
  const rows = await db.restaurant.findMany({ where: { OR: [{ id: { in: madeIds } }, { slug: { in: madeSlugs } }] }, select: { id: true } });
  const rids = rows.map(r => r.id);
  await db.order.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.restaurantSession.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.restaurantCredential.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.restaurantImage.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.restaurant.deleteMany({ where: { id: { in: rids } } });
  await db.customer.deleteMany({ where: { id: customerId } });
  await db.adminSession.deleteMany({ where: { telegramUserId: adminId } });
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  await app.close();
  await db.$disconnect();
});

const audits = (action: string) => db.adminAuditEvent.count({ where: { actorId: adminId, action } });
const create = async (name: string) => {
  const r = await api('POST', '/restaurants', { name, pickupAddress: 'Osh, test ko‘cha 1', pickupPhone: '+998901234567' });
  assert.equal(r.statusCode, 201, r.body);
  const body = r.json();
  madeSlugs.push(body.slug);
  const row = await db.restaurant.findUniqueOrThrow({ where: { slug: body.slug }, select: { id: true } });
  madeIds.push(row.id);
  return { ...body, id: row.id } as { slug: string; name: string; password: string; id: string };
};

test('every provisioning route needs an admin session and the switch', async () => {
  for (const [m, u, body] of [
    ['POST', '/restaurants', { name: 'Abc', pickupAddress: 'Manzil 1' }], ['POST', '/restaurants/x/password', undefined], ['POST', '/restaurants/x/finance-pin', undefined], ['PUT', '/restaurants/x/staff', { telegramId: '1' }],
    ['GET', '/restaurants/x/removal', undefined], ['POST', '/restaurants/x/remove', { expected: 'DELETE' }],
  ] as const) {
    assert.equal((await api(m, u, body, {})).statusCode, 401, u);
    assert.equal((await api(m, u, body, { authorization: `Bearer ${'x'.repeat(43)}` })).statusCode, 401, u);
  }
  // The photo route authenticates before the body is read.
  assert.equal((await api('PUT', '/restaurants/x/image', png, { 'content-type': 'image/png' })).statusCode, 401);
  process.env.ADMIN_APP_ENABLED = 'false';
  try { assert.equal((await api('POST', '/restaurants', { name: 'Abc', pickupAddress: 'Manzil 1' })).statusCode, 404); } finally { process.env.ADMIN_APP_ENABLED = 'true'; }
});

test('a new restaurant starts paused, has a one-time password, is audited and announced without the password', async () => {
  const before = await audits('RESTAURANT_CREATED');
  sent.length = 0;
  const r = await create(`Provision ${tag}`);
  assert.equal(r.password.length, 14);
  const row = await db.restaurant.findUniqueOrThrow({ where: { id: r.id }, select: { isPaused: true, isActive: true, pickupAddress: true, pickupPhone: true } });
  assert.equal(row.isPaused, true);
  assert.equal(row.pickupPhone, '+998901234567');
  assert.equal(await audits('RESTAURANT_CREATED'), before + 1);
  assert.ok(sent.some(m => m.text.includes(r.slug)), 'admins are told');
  assert.ok(sent.every(m => !m.text.includes(r.password)), 'the password is never sent to the chat');
  const res = await api('POST', '/restaurants', { name: `Provision ${tag}`, pickupAddress: 'Boshqa manzil' });
  assert.equal(res.statusCode, 201);
  assert.notEqual(res.json().slug, r.slug, 'the same name gets the next free slug');
  madeSlugs.push(res.json().slug);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('bad input is a clear 400, nothing is created', async () => {
  const count = () => db.restaurant.count({ where: { name: { contains: `Bad ${tag}` } } });
  const start = await count();
  const cases: Array<[object, string]> = [
    [{ name: 'A', pickupAddress: 'Manzil 1' }, 'NAME_INVALID'],
    [{ name: `Bad ${tag}`, pickupAddress: 'ab' }, 'ADDRESS_INVALID'],
    [{ name: `Bad ${tag}`, pickupAddress: 'Manzil 1', pickupPhone: 'telefon' }, 'PHONE_INVALID'],
  ];
  for (const [body, code] of cases) {
    const r = await api('POST', '/restaurants', body);
    assert.equal(r.statusCode, 400, JSON.stringify(body));
    assert.equal(r.json().error, code);
  }
  assert.equal((await api('POST', '/restaurants', { name: `Bad ${tag}`, pickupAddress: 'Manzil 1', extra: 1 })).statusCode, 400, 'strict body');
  assert.equal(await count(), start);
});

test('password reset: a new password, old sessions signed out, unknown id is 404', async () => {
  const r = await create(`Parol ${tag}`);
  await db.restaurantSession.create({ data: { restaurantId: r.id, passwordVersion: 1, tokenHash: hashToken(randomBytes(32).toString('base64url')), expiresAt: new Date(Date.now() + 3_600_000) } });
  const before = await audits('RESTAURANT_PASSWORD_RESET');
  const res = await api('POST', `/restaurants/${r.id}/password`);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().password.length, 14);
  assert.notEqual(res.json().password, r.password);
  assert.equal(await db.restaurantSession.count({ where: { restaurantId: r.id, revokedAt: null } }), 0);
  assert.equal(await audits('RESTAURANT_PASSWORD_RESET'), before + 1);
  assert.equal((await api('POST', '/restaurants/nope/password')).statusCode, 404);
});

test('finance code: issued once, only a hash is stored, a new one replaces it, audited and announced without the code, unknown id is 404', async () => {
  const r = await create(`Kod ${tag}`);
  const list = async () => (await api('GET', '/restaurants')).json().restaurants.find((x: { id: string }) => x.id === r.id);
  assert.equal((await list()).hasFinancePin, false);
  const before = await audits('FINANCE_PIN_ISSUED');
  const sentBefore = sent.length;
  const one = await api('POST', `/restaurants/${r.id}/finance-pin`);
  assert.equal(one.statusCode, 200, one.body);
  assert.match(one.json().pin, /^\d{4}$/);
  assert.equal(one.headers['cache-control'], 'no-store');
  const row = await db.restaurantFinancePin.findUniqueOrThrow({ where: { restaurantId: r.id } });
  assert.ok(!row.pinHash.includes(one.json().pin) && row.pinHash.startsWith('$argon2'), 'only a hash is stored');
  assert.equal((await list()).hasFinancePin, true);
  assert.equal(await audits('FINANCE_PIN_ISSUED'), before + 1);
  assert.ok(sent.slice(sentBefore).length > 0 && sent.slice(sentBefore).every(m => !m.text.includes(one.json().pin)), 'the code is never sent to Telegram');
  const two = await api('POST', `/restaurants/${r.id}/finance-pin`);
  assert.equal(two.statusCode, 200);
  assert.notEqual((await db.restaurantFinancePin.findUniqueOrThrow({ where: { restaurantId: r.id } })).pinHash, row.pinHash);
  assert.equal((await api('POST', '/restaurants/nope/finance-pin')).statusCode, 404);
});

test('staff link: linked, the same Telegram account cannot serve two restaurants', async () => {
  const a = await create(`Xodim A ${tag}`);
  const b = await create(`Xodim B ${tag}`);
  const tg = String(randomInt(800000000001, 899999999999));
  const ok = await api('PUT', `/restaurants/${a.id}/staff`, { telegramId: tg });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal((await db.restaurant.findUniqueOrThrow({ where: { id: a.id } })).staffTelegramUserId, tg);
  const taken = await api('PUT', `/restaurants/${b.id}/staff`, { telegramId: tg });
  assert.equal(taken.statusCode, 409);
  assert.equal(taken.json().error, 'TELEGRAM_TAKEN');
  assert.equal(taken.json().otherSlug, a.slug);
  assert.equal((await db.restaurant.findUniqueOrThrow({ where: { id: b.id } })).staffTelegramUserId, null);
  assert.equal((await api('PUT', `/restaurants/${b.id}/staff`, { telegramId: 'abc' })).statusCode, 400);
  assert.equal((await api('PUT', '/restaurants/nope/staff', { telegramId: tg })).statusCode, 404);
});

test('photo: stored and replaced (version grows), a non-image is refused', async () => {
  const r = await create(`Rasm ${tag}`);
  const h = { ...auth, 'content-type': 'image/png' };
  const first = await api('PUT', `/restaurants/${r.id}/image`, png, h);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().version, 1);
  const second = await api('PUT', `/restaurants/${r.id}/image`, png2, h);
  assert.equal(second.json().version, 2);
  const stored = await db.restaurantImage.findUniqueOrThrow({ where: { restaurantId: r.id } });
  assert.equal(stored.mime, 'image/png');
  assert.equal(stored.data.length, png2.length);
  const junk = Buffer.alloc(3000, 1); // right size, wrong magic bytes
  const bad = await api('PUT', `/restaurants/${r.id}/image`, junk, h);
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error, 'IMAGE_INVALID');
  assert.equal((await db.restaurantImage.findUniqueOrThrow({ where: { restaurantId: r.id } })).version, 2);
  assert.equal((await api('PUT', '/restaurants/nope/image', png, h)).statusCode, 404);
});

test('removal: an empty restaurant is deleted, one with history is archived, a stale confirmation changes nothing', async () => {
  const empty = await create(`Bosh ${tag}`);
  const plan = await api('GET', `/restaurants/${empty.id}/removal`);
  assert.equal(plan.statusCode, 200);
  assert.equal(plan.json().plan.result, 'DELETE');
  // The screen said ARCHIVE but the truth is DELETE: nothing happens.
  const stale = await api('POST', `/restaurants/${empty.id}/remove`, { expected: 'ARCHIVE' });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error, 'CHANGED');
  assert.ok(await db.restaurant.findUnique({ where: { id: empty.id } }));
  const gone = await api('POST', `/restaurants/${empty.id}/remove`, { expected: 'DELETE' });
  assert.equal(gone.statusCode, 200, gone.body);
  assert.equal(gone.json().result, 'DELETED');
  assert.equal(await db.restaurant.findUnique({ where: { id: empty.id } }), null);
  assert.equal(await audits('RESTAURANT_DELETED') >= 1, true);
  assert.equal((await api('GET', `/restaurants/${empty.id}/removal`)).statusCode, 404);

  const used = await create(`Tarix ${tag}`);
  await db.order.create({ data: { restaurantId: used.id, customerId, addressText: 'x', totalSom: 1000, createdViaBot: true, status: 'CUSTOMER_CANCELLED' } });
  assert.equal((await api('GET', `/restaurants/${used.id}/removal`)).json().plan.result, 'ARCHIVE');
  const arch = await api('POST', `/restaurants/${used.id}/remove`, { expected: 'ARCHIVE' });
  assert.equal(arch.statusCode, 200, arch.body);
  assert.equal(arch.json().result, 'ARCHIVED');
  const row = await db.restaurant.findUniqueOrThrow({ where: { id: used.id }, select: { isActive: true, slug: true } });
  assert.equal(row.isActive, false);
  assert.ok(row.slug.startsWith('arxiv-'));
  assert.equal(await db.restaurantCredential.count({ where: { restaurantId: used.id } }), 0);
});

test('removal is refused while an order is unfinished', async () => {
  const r = await create(`Ochiq ${tag}`);
  await db.order.create({ data: { restaurantId: r.id, customerId, addressText: 'x', totalSom: 1000, createdViaBot: true, status: 'PAYMENT_CONFIRMED' } });
  const res = await api('POST', `/restaurants/${r.id}/remove`, { expected: 'ARCHIVE' });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error, 'REMOVAL_BLOCKED');
  assert.equal(res.json().reason, 'OPEN_ORDERS');
  assert.ok(await db.restaurant.findUnique({ where: { id: r.id } }));
});
