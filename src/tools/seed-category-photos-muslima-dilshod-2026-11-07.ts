import { db } from '../lib/db.js';

/**
 * Owner request 2026-11-07: category (toifa) pictures for "Muslima kafe" (slug muslima) and "Dilshod Fayz" (slug dilshod-fayz). Each category takes the picture of
 * a typical dish inside it (named below; if that dish has no picture, the first dish with one in menu order). Run AFTER the dish photo tools. Prints the plan unless --apply is given.
 *  - A category whose picture the restaurant itself set (a CATEGORY_IMAGE_SET by a restaurant session, actor not starting with "owner-") is never overwritten.
 *  - A category with no dish photo keeps what it has. Safe to run twice: a category that already shows the picture is kept.
 * Run on the server:  docker exec ds-prod-backend-1 node dist/src/tools/seed-category-photos-muslima-dilshod-2026-11-07.js [--apply]
 */
const APPLY = process.argv.includes('--apply');
const ACTOR = 'owner-category-photos-20261107';
const OWNER_PREFIX = 'owner-';
const log = (msg: string): void => console.log(`${APPLY ? '[APPLY]' : '[PLAN] '} ${msg}`);

/** restaurant slug -> category name -> the dish whose picture represents it */
const PICK: Record<string, Record<string, string>> = {
  muslima: {
    '1-ovqatlar': 'Lag‘mon uyg‘ur (1 porsiya)',
    '2-ovqatlar': 'Qozon kabob (1 porsiya)',
    'Kabob va osh': 'Kuskavoy mol (1 dona)',
    'Salatlar': 'Sezar',
    'Somsa va qo‘shimchalar': 'Buyurtma somsa',
  },
  'dilshod-fayz': {
    '1-chi ovqatlar': 'Uyg‘urcha lag‘mon',
    '2-chi ovqatlar': 'Osh',
    '3-chi ovqatlar': 'Qo‘y go‘shti jiz (1 kg)',
    'Somsa': 'Somsa 15 000',
    'Shashliklar': 'Shashlik assorti katta',
    'Salatlar': 'Sezar salat',
    'Yaxna ichimliklar': 'Koka kola 1 L',
  },
};

try {
  for (const [slug, picks] of Object.entries(PICK)) {
    const r = await db.restaurant.findUnique({ where: { slug }, select: { id: true } });
    if (!r) { log(`${slug}: restaurant not found, skipped`); continue; }
    const categories = await db.category.findMany({
      where: { restaurantId: r.id },
      orderBy: { position: 'asc' },
      select: {
        id: true, name: true, image: { select: { version: true, sha256: true } },
        products: { where: { archivedAt: null, image: { isNot: null } }, orderBy: [{ position: 'asc' }, { name: 'asc' }], select: { name: true, image: { select: { mime: true, data: true, sha256: true } } } },
      },
    });
    for (const c of categories) {
      const dish = c.products.find(p => p.name === picks[c.name]) ?? c.products[0];
      if (!dish?.image) { log(`${slug} / ${c.name}: no dish with a photo, picture left as it is${c.image ? '' : ' (it has none)'}`); continue; }
      if (c.image?.sha256 === dish.image.sha256) { log(`${slug} / ${c.name}: already shows "${dish.name}", kept`); continue; }
      const events = await db.catalogEvent.findMany({ where: { restaurantId: r.id, entity: 'CATEGORY', entityId: c.id, action: 'CATEGORY_IMAGE_SET' }, select: { actorSessionId: true } });
      if (events.some(e => !e.actorSessionId.startsWith(OWNER_PREFIX))) { log(`${slug} / ${c.name}: picture was set by the restaurant itself, kept`); continue; }
      log(`${slug} / ${c.name}: picture = photo of "${dish.name}"${picks[c.name] === dish.name ? '' : ' (fallback: first dish with a photo)'}`);
      if (!APPLY) continue;
      const version = (c.image?.version ?? 0) + 1;
      const img = { mime: dish.image.mime, data: Uint8Array.from(Buffer.from(dish.image.data)) as Uint8Array<ArrayBuffer>, sha256: dish.image.sha256 };
      await db.$transaction([
        db.categoryImage.upsert({ where: { categoryId: c.id }, create: { categoryId: c.id, ...img, version }, update: { ...img, version } }),
        db.catalogEvent.create({ data: { restaurantId: r.id, entity: 'CATEGORY', entityId: c.id, action: 'CATEGORY_IMAGE_SET', actorSessionId: ACTOR, after: { source: `dish ${dish.name}`, version } } }),
      ]);
    }
  }
  if (!APPLY) console.log('Nothing written. Add --apply to write.');
} catch (err) {
  console.error('[FAILED]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
