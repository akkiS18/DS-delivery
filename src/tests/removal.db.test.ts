import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createRestaurantByAdmin } from '../modules/restaurant/provision.js';
import { createTaxiCompanyByAdmin } from '../modules/taxi-app/provision.js';
import { planRestaurantRemoval, removeRestaurant, removeTaxiCompany } from '../modules/platform/removal.js';
import { loginTaxi } from '../modules/taxi-app/auth.js';
import { login } from '../modules/restaurant-auth/service.js';
import { customerOrderView, loadCustomerOrder } from '../modules/miniapp/views.js';

// Administrator removal of test restaurants / taxi companies, and the public order code. ds_delivery_test only; no Telegram, no money.
process.env.RESTAURANT_LOGIN_MAX_FAILURES = '50';
process.env.RESTAURANT_LOGIN_IP_MAX_FAILURES = '1000';
const ADMIN = String(randomInt(100000000001, 200000000000));
const RANDO = String(randomInt(980000000001, 999000000000));
process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = ADMIN;
delete process.env.SUPPORT_ADMIN_2_TELEGRAM_ID;
const db = new PrismaClient();
const nonce = randomUUID().slice(0, 8);
const customerTg = String(randomInt(700000000001, 800000000000));
const restaurantIds: string[] = [];
const companyIds: string[] = [];
const logins: string[] = [];
const slugs: string[] = [];
let customerId = '';

const CODE_RE = /^[BCDFGHJKMNPQRSTVWXYZ2-9]{5}$/;

async function restaurant(label: string) {
  const r = await createRestaurantByAdmin({ adminId: ADMIN, name: `RM ${label} ${nonce}`, pickupAddress: 'Test manzil 1' });
  const row = await db.restaurant.findUniqueOrThrow({ where: { slug: r.slug } });
  restaurantIds.push(row.id);
  slugs.push(r.slug);
  return { ...r, id: row.id };
}
const order = (restaurantId: string, status: 'CANCELLED' | 'PAYMENT_PENDING' | 'COMPLETED', taxiCompanyId?: string) =>
  db.order.create({ data: { restaurantId, customerId, addressText: 'Test', totalSom: 10_000, status, createdViaBot: true, ...(taxiCompanyId ? { taxiCompanyId } : {}) } });

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  customerId = (await db.customer.create({ data: { telegramUserId: customerTg } })).id;
});

after(async () => {
  const rids = (await db.restaurant.findMany({ where: { OR: [{ id: { in: restaurantIds } }, { slug: { endsWith: `-${nonce}` } }] }, select: { id: true } })).map(r => r.id);
  await db.taxiDispatch.deleteMany({ where: { order: { restaurantId: { in: rids } } } });
  await db.order.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.customer.deleteMany({ where: { id: customerId } });
  await db.product.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.restaurantSession.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.restaurantCredential.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.restaurant.deleteMany({ where: { id: { in: rids } } });
  await db.taxiCompany.deleteMany({ where: { id: { in: companyIds } } });
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('ds.ledger_cleanup', 'on', true)`;
    await tx.adminAuditEvent.deleteMany({ where: { actorId: ADMIN } });
  });
  await db.$disconnect();
});

test('only administrators can remove anything', async () => {
  const r = await restaurant('perm');
  await assert.rejects(removeRestaurant({ adminId: RANDO, restaurantId: r.id }), /ADMIN_RUXSAT_YOQ/);
  await assert.rejects(planRestaurantRemoval(RANDO, r.id), /ADMIN_RUXSAT_YOQ/);
  assert.equal(await db.restaurant.count({ where: { id: r.id } }), 1);
});

test('a restaurant that never had an order is deleted for good, with its menu and cards', async () => {
  const r = await restaurant('empty');
  const cat = await db.category.create({ data: { restaurantId: r.id, name: 'Taomlar' } });
  await db.product.create({ data: { restaurantId: r.id, categoryId: cat.id, name: 'Osh', priceSom: 30_000 } });
  const plan = await planRestaurantRemoval(ADMIN, r.id);
  assert.equal(plan.result, 'DELETE');
  const out = await removeRestaurant({ adminId: ADMIN, restaurantId: r.id });
  assert.equal(out.result, 'DELETED');
  assert.equal(await db.restaurant.count({ where: { id: r.id } }), 0);
  assert.equal(await db.product.count({ where: { restaurantId: r.id } }), 0);
  assert.equal(await db.adminAuditEvent.count({ where: { actorId: ADMIN, action: 'RESTAURANT_DELETED', targetId: r.id } }), 1);
  assert.deepEqual((await removeRestaurant({ adminId: ADMIN, restaurantId: r.id })).result, 'NOT_FOUND', 'a repeat is harmless');
});

test('a restaurant with finished orders is archived: hidden, signed out, name freed, history kept', async () => {
  const r = await restaurant('hist');
  await order(r.id, 'COMPLETED');
  const ip = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`;
  const signedIn = await login({ slug: r.slug, password: r.password, ip });
  assert.equal(signedIn.result, 'OK');
  assert.equal((await planRestaurantRemoval(ADMIN, r.id)).result, 'ARCHIVE');
  const out = await removeRestaurant({ adminId: ADMIN, restaurantId: r.id });
  assert.equal(out.result, 'ARCHIVED');
  const row = await db.restaurant.findUniqueOrThrow({ where: { id: r.id } });
  assert.equal(row.isActive, false);
  assert.equal(row.isPaused, true);
  assert.ok(row.slug.startsWith('arxiv-'));
  assert.equal(await db.order.count({ where: { restaurantId: r.id } }), 1, 'orders are never deleted');
  assert.equal(await db.restaurantCredential.count({ where: { restaurantId: r.id } }), 0);
  assert.equal(await db.restaurantSession.count({ where: { restaurantId: r.id, revokedAt: null } }), 0);
  assert.equal((await login({ slug: r.slug, password: r.password, ip })).result, 'INVALID');
  // the same name can be created again
  const again = await createRestaurantByAdmin({ adminId: ADMIN, name: `RM hist ${nonce}`, pickupAddress: 'Boshqa manzil' });
  assert.equal(again.slug, r.slug);
  restaurantIds.push((await db.restaurant.findUniqueOrThrow({ where: { slug: again.slug } })).id);
});

test('an unfinished order blocks the removal and nothing changes', async () => {
  const r = await restaurant('open');
  await order(r.id, 'PAYMENT_PENDING');
  const plan = await planRestaurantRemoval(ADMIN, r.id);
  assert.deepEqual([plan.result, plan.result === 'BLOCKED' ? plan.reason : null], ['BLOCKED', 'OPEN_ORDERS']);
  assert.equal((await removeRestaurant({ adminId: ADMIN, restaurantId: r.id })).result, 'BLOCKED');
  const row = await db.restaurant.findUniqueOrThrow({ where: { id: r.id } });
  assert.deepEqual([row.isActive, row.slug], [true, r.slug]);
});

test('taxi company: deleted when unused, archived when it has deliveries, blocked while a request is open', async () => {
  const fresh = await createTaxiCompanyByAdmin({ adminId: ADMIN, name: `RM taxi new ${nonce}` });
  const freshRow = await db.taxiCompany.findUniqueOrThrow({ where: { name: fresh.name } });
  companyIds.push(freshRow.id);
  assert.equal((await removeTaxiCompany({ adminId: ADMIN, companyId: freshRow.id })).result, 'DELETED');
  assert.equal(await db.taxiCompany.count({ where: { id: freshRow.id } }), 0);
  assert.equal(await db.taxiCredential.count({ where: { taxiCompanyId: freshRow.id } }), 0);

  const used = await createTaxiCompanyByAdmin({ adminId: ADMIN, name: `RM taxi used ${nonce}` });
  logins.push(used.login);
  const usedRow = await db.taxiCompany.findUniqueOrThrow({ where: { name: used.name } });
  companyIds.push(usedRow.id);
  await db.taxiCompany.update({ where: { id: usedRow.id }, data: { operatorTelegramUserId: String(randomInt(900000000001, 990000000000)) } });
  const r = await restaurant('taxi');
  const o = await order(r.id, 'COMPLETED', usedRow.id);
  const d = await db.taxiDispatch.create({ data: { orderId: o.id, taxiCompanyId: usedRow.id, attemptNo: 1, status: 'REQUESTED', dueAt: new Date() } });
  const blocked = await removeTaxiCompany({ adminId: ADMIN, companyId: usedRow.id });
  assert.deepEqual([blocked.result, blocked.result === 'BLOCKED' ? blocked.reason : null], ['BLOCKED', 'OPEN_DISPATCHES']);
  await db.taxiDispatch.update({ where: { id: d.id }, data: { status: 'DELIVERED' } });

  const ip = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`;
  assert.equal((await loginTaxi({ login: used.login, password: used.password, ip })).result, 'OK');
  assert.equal((await removeTaxiCompany({ adminId: ADMIN, companyId: usedRow.id })).result, 'ARCHIVED');
  const row = await db.taxiCompany.findUniqueOrThrow({ where: { id: usedRow.id } });
  assert.deepEqual([row.isActive, row.operatorTelegramUserId], [false, null]);
  assert.ok(row.name.includes('[arxiv'));
  assert.equal(await db.taxiDispatch.count({ where: { taxiCompanyId: usedRow.id } }), 1, 'delivery history is kept');
  assert.equal((await loginTaxi({ login: used.login, password: used.password, ip })).result, 'INVALID');
  await createTaxiCompanyByAdmin({ adminId: ADMIN, name: used.name }).then(x => {
    logins.push(x.login);
  });
  companyIds.push((await db.taxiCompany.findUniqueOrThrow({ where: { name: used.name } })).id);
});

test('public order code: short, letters+digits without vowels, unique, and the customer view never shows the sequence number', async () => {
  const r = await restaurant('code');
  const made = await Promise.all(Array.from({ length: 40 }, () => order(r.id, 'CANCELLED')));
  const codes = made.map(o => o.code);
  assert.ok(codes.every(c => CODE_RE.test(c)), codes.join(','));
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(codes.some(c => /\d/.test(c)) || codes.length > 0);
  const full = await loadCustomerOrder({ customerId }, made[0]!.id);
  assert.ok(full);
  const view = customerOrderView(full) as unknown as Record<string, unknown>;
  assert.equal(view.code, made[0]!.code);
  assert.ok(!('number' in view), 'the sequence number is not part of the customer view');
});
