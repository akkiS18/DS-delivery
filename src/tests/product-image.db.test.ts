import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { attemptKey, setRestaurantPassword } from '../modules/restaurant-auth/service.js';
import { db as appDb } from '../lib/db.js';

// Dish photos set from the restaurant app: tenant isolation, the file-type and size rules, versioning (a replaced photo gets a new URL), the public
// image URL, the menu the customer sees, and removal. Rows are deleted by id in after().
process.env.RESTAURANT_LOGIN_MAX_FAILURES = '50';
process.env.RESTAURANT_LOGIN_IP_MAX_FAILURES = '1000';
process.env.MINIAPP_ENABLED = 'true';

const db = new PrismaClient();
const app = buildApp(new PaymentEngineV3(db, defaultOptions, () => {}));
const nonce = randomUUID().slice(0, 8);
const slugA = `pimg-a-${nonce}`;
const slugB = `pimg-b-${nonce}`;
const PW_A = `Alpha-${randomUUID()}`;
const PW_B = `Bravo-${randomUUID()}`;
const ids: Record<string, string> = {};
const ips: string[] = [];
let ta = '';
let tb = '';

const ip = () => { const v = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`; ips.push(v); return v; };
async function loginToken(slug: string, password: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/v1/restaurant/auth/login', payload: { slug, password }, remoteAddress: ip() });
  assert.equal(r.statusCode, 200);
  return r.json().accessToken;
}
const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, token: string | undefined, payload?: unknown, contentType?: string) =>
  app.inject({
    method, url: `/api/v1/restaurant${url}`, payload: payload as never,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(contentType ? { 'content-type': contentType } : {}) },
  });
const jpeg = (size = 3000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(size)]);
const mkProduct = async (token: string) => {
  const r = await call('POST', '/products', token, { name: `Dish ${randomUUID().slice(0, 8)}`, priceSom: 10_000 });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};

before(async () => {
  await db.$connect();
  for (const [k, slug] of [['a', slugA], ['b', slugB]] as const) ids[k] = (await db.restaurant.create({ data: { slug, name: `Pimg ${k}` } })).id;
  await setRestaurantPassword({ slug: slugA, password: PW_A });
  await setRestaurantPassword({ slug: slugB, password: PW_B });
  ta = await loginToken(slugA, PW_A);
  tb = await loginToken(slugB, PW_B);
});
after(async () => {
  await db.restaurantLoginAttempt.deleteMany({ where: { keyHash: { in: [slugA, slugB].map(s => attemptKey('slug', s)).concat(ips.map(i => attemptKey('ip', i))) } } });
  await db.product.deleteMany({ where: { restaurantId: { in: Object.values(ids) } } }); // cascades the photos
  await db.restaurant.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await app.close();
  await db.$disconnect();
  await appDb.$disconnect();
});

test('a dish photo needs a restaurant session, and only the owner restaurant can set or remove it', async () => {
  const p = await mkProduct(ta);
  const body = jpeg();
  assert.equal((await call('PUT', `/products/${p.id}/image`, undefined, body, 'image/jpeg')).statusCode, 401);
  assert.equal((await call('PUT', `/products/${p.id}/image`, 'bad-token', body, 'image/jpeg')).statusCode, 401);
  assert.equal((await call('DELETE', `/products/${p.id}/image`, undefined)).statusCode, 401);
  assert.equal((await call('PUT', `/products/${p.id}/image`, tb, body, 'image/jpeg')).statusCode, 404, 'another restaurant sees nothing');
  assert.equal(await db.productImage.count({ where: { productId: p.id } }), 0);
  const ok = await call('PUT', `/products/${p.id}/image`, ta, body, 'image/jpeg');
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().version, 1);
  assert.equal(await db.productImage.count({ where: { productId: p.id } }), 1);
  assert.equal((await call('DELETE', `/products/${p.id}/image`, tb)).statusCode, 204, 'idempotent for a stranger, but...');
  assert.equal(await db.productImage.count({ where: { productId: p.id } }), 1, '...it removes nothing');
});

test('only real images of a sane size are accepted (decided by the file bytes, not the header)', async () => {
  const p = await mkProduct(ta);
  const put = (b: Buffer, type = 'image/jpeg') => call('PUT', `/products/${p.id}/image`, ta, b, type);
  assert.equal((await put(Buffer.from('<html>not an image at all</html>'.padEnd(2000, ' ')))).statusCode, 400, 'text pretending to be a jpeg');
  assert.equal((await put(jpeg(100))).statusCode, 400, 'too small');
  assert.equal((await put(jpeg(4 * 1024 * 1024 + 10))).statusCode, 413, 'too big for the body limit');
  assert.ok([400, 415].includes((await put(Buffer.from('x'.repeat(3000)), 'text/plain')).statusCode), 'wrong content type');
  assert.equal(await db.productImage.count({ where: { productId: p.id } }), 0);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(2000)]);
  assert.equal((await put(png, 'image/png')).statusCode, 200);
  assert.equal((await db.productImage.findUniqueOrThrow({ where: { productId: p.id } })).mime, 'image/png');
});

test('replacing the photo gives a new version and URL; the public URL serves it; the customer menu and the restaurant list point at it', async () => {
  const p = await mkProduct(ta);
  const first = jpeg(); const second = jpeg(4000);
  const v1 = (await call('PUT', `/products/${p.id}/image`, ta, first, 'image/jpeg')).json();
  const v2 = (await call('PUT', `/products/${p.id}/image`, ta, second, 'image/jpeg')).json();
  assert.equal(v2.version, v1.version + 1);
  assert.notEqual(v2.imageUrl, v1.imageUrl);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: p.id } })).version, p.version, 'the dish version (the edit form lock) is untouched');

  const pub = await app.inject({ method: 'GET', url: v2.imageUrl }); // no auth header: an <img> cannot send one
  assert.equal(pub.statusCode, 200);
  assert.equal(pub.headers['content-type'], 'image/jpeg');
  assert.ok(pub.rawPayload.equals(second));
  assert.equal(pub.headers['x-content-type-options'], 'nosniff');
  const etag = String(pub.headers.etag);
  assert.equal((await app.inject({ method: 'GET', url: v2.imageUrl, headers: { 'if-none-match': etag } })).statusCode, 304);

  const list = (await call('GET', '/products', ta)).json().products.find((x: { id: string }) => x.id === p.id);
  assert.equal(list.imageUrl, v2.imageUrl);
  // the customer menu (read through the view function: the HTTP route needs a customer session)
  const { restaurantMenu } = await import('../modules/miniapp/views.js');
  const view = await restaurantMenu(ids.a!);
  assert.equal(view!.products.find(x => x.id === p.id)!.imageUrl, v2.imageUrl);
});

test('removing the photo, archiving the dish and an unknown dish: the public URL stops, deletes are idempotent', async () => {
  const p = await mkProduct(ta);
  const { imageUrl } = (await call('PUT', `/products/${p.id}/image`, ta, jpeg(), 'image/jpeg')).json();
  assert.equal((await app.inject({ method: 'GET', url: imageUrl })).statusCode, 200);
  assert.equal((await call('DELETE', `/products/${p.id}/image`, ta)).statusCode, 204);
  assert.equal((await call('DELETE', `/products/${p.id}/image`, ta)).statusCode, 204, 'again: nothing happens');
  assert.equal((await app.inject({ method: 'GET', url: imageUrl })).statusCode, 404);
  assert.equal(await db.catalogEvent.count({ where: { entityId: p.id, action: 'PRODUCT_IMAGE_REMOVED' } }), 1, 'only the real removal is audited');
  assert.equal((await call('PUT', '/products/nonexistent1/image', ta, jpeg(), 'image/jpeg')).statusCode, 404);

  await call('PUT', `/products/${p.id}/image`, ta, jpeg(), 'image/jpeg');
  assert.equal((await call('DELETE', `/products/${p.id}`, ta)).statusCode, 204); // archive
  assert.equal((await app.inject({ method: 'GET', url: imageUrl })).statusCode, 404, 'an archived dish shows nothing');
  assert.equal((await call('PUT', `/products/${p.id}/image`, ta, jpeg(), 'image/jpeg')).statusCode, 409, 'and cannot get a new photo');
});

test('parallel uploads of the same dish end with one photo and distinct versions', async () => {
  const p = await mkProduct(ta);
  const results = await Promise.all([1, 2, 3, 4].map(() => call('PUT', `/products/${p.id}/image`, ta, jpeg(), 'image/jpeg')));
  assert.ok(results.every(r => r.statusCode === 200), results.map(r => r.statusCode).join());
  assert.deepEqual(results.map(r => r.json().version).sort(), [1, 2, 3, 4]);
  assert.equal(await db.productImage.count({ where: { productId: p.id } }), 1);
});
