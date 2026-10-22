import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { attemptKey, setRestaurantPassword } from '../modules/restaurant-auth/service.js';
import { DEFAULT_WORKING_DAYS } from '../modules/restaurant-operations/service.js';
import { placeOrder } from '../modules/orders/service.js';
import { db as appDb } from '../lib/db.js';

process.env.RESTAURANT_LOGIN_MAX_FAILURES = '50';
process.env.RESTAURANT_LOGIN_IP_MAX_FAILURES = '1000';

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const app = buildApp(engine);
const nonce = randomUUID().slice(0, 8);
const slugA = `ops-a-${nonce}`;
const slugB = `ops-b-${nonce}`;
const PW_A = `Alpha-${randomUUID()}`;
const PW_B = `Bravo-${randomUUID()}`;
const customerTg = String(randomInt(700000000001, 900000000000));
const ids: Record<string, string> = {};
const ips: string[] = [];
let taxiId = '';
let productId = '';
let ta = '';
let tb = '';

const ip = () => { const v = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`; ips.push(v); return v; };
async function loginToken(slug: string, password: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/v1/restaurant/auth/login', payload: { slug, password }, remoteAddress: ip() });
  assert.equal(r.statusCode, 200);
  return r.json().accessToken;
}
const call = (method: 'GET' | 'PUT' | 'PATCH', url: string, token: string | undefined, payload?: unknown) =>
  app.inject({ method, url: `/api/v1/restaurant${url}`, payload: payload as object | undefined, headers: token ? { authorization: `Bearer ${token}` } : {} });
const place = () => placeOrder(engine, {
  restaurantId: ids.a!, telegramUserId: customerTg, customerName: 'Test', phone: '+998901234567', addressText: 'Test manzil',
  taxiCompanyId: taxiId, checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'REAL',
  items: [{ productId, quantity: 1 }],
}).then(o => o!);

before(async () => {
  await db.$connect();
  for (const [k, slug] of [['a', slugA], ['b', slugB]] as const) ids[k] = (await db.restaurant.create({ data: { slug, name: `Ops ${k}`, pickupAddress: 'Test pickup' } })).id; // REAL checkout (Stage 6F) needs a dispatchable restaurant
  await setRestaurantPassword({ slug: slugA, password: PW_A });
  await setRestaurantPassword({ slug: slugB, password: PW_B });
  taxiId = (await db.taxiCompany.create({ data: { name: `Taxi ${randomUUID()}`, operatorTelegramUserId: String(randomInt(900000000001, 990000000000)), isActive: true } })).id;
  productId = (await db.product.create({ data: { restaurantId: ids.a!, name: 'Burger', priceSom: 21_000 } })).id;
  ta = await loginToken(slugA, PW_A);
  tb = await loginToken(slugB, PW_B);
});
after(async () => {
  await db.restaurantLoginAttempt.deleteMany({ where: { keyHash: { in: [slugA, slugB].map(s => attemptKey('slug', s)).concat(ips.map(i => attemptKey('ip', i))) } } });
  await db.order.deleteMany({ where: { restaurantId: { in: Object.values(ids) } } });
  await db.customer.deleteMany({ where: { telegramUserId: customerTg } });
  await db.product.deleteMany({ where: { restaurantId: { in: Object.values(ids) } } });
  await db.restaurant.deleteMany({ where: { id: { in: Object.values(ids) } } }); // cascades sessions and credentials
  await db.taxiCompany.deleteMany({ where: { id: taxiId } });
  await app.close();
  await db.$disconnect();
  await appDb.$disconnect();
});

test('every operations route requires a valid session', async () => {
  for (const [m, u, p] of [['GET', '/operations'], ['PATCH', '/operations/status', { isPaused: true }],
    ['PUT', '/operations/working-hours', { days: DEFAULT_WORKING_DAYS }], ['PATCH', '/operations/prep-time', { defaultPrepMinutes: 20 }]] as const) {
    assert.equal((await call(m, u, undefined, p)).statusCode, 401, `${m} ${u}`);
    assert.equal((await call(m, u, 'bad-token', p)).statusCode, 401, `${m} ${u}`);
  }
  assert.equal((await db.restaurant.findUniqueOrThrow({ where: { id: ids.a! } })).isPaused, false);
});

test('a new restaurant reads the defaults', async () => {
  const r = await call('GET', '/operations', ta);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { isPaused: false, defaultPrepMinutes: 25, timezone: 'Asia/Tashkent', workingDays: DEFAULT_WORKING_DAYS });
});

test('pause/resume is an idempotent set, persisted, and isolated per tenant', async () => {
  for (let i = 0; i < 2; i++) {
    const r = await call('PATCH', '/operations/status', ta, { isPaused: true });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().isPaused, true);
  }
  assert.equal((await db.restaurant.findUniqueOrThrow({ where: { id: ids.a! } })).isPaused, true);
  assert.equal((await call('GET', '/operations', tb)).json().isPaused, false);
  assert.equal((await db.restaurant.findUniqueOrThrow({ where: { id: ids.b! } })).isPaused, false);
  assert.equal((await call('PATCH', '/operations/status', ta, { isPaused: false })).json().isPaused, false);
});

test('bad bodies are 400 and the restaurant id can never come from the body', async () => {
  for (const body of [{}, { isPaused: 'yes' }, { isPaused: true, restaurantId: ids.b }]) {
    assert.equal((await call('PATCH', '/operations/status', ta, body)).statusCode, 400, JSON.stringify(body));
  }
  assert.equal((await call('PATCH', '/operations/prep-time', ta, { defaultPrepMinutes: 3 })).statusCode, 400);
  assert.equal((await db.restaurant.findUniqueOrThrow({ where: { id: ids.b! } })).isPaused, false);
});

test('working hours and prep time persist across sessions and do not leak to another tenant', async () => {
  const days = DEFAULT_WORKING_DAYS.map(d => (d.dayOfWeek === 7 ? { ...d, isOpen: false } : d.dayOfWeek === 1 ? { ...d, openTime: '08:30', closeTime: '21:15' } : d));
  const put = await call('PUT', '/operations/working-hours', ta, { days: days.slice().reverse() }); // order-insensitive input
  assert.equal(put.statusCode, 200, put.body);
  assert.equal((await call('PATCH', '/operations/prep-time', ta, { defaultPrepMinutes: 40 })).statusCode, 200);
  const fresh = await loginToken(slugA, PW_A);
  assert.deepEqual((await call('GET', '/operations', fresh)).json(), { isPaused: false, defaultPrepMinutes: 40, timezone: 'Asia/Tashkent', workingDays: days });
  assert.deepEqual((await call('GET', '/operations', tb)).json().workingDays, DEFAULT_WORKING_DAYS);
  const bad = await call('PUT', '/operations/working-hours', ta, { days: days.map(d => (d.dayOfWeek === 2 ? { ...d, openTime: '22:00', closeTime: '09:00' } : d)) });
  assert.equal(bad.statusCode, 400);
  assert.deepEqual((await call('GET', '/operations', ta)).json().workingDays, days); // a rejected write changed nothing
});

test('pausing refuses new orders, leaves existing orders alone, and resuming accepts orders again', async () => {
  // an earlier test configured weekly hours for this restaurant; since Stage 7A new checkouts honour them, so test the pause rule without them
  await db.restaurant.update({ where: { id: ids.a! }, data: { workingHours: Prisma.DbNull } });
  const first = await place();
  await call('PATCH', '/operations/status', ta, { isPaused: true });
  await assert.rejects(place(), /RESTORAN_BUYURTMA_QABUL_QILMAYDI/);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: first.id } })).status, first.status);
  assert.equal(await db.order.count({ where: { restaurantId: ids.a! } }), 1);
  await call('PATCH', '/operations/status', ta, { isPaused: false });
  await place();
  assert.equal(await db.order.count({ where: { restaurantId: ids.a! } }), 2);
});
