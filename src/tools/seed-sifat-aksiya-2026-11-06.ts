import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../lib/db.js';

/**
 * Owner request 2026-11-06 (prints the plan unless --apply is given; safe to run twice; a later change by the restaurant is never overwritten):
 *  - the home slide "Lavash 1+1" (old picture) is deleted and the owner's poster "Mahsus takliflar" is added (a slide of the restaurant: a tap opens its menu);
 *  - the old promotion dish "LAVASH O'RTACHA 1+1" is archived (orders keep their snapshot) and taken out of the promotion "Lavash", which is switched OFF:
 *    the new offers are SET dishes with their own price, so the "cheaper of every pair is free" rule must not apply to them;
 *  - a menu group "AKSIYA" (first) with the four sets of the poster, each with its earlier price crossed out (Product.oldPriceSom, display only):
 *      DONAR 3+1 + 1 L COCA-COLA 109 000 (125 000), LAVASH 3+1 + 1 L COLA 109 000 (125 000), 3 TA PITSA + 1 L COLA 129 000 (163 000), LAVASH 1+1 49 000 (60 000).
 *    No photos yet: the owner puts them in later.
 * Run on the server:  docker exec ds-prod-backend-1 node dist/src/tools/seed-sifat-aksiya-2026-11-06.js --apply
 */
const APPLY = process.argv.includes('--apply');
const ACTOR = 'owner-aksiya-20261106';
const BANNER_FILE = resolve(process.cwd(), 'prisma/seed-assets/banner-mahsus-takliflar.jpg');
const BANNER_TITLE = 'Mahsus takliflar';
const GROUP = 'AKSIYA';
const OLD_DISH = "LAVASH O'RTACHA 1+1";
const SETS: Array<{ name: string; description: string; priceSom: number; oldPriceSom: number }> = [
  { name: 'DONAR 3+1 + 1 L COCA-COLA', description: '3+1: 4 ta donar (1 tasi bonus) va 1 litrlik Coca-Cola', priceSom: 109_000, oldPriceSom: 125_000 },
  { name: 'LAVASH 3+1 + 1 L COLA', description: '3+1: 4 ta lavash (1 tasi bonus) va 1 litrlik Cola', priceSom: 109_000, oldPriceSom: 125_000 },
  { name: '3 TA PITSA + 1 L COLA', description: '3 ta pitsa va 1 litrlik Cola', priceSom: 129_000, oldPriceSom: 163_000 },
  { name: 'LAVASH 1+1', description: '1+1: 2 ta lavash', priceSom: 49_000, oldPriceSom: 60_000 },
];
const log = (msg: string): void => console.log(`${APPLY ? '[APPLY]' : '[PLAN] '} ${msg}`);

try {
  const r = await db.restaurant.findUnique({ where: { slug: 'sifat-food' }, select: { id: true } });
  if (!r) throw new Error('sifat-food not found');

  // ---- 1. slides
  const promo = await db.promotion.findFirst({ where: { restaurantId: r.id, title: 'Lavash' }, select: { id: true, isActive: true, products: { select: { productId: true } } } });
  const old = await db.banner.findMany({ where: { restaurantId: r.id, title: 'Lavash 1+1' }, select: { id: true } });
  for (const b of old) {
    log(`slide "Lavash 1+1" (${b.id}): delete`);
    if (APPLY) {
      await db.banner.delete({ where: { id: b.id } }); // its picture goes with it (cascade)
      await db.adminAuditEvent.create({ data: { actorId: ACTOR, action: 'BANNER_DELETED', targetType: 'Banner', targetId: b.id, details: { title: 'Lavash 1+1' } } });
    }
  }
  if (await db.banner.findFirst({ where: { restaurantId: r.id, title: BANNER_TITLE }, select: { id: true } })) log(`slide "${BANNER_TITLE}": exists, kept`);
  else {
    const bytes = readFileSync(BANNER_FILE);
    log(`slide "${BANNER_TITLE}": create (${bytes.length} bytes), first, opens the restaurant's menu`);
    if (APPLY) {
      const b = await db.banner.create({ data: { title: BANNER_TITLE, restaurantId: r.id, position: 0 } });
      await db.bannerImage.create({ data: { bannerId: b.id, mime: 'image/jpeg', data: Uint8Array.from(bytes), sha256: createHash('sha256').update(bytes).digest('hex'), version: 1 } });
      await db.adminAuditEvent.create({ data: { actorId: ACTOR, action: 'BANNER_CREATED', targetType: 'Banner', targetId: b.id, details: { title: BANNER_TITLE } } });
    }
  }

  // ---- 2. old promotion dish and the 1+1 promotion
  if (promo && (promo.products.length > 0 || promo.isActive)) {
    log('promotion "Lavash": remove its dishes and switch OFF');
    if (APPLY) {
      await db.$transaction([
        db.promotionProduct.deleteMany({ where: { promotionId: promo.id } }),
        db.promotion.update({ where: { id: promo.id }, data: { isActive: false } }),
        db.adminAuditEvent.create({ data: { actorId: ACTOR, action: 'PROMOTION_OFF', targetType: 'Promotion', targetId: promo.id, details: { reason: 'replaced by set dishes' } } }),
      ]);
    }
  } else log('promotion "Lavash": already empty and OFF');
  const oldDish = await db.product.findFirst({ where: { restaurantId: r.id, name: OLD_DISH, archivedAt: null }, select: { id: true, name: true, priceSom: true } });
  if (!oldDish) log(`${OLD_DISH}: not on the menu (already archived?), skipped`);
  else {
    log(`${OLD_DISH}: archive`);
    if (APPLY) {
      await db.product.update({ where: { id: oldDish.id }, data: { archivedAt: new Date(), isAvailable: false, version: { increment: 1 } } });
      await db.catalogEvent.create({ data: { restaurantId: r.id, entity: 'PRODUCT', entityId: oldDish.id, action: 'PRODUCT_ARCHIVED', actorSessionId: ACTOR, before: { name: oldDish.name, priceSom: oldDish.priceSom }, after: { archived: true } } });
    }
  }

  // ---- 3. the group and the four sets
  let group = await db.category.findFirst({ where: { restaurantId: r.id, name: GROUP }, select: { id: true } });
  if (group) log(`group ${GROUP}: exists, kept`);
  else {
    const min = (await db.category.aggregate({ where: { restaurantId: r.id }, _min: { position: true } }))._min.position ?? 0;
    log(`group ${GROUP}: create, first (position ${min - 1})`);
    if (APPLY) {
      group = await db.category.create({ data: { restaurantId: r.id, name: GROUP, position: min - 1 }, select: { id: true } });
      await db.catalogEvent.create({ data: { restaurantId: r.id, entity: 'CATEGORY', entityId: group.id, action: 'CATEGORY_CREATED', actorSessionId: ACTOR, after: { name: GROUP, position: min - 1 } } });
    }
  }
  for (const [i, s] of SETS.entries()) {
    if (await db.product.findFirst({ where: { restaurantId: r.id, name: s.name, archivedAt: null }, select: { id: true } })) { log(`${s.name}: exists, kept`); continue; }
    log(`${s.name}: create ${s.priceSom} (was ${s.oldPriceSom}), no photo`);
    if (APPLY && group) {
      const p = await db.product.create({ data: { restaurantId: r.id, categoryId: group.id, name: s.name, description: s.description, priceSom: s.priceSom, oldPriceSom: s.oldPriceSom, position: i + 1 } });
      await db.catalogEvent.create({ data: { restaurantId: r.id, entity: 'PRODUCT', entityId: p.id, action: 'PRODUCT_CREATED', actorSessionId: ACTOR, after: { name: p.name, priceSom: p.priceSom, oldPriceSom: s.oldPriceSom } } });
    }
  }
  if (!APPLY) console.log('Nothing written. Add --apply to write.');
} catch (err) {
  console.error('[FAILED]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
