import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../lib/db.js';
import { sniffImage } from '../modules/refunds/receipts.js';

/**
 * Owner request 2026-11-09 (prints the plan unless --apply is given; safe to run twice):
 *  - every slide of Sifat Food on the home carousel (today "Mahsus takliflar") is deleted, with its picture;
 *  - the owner's four new posters (WebP, 1024x572) become the slides, in this order: Lavash 1+1, Lavash 3+1 + cola, Donar 3+1 + cola, 3 ta pitsa + cola.
 *  A slide of the restaurant that is not a promotion opens that restaurant's menu on its "AKSIYA" group (publicBanners in src/modules/promotions/service.ts),
 *  so nothing else has to change. Slides of OTHER restaurants are left alone (the plan lists them).
 * Run on the server:  docker exec ds-prod-backend-1 node dist/src/tools/seed-sifat-slides-2026-11-09.js --apply
 */
const APPLY = process.argv.includes('--apply');
const ACTOR = 'owner-slides-20261109';
const DIR = resolve(process.cwd(), 'prisma/seed-assets/sifat');
const SLIDES = [
  { title: 'Lavash 1+1', file: 'banner-lavash-1plus1.webp' },
  { title: 'Lavash 3+1 + 1 L Cola', file: 'banner-lavash-3plus1.webp' },
  { title: 'Donar 3+1 + 1 L Coca-Cola', file: 'banner-donar-3plus1.webp' },
  { title: '3 ta pitsa + 1 L Cola', file: 'banner-pitsa-cola.webp' },
];
const log = (msg: string): void => console.log(`${APPLY ? '[APPLY]' : '[PLAN] '} ${msg}`);

try {
  const r = await db.restaurant.findUnique({ where: { slug: 'sifat-food' }, select: { id: true } });
  if (!r) throw new Error('sifat-food not found');

  // Read and check every picture before anything is written.
  const files = SLIDES.map(s => {
    const bytes = readFileSync(resolve(DIR, s.file));
    if (sniffImage(bytes) !== 'image/webp' || bytes.length < 1024 || bytes.length > 1024 * 1024) throw new Error(`bad picture: ${s.file}`);
    return { ...s, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
  });

  const all = await db.banner.findMany({
    select: { id: true, title: true, isActive: true, position: true, restaurantId: true, promotion: { select: { restaurantId: true } }, image: { select: { sha256: true } } },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });
  const sifat = all.filter(b => (b.promotion?.restaurantId ?? b.restaurantId) === r.id);
  for (const b of all.filter(b => !sifat.includes(b))) log(`slide "${b.title}" (${b.id}) belongs to another restaurant or none: kept`);

  // A slide that is already one of the four (same title and same picture) is kept, so a second run changes nothing.
  const keep = new Set<string>();
  for (const f of files) {
    const same = sifat.find(b => b.title === f.title && b.image?.sha256 === f.sha256 && b.isActive && !keep.has(b.id));
    if (same) keep.add(same.id);
  }
  for (const b of sifat.filter(b => !keep.has(b.id))) {
    log(`slide "${b.title}" (${b.id}): delete`);
    if (APPLY) {
      await db.banner.delete({ where: { id: b.id } }); // the picture goes with it (cascade)
      await db.adminAuditEvent.create({ data: { actorId: ACTOR, action: 'BANNER_DELETED', targetType: 'Banner', targetId: b.id, details: { title: b.title } } });
    }
  }
  for (const [i, f] of files.entries()) {
    const existing = sifat.find(b => keep.has(b.id) && b.title === f.title && b.image?.sha256 === f.sha256);
    if (existing) {
      log(`slide "${f.title}": already there, kept (position ${i})`);
      if (APPLY && existing.position !== i) await db.banner.update({ where: { id: existing.id }, data: { position: i } });
      continue;
    }
    log(`slide "${f.title}": create position ${i} (${f.bytes.length} bytes), a tap opens the Sifat Food AKSIYA group`);
    if (APPLY) {
      const b = await db.banner.create({ data: { title: f.title, restaurantId: r.id, position: i } });
      await db.bannerImage.create({ data: { bannerId: b.id, mime: 'image/webp', data: Uint8Array.from(f.bytes), sha256: f.sha256, version: 1 } });
      await db.adminAuditEvent.create({ data: { actorId: ACTOR, action: 'BANNER_CREATED', targetType: 'Banner', targetId: b.id, details: { title: f.title } } });
    }
  }
  const group = await db.category.findFirst({ where: { restaurantId: r.id, name: { in: ['AKSIYA', 'AKSIYALAR'], mode: 'insensitive' }, products: { some: { archivedAt: null } } }, select: { id: true } });
  log(group ? 'AKSIYA group exists with dishes: a tap opens it' : 'WARNING: no AKSIYA group with dishes: a tap would open the menu from the top');
  if (!APPLY) console.log('Nothing written. Add --apply to write.');
} catch (err) {
  console.error('[FAILED]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
