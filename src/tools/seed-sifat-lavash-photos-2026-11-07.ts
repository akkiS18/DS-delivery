import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../lib/db.js';

/**
 * Owner request 2026-11-07: two new Sifat Food pictures (files "lavash-oddiy" and "lavash-tandir", 1024 px WebP in prisma/seed-assets/sifat).
 *  - Every dish of the menu group LAVASH gets "lavash-oddiy"; every dish of the group TANDIR LAVASH gets "lavash-tandir".
 *    The AKSIYA sets (their own poster tiles) are in another group and are not touched.
 *  - The two groups themselves (their category pictures) show the same pictures.
 *  - A picture the restaurant itself set later (an event by a restaurant session, i.e. an actor not starting with "owner-") is never overwritten.
 *  - Safe to run twice: a dish / group that already shows the picture is kept. Prints the plan unless --apply is given.
 * Run on the server:  docker exec ds-prod-backend-1 node dist/src/tools/seed-sifat-lavash-photos-2026-11-07.js [--apply]
 */
const APPLY = process.argv.includes('--apply');
const ACTOR = 'owner-lavash-photos-20261107';
const OWNER_PREFIX = 'owner-';
const DIR = resolve(process.cwd(), 'prisma/seed-assets/sifat');
const log = (msg: string): void => console.log(`${APPLY ? '[APPLY]' : '[PLAN] '} ${msg}`);

const GROUPS = [
  { category: 'LAVASH', file: 'lavash-oddiy.webp' },
  { category: 'TANDIR LAVASH', file: 'lavash-tandir.webp' },
] as const;

try {
  const r = await db.restaurant.findUnique({ where: { slug: 'sifat-food' }, select: { id: true } });
  if (!r) throw new Error('sifat-food not found');
  for (const g of GROUPS) {
    const bytes = readFileSync(resolve(DIR, g.file));
    const img = { mime: 'image/webp', data: Uint8Array.from(bytes) as Uint8Array<ArrayBuffer>, sha256: createHash('sha256').update(bytes).digest('hex') };
    const cat = await db.category.findFirst({
      where: { restaurantId: r.id, name: g.category },
      select: { id: true, image: { select: { version: true, sha256: true } }, products: { where: { archivedAt: null }, orderBy: [{ position: 'asc' }, { name: 'asc' }], select: { id: true, name: true, image: { select: { version: true, sha256: true } } } } },
    });
    if (!cat) { log(`group ${g.category}: not found, skipped`); continue; }
    const staffSet = async (entity: 'PRODUCT' | 'CATEGORY', entityId: string): Promise<boolean> => {
      const events = await db.catalogEvent.findMany({ where: { restaurantId: r.id, entity, entityId, action: entity === 'PRODUCT' ? 'PRODUCT_IMAGE_SET' : 'CATEGORY_IMAGE_SET' }, select: { actorSessionId: true } });
      return events.some(e => !e.actorSessionId.startsWith(OWNER_PREFIX));
    };

    for (const p of cat.products) {
      if (p.image?.sha256 === img.sha256) { log(`${p.name}: already has ${g.file}, kept`); continue; }
      if (await staffSet('PRODUCT', p.id)) { log(`${p.name}: the restaurant set its own picture, kept`); continue; }
      log(`${p.name}: picture = ${g.file}`);
      if (!APPLY) continue;
      const version = (p.image?.version ?? 0) + 1;
      await db.$transaction([
        db.productImage.upsert({ where: { productId: p.id }, create: { productId: p.id, ...img, version }, update: { ...img, version } }),
        db.catalogEvent.create({ data: { restaurantId: r.id, entity: 'PRODUCT', entityId: p.id, action: 'PRODUCT_IMAGE_SET', actorSessionId: ACTOR, after: { source: g.file, version } } }),
      ]);
    }

    if (cat.image?.sha256 === img.sha256) log(`group ${g.category}: already shows ${g.file}, kept`);
    else if (await staffSet('CATEGORY', cat.id)) log(`group ${g.category}: the restaurant set its own picture, kept`);
    else {
      log(`group ${g.category}: category picture = ${g.file}`);
      if (APPLY) {
        const version = (cat.image?.version ?? 0) + 1;
        await db.$transaction([
          db.categoryImage.upsert({ where: { categoryId: cat.id }, create: { categoryId: cat.id, ...img, version }, update: { ...img, version } }),
          db.catalogEvent.create({ data: { restaurantId: r.id, entity: 'CATEGORY', entityId: cat.id, action: 'CATEGORY_IMAGE_SET', actorSessionId: ACTOR, after: { source: g.file, version } } }),
        ]);
      }
    }
  }
  if (!APPLY) console.log('Nothing written. Add --apply to write.');
} catch (err) {
  console.error('[FAILED]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
