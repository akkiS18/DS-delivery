import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { Telegraf } from 'telegraf';
import { buildApp } from '../app.js';
import { hashToken } from '../modules/miniapp/guest.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { db as appDb } from '../lib/db.js';

// The restaurant photo against ds_delivery_test: validation, the admin paths (function and Telegram photo captions, with a fake Bot API),
// and what the customer apps get (imageUrl on the list and the menu, a public cached image route). Rows are deleted by id in after().
const ADMIN = String(randomInt(100000000000, 400000000000));
const BOT_TOKEN = '123456789:AAFakeRestaurantImageTokenLocalOnly_0123456789';
process.env.MINIAPP_ENABLED = 'true';
process.env.ANDROID_GUEST_ENABLED = 'true';
process.env.GUEST_BOOTSTRAP_PER_IP_HOUR = '1000';
process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = ADMIN;
const { setRestaurantImage, validateRestaurantImage } = await import('../modules/restaurant/image.js');
const { createRestaurantByAdmin } = await import('../modules/restaurant/provision.js');
const { registerPlatformAdminHandlers } = await import('../bot/platform-admin.js');

const db = new PrismaClient();
const app = buildApp(new PaymentEngineV3(db, defaultOptions, () => {}));
const nonce = randomUUID().slice(0, 8);
const slugs: string[] = [];
const customerIds = new Set<string>();
let seq = 1;

/** A file that passes the magic-byte check: the PNG signature followed by padding (the server never decodes it). */
const png = (extra = 3000) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(extra, 7)]);
const jpg = (extra = 3000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(extra, 9)]);

async function guest(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/miniapp/guest/session', payload: { installationId: `ri${nonce}-${randomUUID()}` } });
  const token = res.json().token as string;
  const g = await db.guestSession.findFirstOrThrow({ where: { tokenHash: hashToken(token) } });
  customerIds.add(g.customerId);
  return `Bearer ${token}`;
}
async function makeRestaurant(label: string, active = true) {
  const r = await db.restaurant.create({ data: { slug: `ri-${label}-${nonce}`, name: `Rasmli ${label} ${nonce}`, isActive: active } });
  slugs.push(r.slug);
  return r;
}

before(async () => { await db.$connect(); });
after(async () => {
  const rs = await db.restaurant.findMany({ where: { OR: [{ slug: { in: slugs } }, { name: { contains: nonce } }] }, select: { id: true } });
  await db.restaurant.deleteMany({ where: { id: { in: rs.map(r => r.id) } } }); // the photo and the login cascade
  await db.guestSession.deleteMany({ where: { customerId: { in: [...customerIds] } } });
  await db.customer.deleteMany({ where: { id: { in: [...customerIds] } } });
  await app.close();
  await db.$disconnect();
  await appDb.$disconnect();
});

test('only a real JPEG/PNG/WebP of a sensible size is accepted', () => {
  assert.equal(validateRestaurantImage(png()).mime, 'image/png');
  assert.equal(validateRestaurantImage(jpg()).mime, 'image/jpeg');
  assert.throws(() => validateRestaurantImage(Buffer.alloc(5000, 1)), /RASM_NOTOGRI/); // not an image
  assert.throws(() => validateRestaurantImage(png(10)), /RASM_NOTOGRI/); // too small
  assert.throws(() => validateRestaurantImage(png(4 * 1024 * 1024)), /RASM_NOTOGRI/); // too big
  assert.throws(() => validateRestaurantImage('not a buffer'), /RASM_NOTOGRI/);
  assert.throws(() => validateRestaurantImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">' + ' '.repeat(2000)))); // SVG can carry scripts: not accepted
});

test('an admin sets and replaces the photo; the apps get a versioned URL and the image is served publicly and cached', async () => {
  const r = await makeRestaurant('a');
  const auth = await guest();
  const listed = async () => ((await app.inject({ method: 'GET', url: `/api/v1/miniapp/restaurants?q=${nonce}`, headers: { authorization: auth } })).json().restaurants as Array<{ id: string; imageUrl: string | null }>).find(x => x.id === r.id)!;
  assert.equal((await listed()).imageUrl, null);
  const none = await app.inject({ method: 'GET', url: `/api/v1/miniapp/restaurants/${r.id}/image` });
  assert.equal(none.statusCode, 404);

  await assert.rejects(setRestaurantImage({ adminId: '1', slug: r.slug, bytes: png() }), /ADMIN_RUXSAT_YOQ/);
  assert.equal(await setRestaurantImage({ adminId: ADMIN, slug: 'no-such-restaurant', bytes: png() }), null);
  const first = png(3000);
  assert.equal((await setRestaurantImage({ adminId: ADMIN, slug: r.slug, bytes: first }))?.version, 1);
  assert.equal((await listed()).imageUrl, `/api/v1/miniapp/restaurants/${r.id}/image?v=1`);
  const menu = await app.inject({ method: 'GET', url: `/api/v1/miniapp/restaurants/${r.id}/menu`, headers: { authorization: auth } });
  assert.equal(menu.json().restaurant.imageUrl, `/api/v1/miniapp/restaurants/${r.id}/image?v=1`);

  // Public: no Authorization header at all (an <img> cannot send one).
  const img = await app.inject({ method: 'GET', url: `/api/v1/miniapp/restaurants/${r.id}/image?v=1` });
  assert.equal(img.statusCode, 200);
  assert.equal(img.headers['content-type'], 'image/png');
  assert.equal(img.headers['x-content-type-options'], 'nosniff');
  assert.match(String(img.headers['cache-control']), /immutable/);
  assert.ok(img.rawPayload.equals(first));
  const etag = String(img.headers.etag);
  const again = await app.inject({ method: 'GET', url: `/api/v1/miniapp/restaurants/${r.id}/image?v=1`, headers: { 'if-none-match': etag } });
  assert.equal(again.statusCode, 304);

  assert.equal((await setRestaurantImage({ adminId: ADMIN, slug: r.slug, bytes: jpg() }))?.version, 2);
  assert.equal((await listed()).imageUrl, `/api/v1/miniapp/restaurants/${r.id}/image?v=2`);
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/miniapp/restaurants/${r.id}/image?v=2` })).headers['content-type'], 'image/jpeg');
  assert.equal(await db.restaurantImage.count({ where: { restaurantId: r.id } }), 1);
  assert.ok(await db.adminAuditEvent.findFirst({ where: { actorId: ADMIN, action: 'RESTAURANT_IMAGE_SET', targetId: r.id } }));
});

test('a suspended restaurant\'s photo is not served, and the image route is not an oracle for ids', async () => {
  const r = await makeRestaurant('b', false);
  await setRestaurantImage({ adminId: ADMIN, slug: r.slug, bytes: png() });
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/miniapp/restaurants/${r.id}/image` })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/miniapp/restaurants/nope/image' })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/miniapp/restaurants/bad%20id/image' })).statusCode >= 400, true);
});

test('adding a restaurant with a photo: a bad photo creates nothing, a good one is stored with it', async () => {
  const bad = `Yomon rasm ${nonce}`;
  await assert.rejects(createRestaurantByAdmin({ adminId: ADMIN, name: bad, pickupAddress: 'Toshkent, Chilonzor', image: Buffer.alloc(4000, 3) }), /RASM_NOTOGRI/);
  assert.equal(await db.restaurant.count({ where: { name: bad } }), 0);
  const good = await createRestaurantByAdmin({ adminId: ADMIN, name: `Yaxshi rasm ${nonce}`, pickupAddress: 'Toshkent, Chilonzor', image: png() });
  slugs.push(good.slug);
  assert.equal(good.hasImage, true);
  assert.equal(await db.restaurantImage.count({ where: { restaurant: { slug: good.slug } } }), 1);
  const plain = await createRestaurantByAdmin({ adminId: ADMIN, name: `Rasmsiz ${nonce}`, pickupAddress: 'Toshkent, Chilonzor' });
  slugs.push(plain.slug);
  assert.equal(plain.hasImage, false);
});

test('Telegram: a photo with the caption /restaurantphoto <code> or /newrestaurant ... reaches the restaurant; strangers and non-commands are ignored', async () => {
  const files = new Map<string, Buffer>([['photos/ok.png', png(5000)], ['photos/bad.bin', Buffer.alloc(5000, 1)]]);
  const sent: string[] = [];
  const api = createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const url = String(req.url);
      if (url.includes('/file/bot')) {
        const f = files.get(url.split(`/file/bot${BOT_TOKEN}/`)[1] ?? '');
        res.statusCode = f ? 200 : 404;
        res.end(f ?? 'no');
        return;
      }
      res.setHeader('content-type', 'application/json');
      const payload = body ? JSON.parse(body) as Record<string, unknown> : {};
      if (url.endsWith('/getFile')) { res.end(JSON.stringify({ ok: true, result: { file_id: payload.file_id, file_path: String(payload.file_id).startsWith('bad') ? 'photos/bad.bin' : 'photos/ok.png' } })); return; }
      if (url.endsWith('/sendMessage')) sent.push(String(payload.text));
      res.end(JSON.stringify({ ok: true, result: { message_id: seq++, chat: { id: 1 }, date: 0, text: 'ok' } }));
    });
  });
  await new Promise<void>(r => api.listen(0, '127.0.0.1', r));
  const bot = new Telegraf(BOT_TOKEN, { telegram: { apiRoot: `http://127.0.0.1:${(api.address() as AddressInfo).port}` } });
  bot.botInfo = { id: 777000222, is_bot: true, first_name: 'DS', username: 'ds_fake_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false } as typeof bot.botInfo;
  registerPlatformAdminHandlers(bot);
  const photoUpdate = (caption: string, fileId: string, from = ADMIN) => ({
    update_id: seq++,
    message: { message_id: seq++, date: Math.floor(Date.now() / 1000), chat: { id: Number(from), type: 'private', first_name: 'A' }, from: { id: Number(from), is_bot: false, first_name: 'A' },
      caption, photo: [{ file_id: `${fileId}-small`, file_unique_id: 's', width: 90, height: 90, file_size: 2000 }, { file_id: fileId, file_unique_id: 'b', width: 1280, height: 960, file_size: 6000 }] },
  });

  const existing = await makeRestaurant('tg');
  // Not an administrator: nothing happens, not even a reply.
  await bot.handleUpdate(photoUpdate(`/restaurantphoto ${existing.slug}`, 'good', String(randomInt(900000000000, 990000000000))) as never);
  assert.equal(await db.restaurantImage.count({ where: { restaurantId: existing.id } }), 0);
  // A photo without a command caption is none of our business.
  await bot.handleUpdate(photoUpdate('Salom', 'good') as never);
  assert.equal(await db.restaurantImage.count({ where: { restaurantId: existing.id } }), 0);
  // A file that is not an image is refused.
  await bot.handleUpdate(photoUpdate(`/restaurantphoto ${existing.slug}`, 'bad') as never);
  assert.equal(await db.restaurantImage.count({ where: { restaurantId: existing.id } }), 0);
  assert.match(sent.at(-1) ?? '', /yaroqsiz/);
  // The real thing.
  await bot.handleUpdate(photoUpdate(`/restaurantphoto ${existing.slug}`, 'good') as never);
  assert.equal(await db.restaurantImage.count({ where: { restaurantId: existing.id } }), 1);
  assert.match(sent.at(-1) ?? '', /rasmi yangilandi/);
  // A new restaurant with its photo in one message.
  const name = `Telegram rasm ${nonce}`;
  await bot.handleUpdate(photoUpdate(`/newrestaurant ${name} | Toshkent, Yunusobod | +998901234567`, 'good') as never);
  const created = await db.restaurant.findFirstOrThrow({ where: { name }, select: { id: true, slug: true } });
  slugs.push(created.slug);
  assert.equal(await db.restaurantImage.count({ where: { restaurantId: created.id } }), 1);
  assert.match(sent.at(-1) ?? '', /Rasm qo‘yildi/);
  api.close();
});
