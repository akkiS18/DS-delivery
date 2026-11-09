import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { hashToken } from '../modules/admin-auth/service.js';
import { activeLandmarks, clearLandmarkCache, landmarkNote } from '../modules/landmarks/service.js';

// DS Admin landmarks. Needs a *_test database (the repo's DB guard). Every landmark it creates carries the unique admin id as createdBy and is deleted
// afterwards; AdminAuditEvent rows stay under that unique actor id.
const db = new PrismaClient();
const app = buildApp(new PaymentEngineV3(db, defaultOptions, () => {}));
const tag = randomUUID().slice(0, 8);
const adminId = `9${randomInt(100_000_000, 999_999_999)}${randomInt(100, 999)}`;
const token = randomBytes(32).toString('base64url');
const auth = { authorization: `Bearer ${token}` };
const saved = { ...process.env };
const api = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object, headers: Record<string, string> = auth) =>
  app.inject({ method, url: `/api/v1/admin${url}`, headers, ...(payload ? { payload } : {}) });
const audits = (action: string) => db.adminAuditEvent.count({ where: { actorId: adminId, action } });
const T = { lat: 40.0304, lng: 65.6672 }; // Ziyovuddin centre
const name = (s: string) => `${s} ${tag}`;

before(async () => {
  await db.$connect();
  const [{ name: dbName }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(dbName, /test/i, `refusing to run against database "${dbName}"`);
  process.env.ADMIN_APP_ENABLED = 'true';
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = adminId;
  delete process.env.SUPPORT_ADMIN_2_TELEGRAM_ID;
  await db.adminSession.create({ data: { tokenHash: hashToken(token), telegramUserId: adminId, expiresAt: new Date(Date.now() + 3_600_000) } });
});

after(async () => {
  await db.landmark.deleteMany({ where: { createdBy: adminId } });
  await db.adminSession.deleteMany({ where: { telegramUserId: adminId } });
  clearLandmarkCache();
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  await app.close();
  await db.$disconnect();
});

test('every landmark route needs an admin session and the switch', async () => {
  for (const [m, u, b] of [['GET', '/landmarks'], ['POST', '/landmarks', { name: 'Bozor', kind: 'MARKET', ...T }], ['PUT', '/landmarks/x', { isActive: false }], ['DELETE', '/landmarks/x']] as const) {
    assert.equal((await api(m, u, b, {})).statusCode, 401, `${m} ${u}`);
    assert.equal((await api(m, u, b, { authorization: `Bearer ${'x'.repeat(43)}` })).statusCode, 401, `${m} ${u} bad token`);
  }
  process.env.ADMIN_APP_ENABLED = 'false';
  try { assert.equal((await api('GET', '/landmarks')).statusCode, 404); } finally { process.env.ADMIN_APP_ENABLED = 'true'; }
});

test('create: validation, the service area, a duplicate and the audit trail', async () => {
  const bad = async (body: object, status: number, error?: string) => {
    const r = await api('POST', '/landmarks', body);
    assert.equal(r.statusCode, status, JSON.stringify(body) + ' -> ' + r.body);
    if (error) assert.equal(r.json().error, error);
  };
  await bad({ name: 'x', kind: 'MARKET', ...T }, 400, 'NAME_INVALID');
  await bad({ name: '   ', kind: 'MARKET', ...T }, 400, 'NAME_INVALID');
  await bad({ name: name('A'), kind: 'market', ...T }, 400, 'KIND_INVALID');
  await bad({ name: name('A'), kind: 'MARKET', lat: T.lng, lng: T.lat }, 400, 'OUT_OF_AREA'); // swapped
  await bad({ name: name('A'), kind: 'MARKET', lat: 41.3, lng: 69.2 }, 400, 'OUT_OF_AREA');   // Tashkent
  await bad({ name: name('A'), kind: 'MARKET', lat: 120, lng: T.lng }, 400);                    // not on Earth
  await bad({ name: name('A'), kind: 'MARKET', ...T, extra: 1 }, 400);                          // strict body
  await bad({ name: name('A'), kind: 'MARKET', lat: T.lat }, 400);                              // a point needs both
  assert.equal(await db.landmark.count({ where: { createdBy: adminId } }), 0, 'nothing was stored by the refusals');

  const ok = await api('POST', '/landmarks', { name: `  ${name('Markaziy   bozor')} `, kind: 'MARKET', ...T });
  assert.equal(ok.statusCode, 200, ok.body);
  const row = await db.landmark.findUniqueOrThrow({ where: { id: ok.json().id } });
  assert.equal(row.name, name('Markaziy bozor'), 'spaces are tidied');
  assert.equal(row.createdBy, adminId);
  assert.equal(await audits('LANDMARK_CREATED'), 1);

  await bad({ name: name('markaziy BOZOR'), kind: 'SHOP', lat: T.lat + 0.0005, lng: T.lng }, 409, 'LANDMARK_EXISTS'); // same name, ~55 m away
  const far = await api('POST', '/landmarks', { name: name('Markaziy bozor'), kind: 'MARKET', lat: T.lat + 0.02, lng: T.lng });
  assert.equal(far.statusCode, 200, 'the same name far away is a different place');

  const list = (await api('GET', '/landmarks')).json();
  assert.ok(list.kinds.includes('MARKET'));
  assert.equal(list.area.west, 65.14);
  assert.equal(list.landmarks.filter((l: { name: string }) => l.name === name('Markaziy bozor')).length, 2);
});

test('update: rename, move, switch off and on; a half point or a swapped point is refused; deleting leaves an audit', async () => {
  const id = (await api('POST', '/landmarks', { name: name('Masjid'), kind: 'MOSQUE', lat: T.lat + 0.004, lng: T.lng + 0.004 })).json().id as string;

  assert.equal((await api('PUT', `/landmarks/${id}`, { name: name('Jome masjidi'), kind: 'MOSQUE' })).statusCode, 200);
  assert.equal((await db.landmark.findUniqueOrThrow({ where: { id } })).name, name('Jome masjidi'));
  assert.equal((await api('PUT', `/landmarks/${id}`, { lat: T.lat + 0.005 })).statusCode, 400, 'only one coordinate');
  assert.equal((await api('PUT', `/landmarks/${id}`, { lat: T.lng, lng: T.lat })).statusCode, 400, 'swapped');
  assert.equal((await api('PUT', `/landmarks/${id}`, { kind: 'nope' })).statusCode, 400);
  assert.equal((await api('PUT', `/landmarks/${id}`, { lat: T.lat + 0.005, lng: T.lng + 0.005 })).statusCode, 200);
  const moved = await db.landmark.findUniqueOrThrow({ where: { id } });
  assert.equal(moved.lat, T.lat + 0.005);

  // switched off: gone from what customers and the taxi read, still in the administrator's list
  clearLandmarkCache();
  assert.ok((await activeLandmarks()).some(l => l.id === id));
  assert.equal((await api('PUT', `/landmarks/${id}`, { isActive: false })).statusCode, 200);
  assert.ok(!(await activeLandmarks()).some(l => l.id === id), 'the cache is dropped on every change');
  assert.ok((await api('GET', '/landmarks')).json().landmarks.some((l: { id: string; isActive: boolean }) => l.id === id && !l.isActive));
  assert.equal((await api('PUT', `/landmarks/${id}`, { isActive: true })).statusCode, 200);
  assert.ok((await activeLandmarks()).some(l => l.id === id));
  assert.ok((await audits('LANDMARK_UPDATED')) >= 4);

  assert.equal((await api('PUT', '/landmarks/doesnotexist', { isActive: false })).statusCode, 404);
  assert.equal((await api('DELETE', `/landmarks/${id}`)).statusCode, 200);
  assert.equal((await api('DELETE', `/landmarks/${id}`)).statusCode, 404);
  assert.equal(await audits('LANDMARK_DELETED'), 1);
  assert.equal(await db.landmark.count({ where: { id } }), 0);
});

test('the taxi note names the nearest active landmark within 700 m, and nothing otherwise', async () => {
  const id = (await api('POST', '/landmarks', { name: name('Dorixona'), kind: 'PHARMACY', lat: T.lat - 0.01, lng: T.lng - 0.01 })).json().id as string;
  const list = await activeLandmarks();
  const near = landmarkNote(T.lat - 0.0105, T.lng - 0.01, list); // ~55 m
  assert.ok(near && near.startsWith('Mo‘ljal: ') && near.includes(name('Dorixona')), String(near));
  assert.match(near!, /\(~\d+ m\)$/);
  assert.equal(landmarkNote(T.lat - 0.0, T.lng, list.filter(l => l.id === id)), null, 'the only landmark is ~1.5 km away');
  assert.equal(landmarkNote(null, null, list), null, 'an order without a point has no note');
  await api('PUT', `/landmarks/${id}`, { isActive: false });
  assert.equal(landmarkNote(T.lat - 0.0105, T.lng - 0.01, await activeLandmarks()), null, 'a switched-off landmark is never mentioned');
});

test('the database itself refuses a bad row (name length, a point not on Earth)', async () => {
  await assert.rejects(db.landmark.create({ data: { name: 'x', kind: 'OTHER', lat: 40, lng: 65, createdBy: adminId } }), /Landmark_name_len|check constraint/i);
  await assert.rejects(db.landmark.create({ data: { name: name('Yer'), kind: 'OTHER', lat: 95, lng: 65, createdBy: adminId } }), /Landmark_lat_range|check constraint/i);
});

test('the taxi app request shows the landmark under the address (so installed apps need no change)', async () => {
  const lm = { id: 'l1', name: name('Bank'), kind: 'BANK', lat: T.lat, lng: T.lng };
  const at = new Date('2026-11-09T10:00:00Z');
  const row = (lat: number | null, lng: number | null) => ({
    id: 'd1', status: 'REQUESTED', attemptNo: 1, createdAt: at, sentAt: null, expiresAt: at, updatedAt: at, deliveredAt: null,
    order: { code: 'A1', status: 'PREPARING', addressText: 'Ko‘cha 5', deliveryLat: lat, deliveryLng: lng, phoneSnapshot: null, totalSom: 50_000, prepMinutes: null,
      preparingStartedAt: null, readyAt: null, paymentIsTest: false, restaurant: { name: 'R', pickupAddress: null, pickupPhone: null }, payment: { method: 'CARD' } },
  });
  const { toRequestView } = await import('../modules/taxi-app/service.js');
  const withNote = toRequestView(row(T.lat + 0.001, T.lng) as never, [lm]);
  assert.match(withNote.delivery.address, /^Ko‘cha 5\nMo‘ljal: .*Bank.* \(~\d+ m\)$/);
  assert.equal(toRequestView(row(null, null) as never, [lm]).delivery.address, 'Ko‘cha 5', 'no point, no note');
  assert.equal(toRequestView(row(T.lat + 0.1, T.lng) as never, [lm]).delivery.address, 'Ko‘cha 5', 'too far to help');
});
