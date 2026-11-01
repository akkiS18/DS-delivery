import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../lib/db.js';

/**
 * Owner request 2026-11-02 (prints the plan unless --apply is given; every step runs once, a later change by the restaurant is never overwritten):
 *  - Sifat Food dish photos: the owner's pictures for tandir lavash, lavash, donar, xaggi, gamburger (also for dobbl burger), turk kebab and hod dog;
 *    DOBBL CHEZ BURGER gets the same picture as CHEZ BURGER.
 *  - Burger order on the menu: GAMBURGER, DOBBL BURGER, CHEZ BURGER, DOBBL CHEZ BURGER (not alphabetical).
 *  - The 1+1 promotion is its OWN dish "LAVASH O'RTACHA 1+1" (owner, 2026-11-02: the promo lavash and the ordinary o'rtacha lavash are different dishes).
 *    It is created as a copy of LAVASH O'RTACHA (same price, category, description, lavash photo); the ordinary lavash dishes stay out of the promotion.
 *    The promotion "Lavash" gets only that dish and is switched ON - only while it has no dishes yet.
 * Run on the server:  docker exec ds-prod-backend-1 node dist/src/tools/seed-sifat-photos-2026-11-02.js --apply
 */
const APPLY = process.argv.includes('--apply');
const ACTOR = 'owner-menu-photos-20261102';
const ASSETS = resolve(process.cwd(), 'prisma/seed-assets/sifat');
const log = (msg: string): void => console.log(`${APPLY ? '[APPLY]' : '[PLAN] '} ${msg}`);

const PROMO_DISH = "LAVASH O'RTACHA 1+1";
const PROMO_BASE = "LAVASH O'RTACHA";

/** photo file -> dish names (exact, as on the menu) */
const PHOTOS: Array<{ file: string; names: string[] }> = [
  { file: 'tandir-lavash.jpg', names: ['TANDIR LAVASH KATTA', 'TANDIR LAVASH KICHKINA', 'TANDIR LAVASH O\'RTACHA'] },
  { file: 'lavash.jpg', names: ['LAVASH KATTA', 'LAVASH KICHKINA', PROMO_BASE, PROMO_DISH] },
  { file: 'donar.jpg', names: ['DONAR KATTA', 'DONAR KICHKINA', 'DONAR O\'RTACHA'] },
  { file: 'xaggi.jpg', names: ['XAGGI'] },
  { file: 'gamburger.jpg', names: ['GAMBURGER', 'DOBBL BURGER'] },
  { file: 'kebab.jpg', names: ['TURK KEBAB KATTA', 'TURK KEBAB O\'RTACHA'] },
  { file: 'hod-dog.jpg', names: ['HOD DOG KATTA', 'HOD DOG KATTA SUPPER', 'HOD DOG KICHKINA', 'HOD DOG O\'RTACHA'] },
];
const BURGER_ORDER = ['GAMBURGER', 'DOBBL BURGER', 'CHEZ BURGER', 'DOBBL CHEZ BURGER'];

try {
  const r = await db.restaurant.findUnique({ where: { slug: 'sifat-food' }, select: { id: true } });
  if (!r) throw new Error('sifat-food not found');
  const dishes = await db.product.findMany({ where: { restaurantId: r.id, archivedAt: null }, select: { id: true, name: true, imageUrl: true, image: { select: { version: true, mime: true, data: true, sha256: true } } } });
  const byName = new Map(dishes.map(d => [d.name, d]));

  // The promotion's own dish (a copy of the ordinary o'rtacha lavash, created once; its price is then the restaurant's to change).
  if (byName.has(PROMO_DISH)) log(`${PROMO_DISH}: exists, kept`);
  else {
    const base = await db.product.findFirst({ where: { restaurantId: r.id, name: PROMO_BASE, archivedAt: null }, select: { priceSom: true, categoryId: true, description: true } });
    if (!base) log(`${PROMO_BASE} not found: the promotion dish cannot be created`);
    else {
      log(`${PROMO_DISH}: create, ${base.priceSom} so'm, same category as ${PROMO_BASE}`);
      if (APPLY) {
        const p = await db.product.create({ data: { restaurantId: r.id, name: PROMO_DISH, priceSom: base.priceSom, categoryId: base.categoryId, description: base.description } });
        await db.catalogEvent.create({ data: { restaurantId: r.id, entity: 'PRODUCT', entityId: p.id, action: 'PRODUCT_CREATED', actorSessionId: ACTOR, after: { name: p.name, priceSom: p.priceSom } } });
        byName.set(PROMO_DISH, { id: p.id, name: p.name, imageUrl: null, image: null });
      }
    }
  }
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
    log(`promotion "Lavash": dish = ${PROMO_DISH}; switched ON`);
    const id = byName.get(PROMO_DISH)?.id;
    if (APPLY && id) {
      await db.promotionProduct.create({ data: { promotionId: promo.id, productId: id } });
      await db.promotion.update({ where: { id: promo.id }, data: { isActive: true } });
      await db.adminAuditEvent.create({ data: { actorId: ACTOR, action: 'PROMOTION_ON', targetType: 'Promotion', targetId: promo.id, details: { dishes: [PROMO_DISH] } } });
    } else if (APPLY) log('the promotion dish is missing: promotion NOT switched on');
  }
  if (!APPLY) console.log('Nothing written. Add --apply to write.');
} catch (err) {
  console.error('[FAILED]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
