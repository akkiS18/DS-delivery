import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { db } from '../lib/db.js';

/**
 * Owner request 2026-11-21: Asl Market (slug asl-market) sweets, read from four photos of the shop's YesPOS till screen, put into categories,
 * plus a Kinder Chocolate offer: the dish stands in the "AKSIYA" group AND in its own group (two separate dishes with the same name,
 * the same way Sifat Food has "LAVASH O'RTACHA 1+1"), and the owner's poster kinder-aksiya.webp becomes a home slide of Asl Market
 * (a tap opens the AKSIYA group, see publicBanners in src/modules/promotions/service.ts).
 * Product names are unique per restaurant, so the AKSIYA copy is "Kinder Chocolate 100 g (aksiya)".
 * Offer price = the till price 23 990, crossed-out earlier price 36 990 (both printed on the owner's poster, "-35%").
 * Idempotent: a group / dish that already exists (same name in the same group) is kept, so a price the shop changed in its app stays;
 * the slide is kept when one with the same title and picture exists. Prints the plan unless --apply is given.
 *
 * No release needed: run inside the prod container like scripts/upload-dish-photos.sh does (imports rewritten to /app paths):
 *   node /tmp/asl-tool/seed-asl-market-sweets-2026-11.js --banner /tmp/asl-tool/kinder-aksiya.webp [--apply]
 * Dish pictures go separately with scripts/upload-dish-photos.sh asl-market <folder of copies named after the dishes>.
 *
 * 2026-11-22: the owner dropped "Konfetlar" (Raffaello + Ferrero moved to "Shokoladlar" by asl-market-fold-konfetlar-2026-11-22.ts): do not run this again.
 *
 * Reading notes: till names were Russian ("Нутилла майда шт", "Нутилла катта"); the owner's pictures for them are Nutella jars, so they are
 * "Nutella (kichik)" / "Nutella (katta)", next to the separate till line "Нутелла Шок Паста 180г" = "Nutella 180 g".
 * "Ferrero Collection 15\6" is written without the "15\6" (its meaning is not clear from the till).
 */
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const BANNER = (() => { const i = args.indexOf('--banner'); return i >= 0 ? args[i + 1] : undefined; })();
const ACTOR = 'owner-menu-import-20261121';
const SLUG = 'asl-market';
const BANNER_TITLE = 'Kinder Chocolate -35%';
const log = (msg: string): void => console.log(`${APPLY ? '[APPLY]' : '[PLAN] '} ${msg}`);

type Dish = { name: string; priceSom: number; oldPriceSom?: number };
const KINDER_100: Dish = { name: 'Kinder Chocolate 100 g', priceSom: 23_990, oldPriceSom: 36_990 };
// Product names are unique per restaurant (index Product_active_name_per_restaurant), so the AKSIYA copy carries its own name.
const KINDER_100_AKSIYA: Dish = { ...KINDER_100, name: 'Kinder Chocolate 100 g (aksiya)' };

const MENU: Array<{ category: string; dishes: Dish[] }> = [
  { category: 'AKSIYA', dishes: [KINDER_100_AKSIYA] },
  { category: 'Shokoladlar', dishes: [
    KINDER_100,
    { name: 'Kinder Chocolate 50 g', priceSom: 15_000 },
    { name: 'Kinder Joy', priceSom: 22_000 },
    { name: 'Alyonka sutli shokolad 150 g', priceSom: 28_000 },
    { name: 'Millennium Golden Nut 100 g', priceSom: 28_000 },
    { name: 'Millennium Very Peri 140 g', priceSom: 43_000 },
    { name: 'Lyubimov sutli shokolad 208 g', priceSom: 55_000 },
  ] },
  { category: 'Konfetlar', dishes: [
    { name: 'Raffaello 150 g', priceSom: 59_990 },
    { name: 'Ferrero Collection', priceSom: 125_000 },
  ] },
  { category: 'Shokolad pastalari', dishes: [
    { name: 'Nutella (kichik)', priceSom: 17_000 },
    { name: 'Milka shokolad pastasi 180 g', priceSom: 45_000 },
    { name: 'Nutella 180 g', priceSom: 49_000 },
    { name: 'Nutella (katta)', priceSom: 78_000 },
  ] },
];

const isWebp = (b: Buffer): boolean => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
const som = (n: number): string => n.toLocaleString('ru-RU');

async function main(): Promise<void> {
  const r = await db.restaurant.findUnique({ where: { slug: SLUG }, select: { id: true, name: true, isActive: true, isPaused: true } });
  if (!r) { log(`no restaurant with slug "${SLUG}": nothing written`); return; }
  log(`${r.name}: active=${r.isActive} paused=${r.isPaused}`);

  // Check the poster before anything is written.
  let poster: { bytes: Buffer; sha256: string } | null = null;
  if (BANNER) {
    const bytes = readFileSync(BANNER);
    if (!isWebp(bytes) || bytes.length < 1024 || bytes.length > 1024 * 1024) throw new Error(`bad poster: ${BANNER}`);
    poster = { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
  } else log('no --banner given: the home slide is skipped');

  // First --apply run (2026-11-21) stopped on the unique name after creating the AKSIYA copy under the plain name: give it its own name.
  const firstTry = await db.product.findFirst({ where: { restaurantId: r.id, name: KINDER_100.name, archivedAt: null, category: { name: 'AKSIYA' } }, select: { id: true } });
  if (firstTry) {
    log(`AKSIYA · "${KINDER_100.name}" renamed to "${KINDER_100_AKSIYA.name}"`);
    if (APPLY) await db.product.update({ where: { id: firstTry.id }, data: { name: KINDER_100_AKSIYA.name, version: { increment: 1 } } });
  }

  const maxPos = (await db.category.aggregate({ where: { restaurantId: r.id }, _max: { position: true } }))._max.position ?? -1;
  let madeCats = 0; let madeDishes = 0; let kept = 0;
  for (const [ci, group] of MENU.entries()) {
    let cat = await db.category.findFirst({ where: { restaurantId: r.id, name: group.category }, select: { id: true } });
    if (!cat) {
      madeCats++;
      log(`group "${group.category}" (${group.dishes.length} dishes)`);
      if (APPLY) cat = await db.category.create({ data: { restaurantId: r.id, name: group.category, position: maxPos + 1 + ci }, select: { id: true } });
    }
    for (const [di, d] of group.dishes.entries()) {
      const exists = cat && await db.product.findFirst({ where: { restaurantId: r.id, categoryId: cat.id, name: d.name, archivedAt: null }, select: { id: true } });
      if (exists || (firstTry && d === KINDER_100_AKSIYA)) { kept++; continue; }
      madeDishes++;
      log(`   ${group.category} · ${d.name} — ${som(d.priceSom)} so‘m${d.oldPriceSom ? ` (old price ${som(d.oldPriceSom)} crossed out)` : ''}`);
      if (!APPLY || !cat) continue;
      const p = await db.product.create({ data: { restaurantId: r.id, categoryId: cat.id, name: d.name, priceSom: d.priceSom, oldPriceSom: d.oldPriceSom ?? null, position: di + 1 } });
      await db.catalogEvent.create({ data: { restaurantId: r.id, entity: 'PRODUCT', entityId: p.id, action: 'PRODUCT_CREATED', actorSessionId: ACTOR, after: { name: d.name, priceSom: d.priceSom, oldPriceSom: d.oldPriceSom ?? null } } });
    }
  }

  if (poster) {
    const same = await db.banner.findFirst({ where: { restaurantId: r.id, title: BANNER_TITLE, image: { is: { sha256: poster.sha256 } } }, select: { id: true } });
    if (same) log(`slide "${BANNER_TITLE}": already there, kept`);
    else {
      const position = ((await db.banner.aggregate({ _max: { position: true } }))._max.position ?? -1) + 1;
      log(`slide "${BANNER_TITLE}": create at position ${position} (${poster.bytes.length} bytes), a tap opens the Asl Market AKSIYA group`);
      if (APPLY) {
        const b = await db.banner.create({ data: { title: BANNER_TITLE, restaurantId: r.id, position } });
        await db.bannerImage.create({ data: { bannerId: b.id, mime: 'image/webp', data: Uint8Array.from(poster.bytes), sha256: poster.sha256, version: 1 } });
        await db.adminAuditEvent.create({ data: { actorId: ACTOR, action: 'BANNER_CREATED', targetType: 'Banner', targetId: b.id, details: { title: BANNER_TITLE } } });
      }
    }
  }

  log(`${r.name}: ${madeCats} new groups, ${madeDishes} new dishes, ${kept} already there (kept)`);
  if (APPLY) await db.adminAuditEvent.create({ data: { actorId: ACTOR, action: 'MENU_IMPORT', targetType: 'Restaurant', targetId: r.id, details: { categories: madeCats, dishes: madeDishes, kept } } });
  if (!APPLY) console.log('Nothing written. Add --apply to write.');
}

main().catch(e => { console.error('[FAILED]', e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => db.$disconnect());
