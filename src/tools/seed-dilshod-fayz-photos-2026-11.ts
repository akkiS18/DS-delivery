import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../lib/db.js';

/**
 * Owner request 2026-11-04: pictures for the dishes of "Dilshod Fayz" (slug dilshod-fayz) found on the internet (Wikimedia Commons, free licences;
 * authors in prisma/seed-assets/dilshod-fayz/CREDITS.md). Run AFTER seed-dilshod-fayz-menu-2026-11. Prints the plan unless --apply is given.
 * A dish that already has a picture (the restaurant set its own, or an earlier run) is never overwritten. Dishes not listed here have no picture on purpose:
 * no honest match was found (e.g. shurva, grudinka, jiz kebab, sprite) - the owner edits those later.
 * Run on the server:  docker exec ds-prod-backend-1 node dist/src/tools/seed-dilshod-fayz-photos-2026-11.js --apply
 */
const APPLY = process.argv.includes('--apply');
const SLUG = 'dilshod-fayz';
const ACTOR = 'owner-menu-photos-dilshod-20261104';
const ASSETS = resolve(process.cwd(), 'prisma/seed-assets/dilshod-fayz');
const log = (msg: string): void => console.log(`${APPLY ? '[APPLY]' : '[PLAN] '} ${msg}`);

/** photo file -> dish names (exact, as the menu import created them) */
const PHOTOS: Array<{ file: string; names: string[] }> = [
  // 1-chi ovqatlar
  { file: 'mastava.jpg', names: ['Mastava'] },
  { file: 'pelmen.jpg', names: ['Pelmen uzi', 'Pelmen shurva'] },
  { file: 'golubsi.jpg', names: ['Golubsi'] },
  { file: 'lagman.jpg', names: ['Uyg‘urcha lag‘mon', 'Kavurma lag‘mon'] },
  // 2-chi ovqatlar
  { file: 'dulma.jpg', names: ['Ozarbayjon dulma'] },
  { file: 'tabaka.jpg', names: ['Tabaka (1 kg)'] },
  { file: 'tandir-lamb.jpg', names: ['Tandir qo‘y go‘shti (1 kg)'] },
  { file: 'osh.jpg', names: ['Osh'] },
  { file: 'manti.jpg', names: ['Manti'] },
  { file: 'fried-chicken.jpg', names: ['KFC (1 kg)'] },
  { file: 'carp.jpg', names: ['Baliq sazan (1 kg)'] },
  // 3-chi ovqatlar
  { file: 'kazan-kabob.jpg', names: ['Uyg‘urcha jiz (1 kg)', 'Qo‘y go‘shti jiz (1 kg)', 'File jiz (1 kg)', 'Mol go‘shti jiz (1 kg)', 'Cho‘pon jiz qo‘y go‘shti (1 kg)', 'Achchiq go‘sht (1 kg)'] },
  { file: 'lamb-ribs.jpg', names: ['Vagura qo‘y go‘shti (1 kg)', 'Qo‘l qo‘y go‘shti (1 kg)', 'Buyin qo‘y go‘shti (1 kg)'] },
  { file: 'tandir-lamb.jpg', names: ['Buglama qo‘y go‘shti (1 kg)', 'Buglama mol go‘shti (1 kg)'] },
  // Somsa
  { file: 'somsa.jpg', names: ['Somsa 15 000', 'Somsa 10 000', 'Somsa qo‘y go‘shti'] },
  // Shashliklar
  { file: 'shashlik.jpg', names: ['Shashlik assorti katta', 'Shashlik assorti kichkina', 'Barbekyu qo‘y go‘shti', 'Napoleon shashlik', 'Rulet shashlik', 'Koreyka shashlik', 'Kuskovoy 1 metr qo‘y go‘shti', 'Kuskovoy mol go‘shti', 'Kuskovoy qo‘y go‘shti'] },
  { file: 'chicken-skewer.jpg', names: ['Tovuq shashlik', 'Tovuq barbekyu (1 kg)'] },
  { file: 'lula.jpg', names: ['Farsh', 'Farsh 1 metr'] },
  { file: 'steak.jpg', names: ['Steyk'] },
  { file: 'tomato.jpg', names: ['Pamidor'] },
  // Salatlar
  { file: 'caesar.jpg', names: ['Sezar salat'] },
  { file: 'tomato-onion.jpg', names: ['Achchiq-chuchuk salat', 'Yangi salat', 'Yangi assorti', 'Yangi chakki aralash salat'] },
  { file: 'coleslaw.jpg', names: ['Karam salat'] },
  { file: 'sauerkraut.jpg', names: ['Tuzlangan karam'] },
  { file: 'fruit.jpg', names: ['Meva asortiy', 'Meva assorti 0.5'] },
  { file: 'watermelon.jpg', names: ['Tarvuz', 'Qovun va tarvuz'] },
  { file: 'lemon.jpg', names: ['Limon'] },
  { file: 'herbs.jpg', names: ['Zelen', 'Chakki zelen'] },
  { file: 'garlic.jpg', names: ['Sarimsoq'] },
  { file: 'ayran.jpg', names: ['Ayron', 'Ayron grafin'] },
  // Yaxna ichimliklar
  { file: 'pepsi.jpg', names: ['Pepsi 0.5 L', 'Pepsi 1 L', 'Pepsi 1.5 L', 'Pepsi 2.0 L', 'Pepsi banka 0.5 L'] },
  { file: 'fanta.jpg', names: ['Fanta 1.0 L', 'Fanta 1.5 L', 'Fanta 2.0 L'] },
  { file: 'cola.jpg', names: ['Koka kola 0.5 L', 'Koka kola 1 L', 'Koka kola 1.5 L', 'Koka kola 2.0 L'] },
  { file: 'borjomi.jpg', names: ['Borjomi'] },
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
    const img = { mime: 'image/jpeg', data: Uint8Array.from(bytes) as Uint8Array<ArrayBuffer>, sha256: createHash('sha256').update(bytes).digest('hex') };
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
  const noPhoto = dishes.filter(d => !seen.has(d.name) && !d.image && !d.imageUrl).length;
  log(`${set} pictures to set, ${kept} dishes already had one (kept), ${missing} names not found; ${noPhoto} dishes stay without a picture`);
  if (!APPLY) console.log('Nothing written. Add --apply to write.');
} catch (err) {
  console.error('[FAILED]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
