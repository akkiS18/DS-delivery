import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { signInitData } from '../modules/miniapp/auth.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { db as appDb } from '../lib/db.js';
import { invalidateSearchIndex } from '../modules/miniapp/search.js';

// Customer search (GET /api/v1/miniapp/search) against a *_test database. Only rows made here are removed again. No Telegram, no money.
const BOT_TOKEN = '123456789:AAFakeMiniAppTokenLocalOnly_0123456789';
process.env.BOT_TOKEN = BOT_TOKEN;
process.env.MINIAPP_ENABLED = 'true';
process.env.MINIAPP_URL = 'https://miniapp.example.test/app/';

const db = new PrismaClient();
const app = buildApp(new PaymentEngineV3(db, defaultOptions, () => {}));
const nonce = randomUUID().replace(/[^a-z]/g, '').slice(0, 6) || 'qzx';
const user = String(randomInt(700000000001, 750000000000));
const ids = { a: '', b: '', off: '' };
const brand = `Zorbaxo${nonce}`; // a word that exists nowhere else in the database
const init = () => signInitData({
  auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
  user: JSON.stringify({ id: Number(user), first_name: 'Test', username: 'tester', language_code: 'uz' }),
}, BOT_TOKEN);
const search = async (q: string) => {
  const res = await app.inject({ method: 'GET', url: `/api/v1/miniapp/search?q=${encodeURIComponent(q)}`, headers: { authorization: `tma ${init()}` } });
  return { res, body: res.json() as { restaurants: Array<{ id: string }>; dishes: Array<{ id: string; name: string; restaurantId: string; isAvailable: boolean }>; pricing: unknown } };
};
const dish = (restaurantId: string, name: string, extra: Record<string, unknown> = {}) => db.product.create({ data: { restaurantId, name, priceSom: 30_000, ...extra } });

before(async () => {
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  ids.a = (await db.restaurant.create({ data: { slug: `se-a-${nonce}`, name: `${brand} Kitchen`, pickupAddress: 'Pickup 1', pickupPhone: '+998900000001' } })).id;
  ids.b = (await db.restaurant.create({ data: { slug: `se-b-${nonce}`, name: `Other ${brand}b`, pickupAddress: 'Pickup 2', pickupPhone: '+998900000002' } })).id;
  ids.off = (await db.restaurant.create({ data: { slug: `se-off-${nonce}`, name: `${brand} Closed Shop`, isActive: false } })).id;
  await dish(ids.a, `${brand}-lavash`);
  await dish(ids.a, 'Lavash katta');
  await dish(ids.a, `Hidden ${brand}-lavash`, { archivedAt: new Date(), isAvailable: false });
  await dish(ids.a, `${brand} paketi`, { isPackaging: true });
  await dish(ids.a, 'Pepsi', { isAvailable: false });
  await dish(ids.b, 'Burger');
  await dish(ids.off, 'Lavash inactive');
  invalidateSearchIndex();
});
after(async () => {
  const rids = Object.values(ids);
  await db.product.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.restaurant.deleteMany({ where: { id: { in: rids } } });
  await app.close();
  await db.$disconnect();
  await appDb.$disconnect();
});

test('search needs a signed-in customer and an empty query answers nothing', async () => {
  const anon = await app.inject({ method: 'GET', url: '/api/v1/miniapp/search?q=lavash' });
  assert.equal(anon.statusCode, 401);
  const { res, body } = await search('   ');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(body, { restaurants: [], dishes: [], pricing: null });
});

test('a restaurant is found by its name or the start of it; inactive restaurants never appear', async () => {
  for (const q of [brand, brand.toLowerCase(), brand.slice(0, 6)]) {
    const { res, body } = await search(q);
    assert.equal(res.statusCode, 200);
    const found = body.restaurants.map(r => r.id);
    assert.ok(found.includes(ids.a), `"${q}" finds the restaurant`);
    assert.ok(!found.includes(ids.off), 'inactive restaurant hidden');
    assert.ok(!body.dishes.some(d => d.restaurantId === ids.off), 'its dishes hidden too');
  }
});

test('a dish is found by its name; archived and packaging items are not offered; unavailable dishes are marked', async () => {
  const { body } = await search(`${brand}-lavash`);
  const names = body.dishes.map(d => d.name);
  assert.ok(names.includes(`${brand}-lavash`));
  assert.ok(!names.some(n => n.startsWith('Hidden')), 'archived dish hidden');
  assert.ok(!names.some(n => n.includes('paketi')), 'packaging hidden');
  assert.ok(body.pricing, 'pricing comes along with dishes');

  const pepsi = (await search('pepsi')).body.dishes.find(d => d.restaurantId === ids.a);
  assert.ok(pepsi && pepsi.isAvailable === false);
});

test('every word must match; a dish is also found through its restaurant name; the exact dish ranks first', async () => {
  const both = (await search(`lavash ${brand}`)).body.dishes.filter(d => d.restaurantId === ids.a).map(d => d.name);
  assert.ok(both.includes('Lavash katta'), 'dish word + restaurant word');
  assert.equal((await search(`lavash ${brand} nothingmatches`)).body.dishes.length, 0);
  const first = (await search(`${brand}-lavash`)).body.dishes[0];
  assert.equal(first?.name, `${brand}-lavash`);
});

test('a switched-off restaurant stops being offered after the index is rebuilt', async () => {
  await db.restaurant.update({ where: { id: ids.b }, data: { isActive: false } });
  invalidateSearchIndex();
  const { body } = await search('burger');
  assert.ok(!body.dishes.some(d => d.restaurantId === ids.b));
  await db.restaurant.update({ where: { id: ids.b }, data: { isActive: true } });
});

test('the query is bounded: long text and many words do not fail', async () => {
  const tooLong = await search('a'.repeat(200));
  assert.equal(tooLong.res.statusCode, 400);
  const manyWords = await search('a b c d e f g h i j k l');
  assert.equal(manyWords.res.statusCode, 200);
});
