import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { hashToken } from '../modules/miniapp/guest.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { db as appDb } from '../lib/db.js';
import { publicRating, rankingScore, ratingConfig } from '../modules/ratings/score.js';

// Restaurant ratings against ds_delivery_test: the rules (delivered orders only, own orders only, 24 h window), the numbers a customer
// sees (hidden until 5 ratings), the ranking switch, and what the restaurant/admin reports show. Rows are deleted by id in after().
const ADMIN = String(randomInt(100000000000, 400000000000));
process.env.MINIAPP_ENABLED = 'true';
process.env.ANDROID_GUEST_ENABLED = 'true';
process.env.GUEST_BOOTSTRAP_PER_IP_HOUR = '1000';
process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = ADMIN;
const { rankingScores, restaurantReport, platformRatingsOverview, setRankingEnabled, rankingEnabled, RANKING_KEY } = await import('../modules/ratings/service.js');

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const app = buildApp(engine);
const nonce = randomUUID().slice(0, 8);
const restaurantIds: string[] = [];
const customerIds = new Set<string>();
let rankingBefore: string | null = null;

const call = (method: 'GET' | 'PUT' | 'POST', url: string, auth: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1/miniapp${url}`, payload: payload as object | undefined, headers: { authorization: auth } });

async function newGuest(): Promise<{ auth: string; id: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/miniapp/guest/session', payload: { installationId: `rt${nonce}-${randomUUID()}` } });
  assert.equal(res.statusCode, 201, res.body);
  const token = res.json().token as string;
  const g = await db.guestSession.findFirstOrThrow({ where: { tokenHash: hashToken(token) } });
  customerIds.add(g.customerId);
  return { auth: `Bearer ${token}`, id: g.customerId };
}
async function newRestaurant(label: string): Promise<string> {
  const r = await db.restaurant.create({ data: { slug: `rt-${label}-${nonce}`, name: `Reyting ${label} ${nonce}` } });
  restaurantIds.push(r.id);
  return r.id;
}
async function order(restaurantId: string, customerId: string, over: Record<string, unknown> = {}): Promise<string> {
  return (await db.order.create({ data: { restaurantId, customerId, addressText: 'test', totalSom: 10_000, createdViaBot: true, status: 'COMPLETED', ...over } })).id;
}

before(async () => {
  await db.$connect();
  rankingBefore = (await db.platformSetting.findUnique({ where: { key: RANKING_KEY } }))?.value ?? null;
});
after(async () => {
  if (rankingBefore === null) await db.platformSetting.deleteMany({ where: { key: RANKING_KEY } });
  else await db.platformSetting.update({ where: { key: RANKING_KEY }, data: { value: rankingBefore } });
  const all = [...customerIds];
  await db.order.deleteMany({ where: { restaurantId: { in: restaurantIds } } }); // cascades ratings
  await db.guestSession.deleteMany({ where: { customerId: { in: all } } });
  await db.customer.deleteMany({ where: { id: { in: all } } });
  await db.restaurant.deleteMany({ where: { id: { in: restaurantIds } } });
  await app.close();
  await db.$disconnect();
  await appDb.$disconnect();
});

test('maths: one lucky 5 does not beat a proven 4.8; recent ratings count more; the public number waits for 5 ratings', () => {
  const cfg = ratingConfig({} as NodeJS.ProcessEnv);
  const now = new Date('2026-10-26T12:00:00Z');
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const lucky = rankingScore([{ stars: 5, createdAt: day(1) }], now, cfg);
  const proven = rankingScore(Array.from({ length: 200 }, (_, i) => ({ stars: i % 5 === 0 ? 4 : 5, createdAt: day(i % 60) })), now, cfg); // mean 4.8
  assert.ok(lucky < 4.6 && lucky > cfg.priorMean, `lucky=${lucky}`);
  assert.ok(proven > 4.7, `proven=${proven}`);
  assert.ok(proven > lucky);
  assert.equal(rankingScore([], now, cfg), cfg.priorMean);
  const recentBad = rankingScore([...Array.from({ length: 20 }, () => ({ stars: 5, createdAt: day(400) })), ...Array.from({ length: 6 }, () => ({ stars: 1, createdAt: day(2) }))], now, cfg);
  const oldBad = rankingScore([...Array.from({ length: 20 }, () => ({ stars: 5, createdAt: day(2) })), ...Array.from({ length: 6 }, () => ({ stars: 1, createdAt: day(400) }))], now, cfg);
  assert.ok(recentBad < oldBad, 'what happened lately matters more');
  assert.equal(publicRating(16, 4, cfg), null);
  assert.deepEqual(publicRating(23, 5, cfg), { avg: 4.6, count: 5 });
  assert.throws(() => ratingConfig({ RATING_PRIOR_MEAN: '9' } as NodeJS.ProcessEnv));
});

test('a delivered order can be rated (and changed) by its own customer; reasons only for 1-3 stars', async () => {
  const rid = await newRestaurant('a');
  const g = await newGuest();
  const oid = await order(rid, g.id);

  const first = await call('PUT', `/orders/${oid}/rating`, g.auth, { stars: 2, reasons: ['COLD', 'COLD', 'PACKAGING'], note: '  Sovib qolgan edi  ' });
  assert.equal(first.statusCode, 200, first.body);
  assert.deepEqual(first.json().order.rating, { stars: 2, reasons: ['COLD', 'PACKAGING'], note: 'Sovib qolgan edi' });
  assert.equal(first.json().order.canRate, true);
  assert.ok(first.json().order.rateUntil);

  const changed = await call('PUT', `/orders/${oid}/rating`, g.auth, { stars: 5, reasons: ['COLD'] });
  assert.equal(changed.statusCode, 200);
  assert.deepEqual(changed.json().order.rating, { stars: 5, reasons: [], note: null }, 'reasons are dropped for a good rating');
  assert.equal(await db.orderRating.count({ where: { orderId: oid } }), 1);

  const list = (await call('GET', '/orders', g.auth)).json().orders as Array<{ id: string; rating: number | null; canRate: boolean }>;
  assert.equal(list.find(o => o.id === oid)?.rating, 5);
  assert.equal(list.find(o => o.id === oid)?.canRate, true);
});

test('refused: not delivered, someone else\'s order, bad input, and after the 24 hour window', async () => {
  const rid = await newRestaurant('b');
  const a = await newGuest();
  const b = await newGuest();
  const cooking = await order(rid, a.id, { status: 'PREPARING' });
  const done = await order(rid, a.id);
  const late = await order(rid, a.id, { customerReceivedAt: new Date(Date.now() - 2 * 86_400_000) });

  const r1 = await call('PUT', `/orders/${cooking}/rating`, a.auth, { stars: 5 });
  assert.equal(r1.statusCode, 409);
  assert.equal(r1.json().error, 'BAHOLASH_MUMKIN_EMAS');
  assert.equal((await call('PUT', `/orders/${done}/rating`, b.auth, { stars: 5 })).statusCode, 404);
  assert.equal((await call('PUT', '/orders/nope/rating', a.auth, { stars: 5 })).statusCode, 404);
  for (const bad of [{ stars: 0 }, { stars: 6 }, { stars: 4.5 }, { stars: '5' }, {}, { stars: 3, reasons: ['NOPE'] }, { stars: 3, note: 'x'.repeat(201) }, { stars: 3, customerId: b.id }]) {
    assert.equal((await call('PUT', `/orders/${done}/rating`, a.auth, bad)).statusCode, 400, JSON.stringify(bad));
  }
  const closed = await call('PUT', `/orders/${late}/rating`, a.auth, { stars: 4 });
  assert.equal(closed.statusCode, 409);
  assert.equal(closed.json().error, 'BAHOLASH_MUDDATI_TUGADI');
  const view = (await call('GET', `/orders/${late}`, a.auth)).json().order;
  assert.equal(view.canRate, false);
  assert.equal(view.rateUntil, null);
  assert.equal(await db.orderRating.count({ where: { orderId: { in: [cooking, done, late] } } }), 0);
});

test('an existing rating stays visible but locked after the window', async () => {
  const rid = await newRestaurant('c');
  const g = await newGuest();
  const oid = await order(rid, g.id, { customerReceivedAt: new Date(Date.now() - 3 * 86_400_000) });
  await db.orderRating.create({ data: { orderId: oid, restaurantId: rid, customerId: g.id, stars: 4 } });
  const view = (await call('GET', `/orders/${oid}`, g.auth)).json().order;
  assert.equal(view.rating.stars, 4);
  assert.equal(view.canRate, false);
  assert.equal((await call('PUT', `/orders/${oid}/rating`, g.auth, { stars: 1 })).statusCode, 409);
  assert.equal((await db.orderRating.findUniqueOrThrow({ where: { orderId: oid } })).stars, 4);
});

test('customers see the average only after 5 ratings; the restaurant report and the admin overview have the details', async () => {
  const rid = await newRestaurant('d');
  const name = `Reyting d ${nonce}`;
  const g = await newGuest();
  const listed = async () => ((await call('GET', `/restaurants?q=${encodeURIComponent(name)}`, g.auth)).json().restaurants as Array<{ id: string; rating: { avg: number; count: number } | null; imageUrl: string | null }>).find(r => r.id === rid)!;
  const stars = [5, 4, 4, 3, 5];
  for (let i = 0; i < stars.length; i++) {
    const oid = await order(rid, g.id);
    assert.equal((await call('PUT', `/orders/${oid}/rating`, g.auth, { stars: stars[i], ...(stars[i]! <= 3 ? { reasons: ['TASTELESS'], note: 'Mazasiz chiqdi' } : {}) })).statusCode, 200);
    if (i < 4) assert.equal((await listed()).rating, null, `after ${i + 1} ratings`);
  }
  assert.deepEqual((await listed()).rating, { avg: 4.2, count: 5 });
  assert.equal((await listed()).imageUrl, null);
  const menu = (await call('GET', `/restaurants/${rid}/menu`, g.auth)).json();
  assert.deepEqual(menu.restaurant.rating, { avg: 4.2, count: 5 });

  const report = await restaurantReport(rid);
  assert.equal(report.count, 5);
  assert.equal(report.avg, 4.2);
  assert.deepEqual(report.stars, { 1: 0, 2: 0, 3: 1, 4: 2, 5: 2 });
  assert.equal(report.reasons.TASTELESS, 1);
  assert.deepEqual(report.recent.map(r => [r.stars, r.note]), [[3, 'Mazasiz chiqdi']]);
  assert.equal(JSON.stringify(report).includes(g.id), false, 'no customer identity in the restaurant report');

  const overview = await platformRatingsOverview({ adminId: ADMIN });
  assert.equal(overview.restaurants.find(r => r.slug === `rt-d-${nonce}`)?.count, 5);
  await assert.rejects(platformRatingsOverview({ adminId: '1' }));
});

test('ranking is off by default (alphabetical); switched on, the better-rated restaurant comes first; only an admin can switch it', async () => {
  const worse = await newRestaurant('e1'); // alphabetically first
  const better = await newRestaurant('e2');
  const g = await newGuest();
  for (const [rid, star] of [[worse, 2], [better, 5]] as const) {
    for (let i = 0; i < 6; i++) {
      const oid = await order(rid, g.id);
      await db.orderRating.create({ data: { orderId: oid, restaurantId: rid, customerId: g.id, stars: star } });
    }
  }
  const order_ = async () => ((await call('GET', `/restaurants?q=${encodeURIComponent(`Reyting e`)}`, g.auth)).json().restaurants as Array<{ id: string; name: string }>).filter(r => r.name.endsWith(nonce)).map(r => r.id);
  await db.platformSetting.deleteMany({ where: { key: RANKING_KEY } });
  assert.equal(await rankingEnabled(), false);
  assert.deepEqual(await order_(), [worse, better]);
  await assert.rejects(setRankingEnabled({ adminId: '1', enabled: true }));
  assert.equal(await setRankingEnabled({ adminId: ADMIN, enabled: true }), 'CHANGED');
  assert.equal(await setRankingEnabled({ adminId: ADMIN, enabled: true }), 'UNCHANGED');
  assert.deepEqual(await order_(), [better, worse]);
  const scores = await rankingScores([worse, better]);
  assert.ok(scores.get(better)! > scores.get(worse)!);
  await setRankingEnabled({ adminId: ADMIN, enabled: false });
  assert.deepEqual(await order_(), [worse, better]);
});

test('concurrent identical ratings leave exactly one row', async () => {
  const rid = await newRestaurant('f');
  const g = await newGuest();
  const oid = await order(rid, g.id);
  const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => call('PUT', `/orders/${oid}/rating`, g.auth, { stars: (i % 5) + 1 })));
  assert.ok(rs.every(r => r.statusCode === 200), rs.map(r => r.statusCode).join());
  assert.equal(await db.orderRating.count({ where: { orderId: oid } }), 1);
});
