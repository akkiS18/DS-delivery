import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../lib/db.js';

/**
 * Owner request 2026-11-02 (prints the plan unless --apply is given; every step runs once, a later change by the restaurant is never overwritten):
 *  - Sifat Food dish photos: the owner's pictures for tandir lavash, lavash, donar, xaggi, gamburger (also for dobbl burger), turk kebab and hod dog;
 *    DOBBL CHEZ BURGER gets the same picture as CHEZ BURGER.
 *  - Burger order on the menu: GAMBURGER, DOBBL BURGER, CHEZ BURGER, DOBBL CHEZ BURGER (not alphabetical).
 *  - The promotion "Lavash" (1+1) gets the three ordinary LAVASH dishes (not the tandir ones, not donar) and is switched ON - only while it has no dishes yet.
 * Run on the server:  docker exec ds-prod-backend-1 node dist/src/tools/seed-sifat-photos-2026-11-02.js --apply
 */
const APPLY = process.argv.includes('--apply');
const ACTOR = 'owner-menu-photos-20261102';
const ASSETS = resolve(process.cwd(), 'prisma/seed-assets/sifat');
const log = (msg: string): void => console.log(`${APPLY ? '[APPLY]' : '[PLAN] '} ${msg}`);

/** photo file -> dish names (exact, as on the menu) */
const PHOTOS: Array<{ file: string; names: string[] }> = [
  { file: 'tandir-lavash.jpg', names: ['TANDIR LAVASH KATTA', 'TANDIR LAVASH KICHKINA', 'TANDIR LAVASH O\'RTACHA'] },
  { file: 'lavash.jpg', names: ['LAVASH KATTA', 'LAVASH KICHKINA', 'LAVASH O\'RTACHA'] },
  { file: 'donar.jpg', names: ['DONAR KATTA', 'DONAR KICHKINA', 'DONAR O\'RTACHA'] },
  { file: 'xaggi.jpg', names: ['XAGGI'] },
  { file: 'gamburger.jpg', names: ['GAMBURGER', 'DOBBL BURGER'] },
  { file: 'kebab.jpg', names: ['TURK KEBAB KATTA', 'TURK KEBAB O\'RTACHA'] },
  { file: 'hod-dog.jpg', names: ['HOD DOG KATTA', 'HOD DOG KATTA SUPPER', 'HOD DOG KICHKINA', 'HOD DOG O\'RTACHA'] },
];
const BURGER_ORDER = ['GAMBURGER', 'DOBBL BURGER', 'CHEZ BURGER', 'DOBBL CHEZ BURGER'];
const PROMO_DISHES = ['LAVASH KATTA', 'LAVASH O\'RTACHA', 'LAVASH KICHKINA'];

try {
  const r = await db.restaurant.findUnique({ where: { slug: 'sifat-food' }, select: { id: true } });
  if (!r) throw new Error('sifat-food not found');
  const dishes = await db.product.findMany({ where: { restaurantId: r.id, archivedAt: null }, select: { id: true, name: true, imageUrl: true, image: { select: { version: true, mime: true, data: true, sha256: true } } } });
  const byName = new Map(dishes.map(d => [d.name, d]));
  const done = async (productId: string): Promise<boolean> => (await db.catalogEvent.count({ where: { restaurantId: r.id, entity: 'PRODUCT', entityId: productId, actorSessionId: ACTOR, action: 'PRODUCT_IMAGE_SET' } })) > 0;
  const setImage = async (productId: string, name: string, img: { mime: string; data: Uint8Array<ArrayBuffer>; sha256: string }, source: string) => {
    const version = (byName.get(name)?.image?.version ?? 0) + 1;
    await db.productImage.upsert({ where: { productId }, create: { productId, ...img, version }, update: { ...img, version } });
    await db.catalogEvent.create({ data: { restaurantId: r.id, entity: 'PRODUCT', entityId: productId, action: 'PRODUCT_IMAGE_SET', actorSessionId: ACTOR, after: { source, version } } });
  };

  for (const p of PHOTOS) {
    const bytes = readFileSync(resolve(ASSETS, p.file));
    const img = { mime: 'image/jpeg', data: Uint8Array.from(bytes) as Uint8Array<ArrayBuffer>, sha256: createHash('sha256').update(bytes).digest('hex') };
    for (const name of p.names) {
      const d = byName.get(name);
      if (!d) { log(`${name}: dish not found, skipped`); continue; }
      if (await done(d.id)) { log(`${name}: photo already set by this import, kept`); continue; }
      log(`${name}: photo = ${p.file}`);
      if (APPLY) await setImage(d.id, name, img, p.file);
    }
  }

  // DOBBL CHEZ BURGER looks like CHEZ BURGER (the owner's wording: "same picture").
  const chez = byName.get('CHEZ BURGER');
  const dobblChez = byName.get('DOBBL CHEZ BURGER');
  if (chez && dobblChez) {
    if (await done(dobblChez.id)) log('DOBBL CHEZ BURGER: photo already set by this import, kept');
    else if (chez.image) {
      log('DOBBL CHEZ BURGER: photo = the same as CHEZ BURGER');
      if (APPLY) await setImage(dobblChez.id, 'DOBBL CHEZ BURGER', { mime: chez.image.mime, data: Uint8Array.from(Buffer.from(chez.image.data)) as Uint8Array<ArrayBuffer>, sha256: chez.image.sha256 }, 'copy of CHEZ BURGER');
    } else if (chez.imageUrl) {
      log('DOBBL CHEZ BURGER: photo link = the same as CHEZ BURGER');
      if (APPLY) {
        await db.product.update({ where: { id: dobblChez.id }, data: { imageUrl: chez.imageUrl } });
        await db.catalogEvent.create({ data: { restaurantId: r.id, entity: 'PRODUCT', entityId: dobblChez.id, action: 'PRODUCT_IMAGE_SET', actorSessionId: ACTOR, after: { source: 'imageUrl of CHEZ BURGER' } } });
      }
    } else log('CHEZ BURGER has no photo: DOBBL CHEZ BURGER left as it is');
  }

  BURGER_ORDER.forEach((name, i) => {
    const d = byName.get(name);
    if (!d) { log(`${name}: dish not found, order skipped`); return; }
    log(`${name}: menu position ${i + 1}`);
  });
  if (APPLY) for (const [i, name] of BURGER_ORDER.entries()) { const d = byName.get(name); if (d) await db.product.update({ where: { id: d.id }, data: { position: i + 1 } }); }

  const promo = await db.promotion.findFirst({ where: { restaurantId: r.id, title: 'Lavash' }, select: { id: true, isActive: true, products: { select: { productId: true } } } });
  if (!promo) log('promotion "Lavash" not found: skipped');
  else if (promo.products.length > 0) log('promotion "Lavash" already has dishes: kept as it is');
  else {
    const ids = PROMO_DISHES.map(n => byName.get(n)?.id).filter((x): x is string => !!x);
    log(`promotion "Lavash": dishes = ${PROMO_DISHES.join(', ')}; switched ON`);
    if (APPLY && ids.length === PROMO_DISHES.length) {
      await db.promotionProduct.createMany({ data: ids.map(productId => ({ promotionId: promo.id, productId })) });
      await db.promotion.update({ where: { id: promo.id }, data: { isActive: true } });
      await db.adminAuditEvent.create({ data: { actorId: ACTOR, action: 'PROMOTION_ON', targetType: 'Promotion', targetId: promo.id, details: { dishes: PROMO_DISHES } } });
    } else if (APPLY) log('some lavash dishes are missing: promotion NOT switched on');
  }
  if (!APPLY) console.log('Nothing written. Add --apply to write.');
} catch (err) {
  console.error('[FAILED]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
