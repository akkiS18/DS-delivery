import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { attemptKey, setRestaurantPassword } from '../modules/restaurant-auth/service.js';
import { db as appDb } from '../lib/db.js';

process.env.RESTAURANT_LOGIN_MAX_FAILURES = '50';
process.env.RESTAURANT_LOGIN_IP_MAX_FAILURES = '1000';

// GET /api/v1/restaurant/ratings: a restaurant sees its own numbers and reasons, never another restaurant's, and no customer identity.
const db = new PrismaClient();
const app = buildApp(new PaymentEngineV3(db, defaultOptions, () => {}));
const nonce = randomUUID().slice(0, 8);
const slugA = `rr-a-${nonce}`;
const slugB = `rr-b-${nonce}`;
const PW_A = `Alpha-${randomUUID()}`;
const PW_B = `Bravo-${randomUUID()}`;
const ids: Record<string, string> = {};
const ips: string[] = [];
let customerId = '';
let ta = '';
let tb = '';

const ip = () => { const v = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`; ips.push(v); return v; };
async function loginToken(slug: string, password: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/v1/restaurant/auth/login', payload: { slug, password }, remoteAddress: ip() });
  assert.equal(r.statusCode, 200);
  return r.json().accessToken;
}
const get = (token?: string) => app.inject({ method: 'GET', url: '/api/v1/restaurant/ratings', headers: token ? { authorization: `Bearer ${token}` } : {} });
async function rate(restaurantId: string, stars: number, reasons: string[] = [], note: string | null = null) {
  const order = await db.order.create({ data: { restaurantId, customerId, addressText: 'x', totalSom: 10_000, createdViaBot: true, status: 'COMPLETED' } });
  await db.orderRating.create({ data: { orderId: order.id, restaurantId, customerId, stars, reasons, note } });
}

before(async () => {
  await db.$connect();
  for (const [k, slug] of [['a', slugA], ['b', slugB]] as const) ids[k] = (await db.restaurant.create({ data: { slug, name: `RR ${k}` } })).id;
  await setRestaurantPassword({ slug: slugA, password: PW_A });
  await setRestaurantPassword({ slug: slugB, password: PW_B });
  ta = await loginToken(slugA, PW_A);
  tb = await loginToken(slugB, PW_B);
  customerId = (await db.customer.create({ data: { telegramUserId: String(randomInt(900000000001, 990000000000)) } })).id;
});
after(async () => {
  const rids = Object.values(ids);
  await db.order.deleteMany({ where: { restaurantId: { in: rids } } }); // cascades ratings
  await db.customer.deleteMany({ where: { id: customerId } });
  await db.restaurantLoginAttempt.deleteMany({ where: { keyHash: { in: [slugA, slugB].map(s => attemptKey('slug', s)).concat(ips.map(i => attemptKey('ip', i))) } } });
  await db.restaurant.deleteMany({ where: { id: { in: rids } } });
  await app.close();
  await db.$disconnect();
  await appDb.$disconnect();
});

test('no session is a 401, and a client-sent restaurant id changes nothing', async () => {
  assert.equal((await get()).statusCode, 401);
  const r = await app.inject({ method: 'GET', url: `/api/v1/restaurant/ratings?restaurantId=${ids.b}`, headers: { authorization: `Bearer ${ta}` } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().count, 0);
});

test('a restaurant sees only its own ratings, reasons and notes, with no customer identity', async () => {
  await rate(ids.a!, 5);
  await rate(ids.a!, 2, ['COLD', 'TASTELESS'], 'sovuq keldi');
  await rate(ids.b!, 1, ['WRONG_ITEM'], 'boshqa restoran izohi');

  const a = await get(ta);
  assert.equal(a.statusCode, 200);
  assert.equal(a.headers['cache-control'], 'no-store');
  const body = a.json();
  assert.equal(body.count, 2);
  assert.equal(body.avg, 3.5);
  assert.equal(body.stars['5'], 1);
  assert.equal(body.stars['2'], 1);
  assert.equal(body.reasons.COLD, 1);
  assert.equal(body.reasons.WRONG_ITEM, 0);
  assert.deepEqual(body.recent.map((x: { note: string | null }) => x.note), ['sovuq keldi']);
  assert.equal(body.reasonLabels.COLD, 'Sovuq edi');
  const text = JSON.stringify(body);
  assert.ok(!text.includes('boshqa restoran izohi'));
  assert.ok(!text.includes(customerId));
  assert.ok(!text.includes('telegramUserId') && !text.includes('customerId'));

  const b = (await get(tb)).json();
  assert.equal(b.count, 1);
  assert.equal(b.avg, 1);
  assert.deepEqual(b.recent.map((x: { note: string | null }) => x.note), ['boshqa restoran izohi']);
});
