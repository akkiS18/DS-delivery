import { db } from '../lib/db.js';

/**
 * Owner request 2026-11-02: Sifat Food category (toifa) pictures were left on the old stock photos. Each category now takes the picture of a dish
 * inside it (the dish named like the category, else the first dish in menu order that has a photo). Prints the plan unless --apply is given.
 *  - A category whose picture the restaurant itself set later (a CATEGORY_IMAGE_SET by a restaurant session) is never overwritten.
 *  - A category with no dish photo keeps what it has (listed, so the owner can decide).
 *  - Runs once per category: a second run changes nothing.
 * Run on the server:  docker exec ds-prod-backend-1 node dist/src/tools/fix-sifat-category-photos-2026-11-02.js [--apply]
 */
const APPLY = process.argv.includes('--apply');
const ACTOR = 'owner-category-photos-20261102';
const IMPORT_ACTOR_PREFIX = 'owner-'; // owner tools write "owner-..."; anything else is a restaurant app session
const log = (msg: string): void => console.log(`${APPLY ? '[APPLY]' : '[PLAN] '} ${msg}`);

try {
  const r = await db.restaurant.findUnique({ where: { slug: 'sifat-food' }, select: { id: true } });
  if (!r) throw new Error('sifat-food not found');
  const categories = await db.category.findMany({
    where: { restaurantId: r.id },
    orderBy: { position: 'asc' },
    select: {
      id: true, name: true, image: { select: { version: true, sha256: true } },
      products: {
        where: { archivedAt: null, image: { isNot: null } },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
        select: { name: true, image: { select: { mime: true, data: true, sha256: true } } },
      },
    },
  });

  for (const c of categories) {
    // A dish named like the category wins (category KFS -> dish KFS, not KARTOSHKA FRI); otherwise the first in menu order.
    const dish = c.products.find(p => p.name.toLowerCase() === c.name.toLowerCase()) ?? c.products[0];
    if (!dish?.image) { log(`${c.name}: no dish with a photo, category picture left as it is${c.image ? '' : ' (it has none)'}`); continue; }
    if (c.image?.sha256 === dish.image.sha256) { log(`${c.name}: already shows ${dish.name}, kept`); continue; }
    const events = await db.catalogEvent.findMany({ where: { restaurantId: r.id, entity: 'CATEGORY', entityId: c.id, action: 'CATEGORY_IMAGE_SET' }, select: { actorSessionId: true } });
    if (events.some(e => e.actorSessionId === ACTOR)) { log(`${c.name}: already fixed by this tool, kept`); continue; }
    if (events.some(e => !e.actorSessionId.startsWith(IMPORT_ACTOR_PREFIX))) { log(`${c.name}: picture was set by the restaurant itself, kept`); continue; }
    log(`${c.name}: picture = photo of "${dish.name}"`);
    if (!APPLY) continue;
    const version = (c.image?.version ?? 0) + 1;
    const img = { mime: dish.image.mime, data: Uint8Array.from(Buffer.from(dish.image.data)) as Uint8Array<ArrayBuffer>, sha256: dish.image.sha256 };
    await db.$transaction([
      db.categoryImage.upsert({ where: { categoryId: c.id }, create: { categoryId: c.id, ...img, version }, update: { ...img, version } }),
      db.catalogEvent.create({ data: { restaurantId: r.id, entity: 'CATEGORY', entityId: c.id, action: 'CATEGORY_IMAGE_SET', actorSessionId: ACTOR, after: { source: `dish ${dish.name}`, version } } }),
    ]);
  }
  if (!APPLY) console.log('Nothing written. Add --apply to write.');
} catch (err) {
  console.error('[FAILED]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
