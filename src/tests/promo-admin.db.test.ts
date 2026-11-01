import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { restaurantMenu } from '../modules/miniapp/views.js';
import { adminPromoOverview, createBanner, createPromotion, deleteBanner, deletePromotion, readBannerImageForAdmin, setBannerImageByAdmin, updateBanner, updatePromotion } from '../modules/promotions/admin.js';

// The DS Admin app's promotion and slide management, and the menu order (position). ds_delivery_test only.
const ADMIN = String(randomInt(100000000001, 200000000000));
const db = new PrismaClient();
const nonce = randomUUID().slice(0, 8);
let rid = '';
let otherRid = '';
const D: Record<'a' | 'b' | 'c' | 'd' | 'foreign', string> = { a: '', b: '', c: '', d: '', foreign: '' };
let savedAdmin: string | undefined;
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(1500, 7)]);

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  savedAdmin = process.env.SUPPORT_ADMIN_1_TELEGRAM_ID;
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = ADMIN;
  rid = (await db.restaurant.create({ data: { slug: `pa-${nonce}`, name: `PA ${nonce}` } })).id;
  otherRid = (await db.restaurant.create({ data: { slug: `pb-${nonce}`, name: `PB ${nonce}` } })).id;
  const mk = async (key: keyof typeof D, restaurantId: string, name: string, position = 0) => { D[key] = (await db.product.create({ data: { restaurantId, name, priceSom: 10_000, position } })).id; };
  await mk('a', rid, 'GAMBURGER', 1);
  await mk('b', rid, 'DOBBL BURGER', 2);
  await mk('c', rid, 'CHEZ BURGER', 3);
  await mk('d', rid, 'DOBBL CHEZ BURGER', 4);
  await mk('foreign', otherRid, 'Boshqa');
});

after(async () => {
  if (savedAdmin === undefined) delete process.env.SUPPORT_ADMIN_1_TELEGRAM_ID; else process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = savedAdmin;
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('ds.ledger_cleanup', 'on', true)`;
    await tx.adminAuditEvent.deleteMany({ where: { actorId: ADMIN } });
  });
  await db.banner.deleteMany({ where: { OR: [{ restaurantId: { in: [rid, otherRid] } }, { promotion: { restaurantId: { in: [rid, otherRid] } } }] } });
  await db.promotion.deleteMany({ where: { restaurantId: { in: [rid, otherRid] } } });
  await db.product.deleteMany({ where: { restaurantId: { in: [rid, otherRid] } } });
  await db.restaurant.deleteMany({ where: { id: { in: [rid, otherRid] } } });
  await db.$disconnect();
});

test('menu order: position first, then the name (the owner\'s burger order, not alphabetical)', async () => {
  const menu = await restaurantMenu(rid);
  assert.deepEqual(menu!.products.map(p => p.name), ['GAMBURGER', 'DOBBL BURGER', 'CHEZ BURGER', 'DOBBL CHEZ BURGER']);
});

test('only an administrator may use the tools', async () => {
  await assert.rejects(() => adminPromoOverview('123'), /ADMIN_RUXSAT_YOQ/);
  await assert.rejects(() => createPromotion('123', { restaurantId: rid, title: 'Lavash' }), /ADMIN_RUXSAT_YOQ/);
});

let promoId = '';
test('promotion: created OFF, dishes must be the restaurant\'s own, ON needs a dish, the cap is validated', async () => {
  promoId = (await createPromotion(ADMIN, { restaurantId: rid, title: '  Lavash  ' })).id;
  await assert.rejects(() => createPromotion(ADMIN, { restaurantId: rid, title: 'x' }), /NOM_NOTOGRI/);
  await assert.rejects(() => updatePromotion(ADMIN, promoId, { isActive: true }), /AKSIYADA_TAOM_YOQ/);
  await assert.rejects(() => updatePromotion(ADMIN, promoId, { productIds: [D.foreign] }), /TAOM_TOPILMADI/);
  await assert.rejects(() => updatePromotion(ADMIN, promoId, { maxFreePerOrder: 0 }), /SON_NOTOGRI/);
  await updatePromotion(ADMIN, promoId, { productIds: [D.a, D.b], isActive: true, maxFreePerOrder: 4 });
  const o = await adminPromoOverview(ADMIN);
  const p = o.promotions.find(x => x.id === promoId)!;
  assert.equal(p.title, 'Lavash');
  assert.equal(p.isActive, true);
  assert.equal(p.maxFreePerOrder, 4);
  assert.deepEqual([...p.productIds].sort(), [D.a, D.b].sort());
  assert.deepEqual(p.dishes.map(d => d.name).sort(), ['CHEZ BURGER', 'DOBBL BURGER', 'DOBBL CHEZ BURGER', 'GAMBURGER']);
  await updatePromotion(ADMIN, promoId, { maxFreePerOrder: null });
  assert.equal((await adminPromoOverview(ADMIN)).promotions.find(x => x.id === promoId)!.maxFreePerOrder, null);
});

test('slide: starts OFF, cannot be switched on without a picture, goes live with promotion + picture, hides when the promotion goes off', async () => {
  const { id } = await createBanner(ADMIN, { title: 'Lavash 1+1', promotionId: promoId });
  const row = () => adminPromoOverview(ADMIN).then(o => o.banners.find(b => b.id === id)!);
  assert.equal((await row()).isActive, false);
  assert.equal((await row()).restaurantId, rid, 'a slide of a promotion opens that promotion\'s restaurant');
  await assert.rejects(() => updateBanner(ADMIN, id, { isActive: true }), /SLAYDDA_RASM_YOQ/);
  await assert.rejects(() => setBannerImageByAdmin(ADMIN, id, Buffer.from('not a picture'.repeat(200))), /RASM_NOTOGRI/);
  await setBannerImageByAdmin(ADMIN, id, png);
  assert.equal((await readBannerImageForAdmin(ADMIN, id))!.data.length, png.length);
  await updateBanner(ADMIN, id, { isActive: true });
  assert.equal((await row()).live, true);
  await updatePromotion(ADMIN, promoId, { isActive: false });
  assert.equal((await row()).live, false);
  await updatePromotion(ADMIN, promoId, { isActive: true });
  await updateBanner(ADMIN, id, { endsAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await row()).live, false, 'past its end date');
  await assert.rejects(() => updateBanner(ADMIN, id, { endsAt: 'tomorrow-ish' }), /SANA_NOTOGRI/);
  await updateBanner(ADMIN, id, { endsAt: null });
  assert.equal((await row()).live, true);
  await deletePromotion(ADMIN, promoId);
  const after = await row();
  assert.equal(after.isActive, false, 'a slide whose promotion was deleted is switched off');
  assert.equal(after.promotionId, null);
  await deleteBanner(ADMIN, id);
  assert.equal((await adminPromoOverview(ADMIN)).banners.some(b => b.id === id), false);
});
