import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../lib/db.js';

/**
 * Owner request 2026-11-07: pictures for the dishes of "Muslima kafe" (slug muslima), found on the internet (Wikimedia Commons, free licences;
 * authors in prisma/seed-assets/muslima/CREDITS.md), WebP, same method as the Dilshod Fayz set. Run AFTER seed-muslima-menu-2026-11. Prints the plan unless --apply is given.
 * A dish that already has a picture (the restaurant set its own, or an earlier run) is never overwritten. Dishes not listed here have no picture on purpose:
 * no honest match was found (shurva, g'ilak shurva, tushyonka, grudenka, cho'poncha, umakay, pomidor kabob, the salads gurman / pekin / mujskoy kapriz / chakki / bahor,
 * salyonne asarti, bir martalik idish) - the owner edits those later.
 * Run on the server:  docker exec ds-prod-backend-1 node dist/src/tools/seed-muslima-photos-2026-11-07.js --apply
 */
const APPLY = process.argv.includes('--apply');
const SLUG = 'muslima';
const ACTOR = 'owner-menu-photos-muslima-20261107';
const ASSETS = resolve(process.cwd(), 'prisma/seed-assets/muslima');
const log = (msg: string): void => console.log(`${APPLY ? '[APPLY]' : '[PLAN] '} ${msg}`);

/** photo file -> dish names (exact, as the menu import created them) */
const PHOTOS: Array<{ file: string; names: string[] }> = [
  { file: 'chuchvara.webp', names: ['Chuchvara (1 porsiya)', 'Chuchvara (0,7 porsiya)'] },
  { file: 'mastava.webp', names: ['Mastava (1 porsiya)'] },
  { file: 'lagman.webp', names: ['Lag‘mon uyg‘ur (1 porsiya)', 'Qovurma lag‘mon'] },
  { file: 'kazan-kabob.webp', names: ['Qozon kabob (1 porsiya)', 'Shirvoz go‘shti JIZ (1 kg)', 'Qo‘y go‘shti JIZ (1 kg)', 'Uyg‘ur JIZ (1 kg)', 'File JIZ (1 kg)'] },
  { file: 'manti.webp', names: ['Manti (1 dona)', 'Manti (1 porsiya)'] },
  { file: 'lamb-ribs.webp', names: ['Bo‘yin (1 kg)'] },
  { file: 'fries.webp', names: ['Fri kartoshka (1 porsiya)'] },
  { file: 'lula.webp', names: ['Qiyma katta (1 dona)', 'Qiyma (1 dona)'] },
  { file: 'shashlik.webp', names: ['Kuskavoy mol (1 dona)', 'Kuskavoy qo‘y (1 dona)', 'Qo‘yruq kabob (1 dona)', 'Napalion kabob (1 dona)'] },
  { file: 'osh.webp', names: ['Osh (1 porsiya)', 'Osh (0,7 porsiya)', 'Debzira zakaz chaqar osh (1 kg)'] },
  { file: 'tomato-onion.webp', names: ['Svejiy', 'Achik-chuchuk'] },
  { file: 'caesar.webp', names: ['Sezar'] },
  { file: 'herbs.webp', names: ['Zelen'] },
  { file: 'somsa.webp', names: ['Buyurtma somsa', 'Kartoshka somsa', 'Tovuq somsa'] },
  { file: 'non.webp', names: ['Non'] },
];

try {
  const r = await db.restaurant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!r) throw new Error(`${SLUG} not found`);
  const dishes = await db.product.findMany({ where: { restaurantId: r.id, archivedAt: null }, select: { id: true, name: true, imageUrl: true, image: { select: { version: true } } } });
  const byName = new Map(dishes.map(d => [d.name, d]));
  let set = 0; let kept = 0; let missing = 0;
  const seen = new Set<string>();
  for (const p of PHOTOS) {
    const bytes = readFileSync(resolve(ASSETS, p.file));
    const img = { mime: 'image/webp', data: Uint8Array.from(bytes) as Uint8Array<ArrayBuffer>, sha256: createHash('sha256').update(bytes).digest('hex') };
    for (const name of p.names) {
      if (seen.has(name)) throw new Error(`dish listed twice in the plan: ${name}`);
      seen.add(name);
      const d = byName.get(name);
      if (!d) { missing++; log(`${name}: dish not found, skipped`); continue; }
      if (d.image || d.imageUrl) { kept++; log(`${name}: already has a picture, kept`); continue; }
      set++;
      log(`${name}: photo = ${p.file}`);
      if (APPLY) {
        await db.productImage.create({ data: { productId: d.id, ...img, version: 1 } });
        await db.catalogEvent.create({ data: { restaurantId: r.id, entity: 'PRODUCT', entityId: d.id, action: 'PRODUCT_IMAGE_SET', actorSessionId: ACTOR, after: { source: p.file, version: 1 } } });
      }
    }
  }
  const noPhoto = dishes.filter(d => !seen.has(d.name) && !d.image && !d.imageUrl).map(d => d.name);
  log(`${set} pictures to set, ${kept} dishes already had one (kept), ${missing} names not found; ${noPhoto.length} dishes stay without a picture: ${noPhoto.join(', ')}`);
  if (!APPLY) console.log('Nothing written. Add --apply to write.');
} catch (err) {
  console.error('[FAILED]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
