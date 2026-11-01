import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../lib/db.js';

/**
 * Owner request 2026-11-01 (idempotent; prints the plan unless --apply is given):
 *  - Bobosher Osh and Xusniddin osh: a dish "Osh" (35 000 / 30 000) with its own packaging product "Soboy idishi" (5 000 / 3 000, hidden from the menu,
 *    one added per dish unit). Bobosher's restaurant photo is the logo the owner made. Existing rows are never overwritten: a price the restaurant
 *    changed in its app stays.
 *  - Sifat Food: the promotion "Lavash" (1+1) and its home slide, both OFF until the owner names the dishes and switches them on (/aksiya).
 * Run on the server:  docker exec ds-prod-backend-1 node dist/src/tools/seed-osh-lavash-2026-11.js --apply
 */
const APPLY = process.argv.includes('--apply');
const ACTOR = 'owner-menu-import-20261101';
const ASSETS = resolve(process.cwd(), 'prisma/seed-assets');
const asset = (name: string): Buffer => readFileSync(resolve(ASSETS, name));
const log = (msg: string): void => console.log(`${APPLY ? '[APPLY]' : '[PLAN] '} ${msg}`);

const OSH_MENUS = [
  { slug: 'bobosher-osh', oshSom: 35_000, boxSom: 5000, logo: 'bobosher-osh-logo.jpg' },
  { slug: 'xusniddin-osh', oshSom: 30_000, boxSom: 3000, logo: null },
] as const;

async function image(data: Buffer) { return { mime: 'image/jpeg', data: Uint8Array.from(data), sha256: createHash('sha256').update(data).digest('hex') }; }

async function seedOsh(m: (typeof OSH_MENUS)[number]): Promise<void> {
  const r = await db.restaurant.findUnique({ where: { slug: m.slug }, select: { id: true, name: true, image: { select: { version: true, sha256: true } } } });
  if (!r) { log(`${m.slug}: restaurant not found, skipped`); return; }
  const find = (name: string) => db.product.findFirst({ where: { restaurantId: r.id, name, archivedAt: null }, select: { id: true, packagingProductId: true, isPackaging: true, image: { select: { version: true } } } });

  let box = await find('Soboy idishi');
  if (box) log(`${r.name}: "Soboy idishi" exists, kept`);
  else {
    log(`${r.name}: create "Soboy idishi" ${m.boxSom} (packaging)`);
    if (APPLY) {
      const p = await db.product.create({ data: { restaurantId: r.id, name: 'Soboy idishi', priceSom: m.boxSom, isPackaging: true, description: null } });
      await db.catalogEvent.create({ data: { restaurantId: r.id, entity: 'PRODUCT', entityId: p.id, action: 'PRODUCT_CREATED', actorSessionId: ACTOR, after: { name: p.name, priceSom: p.priceSom, isPackaging: true } } });
      box = { id: p.id, packagingProductId: null, isPackaging: true, image: null };
    }
  }
  let osh = await find('Osh');
  if (osh) log(`${r.name}: "Osh" exists, kept`);
  else {
    log(`${r.name}: create "Osh" ${m.oshSom} with its packaging`);
    if (APPLY) {
      const p = await db.product.create({ data: { restaurantId: r.id, name: 'Osh', priceSom: m.oshSom, packagingProductId: box!.id } });
      await db.catalogEvent.create({ data: { restaurantId: r.id, entity: 'PRODUCT', entityId: p.id, action: 'PRODUCT_CREATED', actorSessionId: ACTOR, after: { name: p.name, priceSom: p.priceSom, packagingProductId: box!.id } } });
      osh = { id: p.id, packagingProductId: box!.id, isPackaging: false, image: null };
    }
  }
  if (osh && !osh.packagingProductId && box) {
    log(`${r.name}: link "Osh" to its packaging`);
    if (APPLY) await db.product.update({ where: { id: osh.id }, data: { packagingProductId: box.id } });
  }
  if (osh && !osh.image) {
    log(`${r.name}: set the dish photo of "Osh"`);
    if (APPLY) {
      const img = await image(asset('osh.jpg'));
      await db.productImage.upsert({ where: { productId: osh.id }, create: { productId: osh.id, ...img, version: 1 }, update: { ...img, version: 1 } });
      await db.catalogEvent.create({ data: { restaurantId: r.id, entity: 'PRODUCT', entityId: osh.id, action: 'PRODUCT_IMAGE_SET', actorSessionId: ACTOR, after: { source: 'wikimedia commons Bukharianoshpalov.jpg (public domain), cropped' } } });
    }
  }
  const logoImg = m.logo ? await image(asset(m.logo)) : null;
  if (m.logo && logoImg && r.image?.sha256 === logoImg.sha256) log(`${r.name}: restaurant photo already set, kept`);
  else if (m.logo && logoImg) {
    log(`${r.name}: restaurant photo = ${m.logo}${r.image ? ` (replaces version ${r.image.version})` : ''}`);
    if (APPLY) {
      const img = logoImg;
      const version = (r.image?.version ?? 0) + 1;
      await db.restaurantImage.upsert({ where: { restaurantId: r.id }, create: { restaurantId: r.id, ...img, version }, update: { ...img, version } });
      await db.adminAuditEvent.create({ data: { actorId: ACTOR, action: 'RESTAURANT_IMAGE_SET', targetType: 'Restaurant', targetId: r.id, details: { bytes: img.data.length, version } } });
    }
  }
}

async function seedSifat(): Promise<void> {
  const r = await db.restaurant.findUnique({ where: { slug: 'sifat-food' }, select: { id: true, name: true } });
  if (!r) { log('sifat-food: restaurant not found, skipped'); return; }
  let promo = await db.promotion.findFirst({ where: { restaurantId: r.id, title: 'Lavash' }, select: { id: true } });
  if (promo) log('Sifat: promotion "Lavash" exists, kept');
  else {
    log('Sifat: create promotion "Lavash" 1+1 (OFF, no dishes yet)');
    if (APPLY) promo = await db.promotion.create({ data: { restaurantId: r.id, title: 'Lavash', isActive: false }, select: { id: true } });
  }
  const banner = promo ? await db.banner.findFirst({ where: { promotionId: promo.id }, select: { id: true } }) : null;
  if (banner) { log('Sifat: slide exists, kept'); return; }
  log('Sifat: create the slide "Lavash 1+1" (shows only while the promotion is on)');
  if (APPLY && promo) {
    const b = await db.banner.create({ data: { title: 'Lavash 1+1', restaurantId: r.id, promotionId: promo.id, position: 0 } });
    const img = await image(asset('banner-lavash-1plus1.jpg'));
    await db.bannerImage.create({ data: { bannerId: b.id, ...img, version: 1 } });
  }
}

try {
  for (const m of OSH_MENUS) await seedOsh(m);
  await seedSifat();
  if (!APPLY) console.log('Nothing written. Add --apply to write.');
} catch (err) {
  console.error('[FAILED]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
