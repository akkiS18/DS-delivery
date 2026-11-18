import { db } from '../lib/db.js';

/**
 * Owner request 2026-11-18 (urgent): the menu of "Tengsiz food" (slug tengsiz-food), read by hand from three photos of its printed menu
 * (menu1 = sauces, menu2 = lavash / donar / burgers / hot-dog, menu3 = pizza / kabob / chicken). No dish pictures.
 * Idempotent: a category / dish that already exists (same name) is kept as it is, so a price the restaurant changed in its app stays.
 * Prints the plan unless --apply is given; nothing is written unless exactly one restaurant has the slug.
 * Run on the server:  docker exec ds-prod-backend-1 node dist/src/tools/seed-tengsiz-food-menu-2026-11.js --apply
 *
 * Reading notes (check these with the restaurant):
 *  - "File 500 gr": the price is hidden by glare on the photo; 43 000 is taken from the identical "Qanotcha" row (300 gr / 500 gr / 1 kg).
 *    The "300 gr" label of File is also under the glare; the same sizes as Qanotcha are assumed.
 *  - Printed spellings are kept (Asarti, Mesnoy, Pepironi, Zakritiy, Kuriniy, Karaleviski); only "Gamgurger" is corrected to "Gamburger".
 *  - All pizzas are 32 sm (printed once for the whole list).
 *  - "Donar blyuda": go‘shtli 49 000, tovuqli 55 000 — printed so (chicken dearer).
 *  - menu1 shows only the sauces clearly; two more dishes at its right edge (blue titles "OL…", "FE…") are cut off and not added.
 */
const APPLY = process.argv.includes('--apply');
const ACTOR = 'owner-menu-import-20261118';
const SLUG = 'tengsiz-food';
const log = (msg: string): void => console.log(`${APPLY ? '[APPLY]' : '[PLAN] '} ${msg}`);

type Dish = [name: string, priceSom: number, description?: string];

const PIZZA = '32 sm';
const MENU: Array<{ category: string; dishes: Dish[] }> = [
  { category: 'Lavash', dishes: [
    ['Lavash', 34_000], ['Lavash pishloqli', 37_000], ['Tandir lavash', 38_000], ['Tovuqli lavash', 28_000], ['Shashlik lavash', 30_000],
  ] },
  { category: 'Donar va pita', dishes: [
    ['Pita (donar)', 36_000], ['Non kabob', 45_000], ['Donar blyuda go‘shtli', 49_000], ['Donar blyuda tovuqli', 55_000], ['Smile Box', 32_000],
  ] },
  { category: 'Burgerlar', dishes: [
    ['Gamburger', 30_000], ['Chizburger', 34_000], ['Big burger', 45_000], ['Big chizburger', 50_000], ['Tovuqli burger', 30_000],
  ] },
  { category: 'Hot-dog va sendvich', dishes: [
    ['Hot-dog klassik', 18_000], ['Hot-dog Karaleviski', 20_000], ['Shashlik hot-dog', 26_000],
    ['Klab sendvich go‘shtli', 45_000], ['Klab sendvich tovuqli', 40_000],
  ] },
  { category: 'Pitsa', dishes: [
    ['Pitsa Asarti', 89_000, PIZZA], ['Pitsa Mesnoy', 89_000, PIZZA], ['Pitsa Pepironi', 75_000, PIZZA], ['Pitsa Margarita', 59_000, PIZZA],
    ['Pitsa Zakritiy', 90_000, PIZZA], ['Pitsa 4 sezona', 80_000, PIZZA], ['Pitsa Kuriniy', 80_000, PIZZA],
  ] },
  { category: 'Kabob va shashlik', dishes: [
    ['Qiyma kabob', 22_000], ['Kabob (mol go‘shti)', 28_000], ['Tovuq qanoti (1 kg)', 75_000], ['1 metrlik shashlik', 145_000],
  ] },
  { category: 'File va qanotcha', dishes: [
    ['File (300 gr)', 25_000], ['File (500 gr)', 43_000], ['File (1 kg)', 85_000],
    ['Qanotcha (300 gr)', 25_000], ['Qanotcha (500 gr)', 43_000], ['Qanotcha (1 kg)', 85_000],
  ] },
  { category: 'Fri va souslar', dishes: [
    ['Fri kartoshka', 15_000], ['Tomat sous', 3_000], ['Chesnok sous', 5_000], ['Sirli sous', 7_000], ['Ketchup sous', 3_000],
  ] },
];

async function main(): Promise<void> {
  const r = await db.restaurant.findUnique({ where: { slug: SLUG }, select: { id: true, slug: true, name: true } });
  if (!r) { log(`no restaurant with slug "${SLUG}": nothing written`); return; }
  const maxPos = (await db.category.aggregate({ where: { restaurantId: r.id }, _max: { position: true } }))._max.position ?? -1;
  let madeCats = 0; let madeDishes = 0; let keptDishes = 0;
  const seen = new Set<string>();
  for (const [ci, group] of MENU.entries()) {
    let cat = await db.category.findFirst({ where: { restaurantId: r.id, name: group.category }, select: { id: true } });
    if (!cat) {
      madeCats++;
      log(`${r.name}: category "${group.category}" (${group.dishes.length} dishes)`);
      if (APPLY) cat = await db.category.create({ data: { restaurantId: r.id, name: group.category, position: maxPos + 1 + ci }, select: { id: true } });
    }
    for (const [di, [name, priceSom, description]] of group.dishes.entries()) {
      if (seen.has(name)) throw new Error(`duplicate name in the plan: ${name}`);
      seen.add(name);
      const exists = await db.product.findFirst({ where: { restaurantId: r.id, name, archivedAt: null }, select: { id: true } });
      if (exists) { keptDishes++; continue; }
      madeDishes++;
      log(`   ${group.category} · ${name} — ${priceSom.toLocaleString('ru-RU')} so‘m${description ? ` (${description})` : ''}`);
      if (!APPLY || !cat) continue;
      const p = await db.product.create({ data: { restaurantId: r.id, categoryId: cat.id, name, priceSom, description: description ?? null, position: di + 1 } });
      await db.catalogEvent.create({ data: { restaurantId: r.id, entity: 'PRODUCT', entityId: p.id, action: 'PRODUCT_CREATED', actorSessionId: ACTOR, after: { name, priceSom } } });
    }
  }
  log(`${r.name} (${r.slug}): ${madeCats} new categories, ${madeDishes} new dishes, ${keptDishes} already there (kept)`);
  if (APPLY) await db.adminAuditEvent.create({ data: { actorId: ACTOR, action: 'MENU_IMPORT', targetType: 'Restaurant', targetId: r.id, details: { categories: madeCats, dishes: madeDishes, kept: keptDishes } } });
  if (!APPLY) console.log('Nothing written. Add --apply to write.');
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
