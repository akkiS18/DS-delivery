import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { attemptKey, authenticate, login, setRestaurantPassword } from '../modules/restaurant-auth/service.js';
import { listRestaurantsForAdmin, setRestaurantActive } from '../modules/restaurant/admin.js';
import { renderRestaurants } from '../bot/restaurant-admin.js';

// Stage 8C: administrator suspend/resume of a restaurant. ds_delivery_test only.
process.env.RESTAURANT_LOGIN_MAX_FAILURES = '50';
process.env.RESTAURANT_LOGIN_IP_MAX_FAILURES = '1000';
const ADMIN = String(randomInt(100000000001, 200000000000));
const db = new PrismaClient();
const nonce = randomUUID().slice(0, 8);
const slug = `ra2-${nonce}`;
const PW = `Alpha-${randomUUID()}`;
const ips: string[] = [];
let restaurantId = '';
let saved: string | undefined;
const ip = () => { const v = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`; ips.push(v); return v; };

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  saved = process.env.SUPPORT_ADMIN_1_TELEGRAM_ID;
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = ADMIN;
  restaurantId = (await db.restaurant.create({ data: { slug, name: `RA2 ${nonce}`, pickupAddress: 'P' } })).id;
  await setRestaurantPassword({ slug, password: PW });
});

after(async () => {
  if (saved === undefined) delete process.env.SUPPORT_ADMIN_1_TELEGRAM_ID; else process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = saved;
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('ds.ledger_cleanup', 'on', true)`;
    await tx.adminAuditEvent.deleteMany({ where: { targetType: 'Restaurant', targetId: restaurantId } });
  });
  await db.restaurantLoginAttempt.deleteMany({ where: { keyHash: { in: [attemptKey('slug', slug)].concat(ips.map(i => attemptKey('ip', i))) } } });
  await db.restaurant.deleteMany({ where: { id: restaurantId } });
  await db.$disconnect();
});

test('suspending signs every session out, blocks login, is audited, and resuming restores access', async () => {
  const first = await login({ slug, password: PW, ip: ip() });
  assert.equal(first.result, 'OK');
  const token = (first as { token: string }).token;
  assert.equal((await authenticate(token)).ok, true);

  await assert.rejects(setRestaurantActive({ restaurantId, active: false, adminId: '999' }), /ADMIN_RUXSAT_YOQ/);
  assert.equal((await db.restaurant.findUniqueOrThrow({ where: { id: restaurantId } })).isActive, true, 'a non-admin changed nothing');

  assert.deepEqual(await setRestaurantActive({ restaurantId, active: false, adminId: ADMIN }), { result: 'CHANGED', signedOut: 1 });
  assert.equal((await authenticate(token)).ok, false, 'the open app session is gone');
  assert.equal((await login({ slug, password: PW, ip: ip() })).result, 'INACTIVE');
  assert.deepEqual(await setRestaurantActive({ restaurantId, active: false, adminId: ADMIN }), { result: 'UNCHANGED' });
  assert.deepEqual(await setRestaurantActive({ restaurantId: 'nope', active: false, adminId: ADMIN }), { result: 'NOT_FOUND' });

  const row = (await listRestaurantsForAdmin()).find(r => r.id === restaurantId)!;
  assert.equal(row.isActive, false);
  assert.equal(row.hasPassword, true);
  assert.equal(row.staffLinked, false);
  assert.match(renderRestaurants([row]).text, /to‘xtatilgan/);

  assert.deepEqual(await setRestaurantActive({ restaurantId, active: true, adminId: ADMIN }), { result: 'CHANGED', signedOut: 0 });
  assert.equal((await login({ slug, password: PW, ip: ip() })).result, 'OK');

  const audit = await db.adminAuditEvent.findMany({ where: { targetType: 'Restaurant', targetId: restaurantId }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(audit.map(a => a.action), ['RESTAURANT_SUSPENDED', 'RESTAURANT_RESUMED']);
  assert.ok(audit.every(a => a.actorId === ADMIN));
  await assert.rejects(db.adminAuditEvent.update({ where: { id: audit[0]!.id }, data: { actorId: 'x' } }), /LEDGER_APPEND_ONLY/);
  await assert.rejects(db.adminAuditEvent.delete({ where: { id: audit[0]!.id } }), /LEDGER_APPEND_ONLY/);
});
