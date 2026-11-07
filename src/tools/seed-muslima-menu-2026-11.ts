import { db } from '../lib/db.js';

/**
 * Owner request 2026-11-07: the menu of "Muslima kafesi" (restaurant found by name "Muslima"), read by hand from three photos of its printed menu plus a
 * list the owner typed. No dish pictures. Idempotent: a category / dish that already exists (same name) is kept as it is, so a price the restaurant
 * changed in its app stays. Prints the plan unless --apply is given; nothing is written unless exactly one restaurant matches the name.
 * Run on the server:  docker exec ds-prod-backend-1 node dist/src/tools/seed-muslima-menu-2026-11.js --apply
 *
 * Reading notes (check these with the restaurant):
 *  - Manti: the printed 10 000 / 40 000 are handwritten over the old prices; the handwritten ones are used.
 *  - "Fri kartoshka 1 porsiya" 20 000: the printed name was covered by a text label, the price is the printed one.
 *  - "Buyurtma somsa" 15 000: printed without a unit; taken as one piece.
 *  - "Osh - 07 porsiya" is printed so; taken as 0,7 porsiya.
 *  - Dishes priced per kilogram are named "(1 kg)": one unit = 1 kg.
 *  - "Adnarazviy idish" (owner's list) = a disposable container, sold as an ordinary dish "Bir martalik idish" 5 000 (not added to dishes by itself).
 */
const APPLY = process.argv.includes('--apply');
const ACTOR = 'owner-menu-import-20261107';
const log = (msg: string): void => console.log(`${APPLY ? '[APPLY]' : '[PLAN] '} ${msg}`);

type Dish = [name: string, priceSom: number];

const MENU: Array<{ category: string; dishes: Dish[] }> = [
  { category: '1-ovqatlar', dishes: [
    ['Sho‘rva (1 porsiya)', 30_000], ['Sho‘rva (0,7 porsiya)', 25_000],
    ['G‘ilak sho‘rva (1 porsiya)', 30_000], ['G‘ilak sho‘rva (0,7 porsiya)', 25_000],
    ['Chuchvara (1 porsiya)', 30_000], ['Chuchvara (0,7 porsiya)', 25_000],
    ['Lag‘mon uyg‘ur (1 porsiya)', 30_000], ['Mastava (1 porsiya)', 30_000],
    ['Tushyonka (1 porsiya)', 40_000], ['Grudenka (1 porsiya)', 40_000],
  ] },
  { category: '2-ovqatlar', dishes: [
    ['Qozon kabob (1 porsiya)', 50_000], ['Manti (1 dona)', 10_000], ['Manti (1 porsiya)', 40_000],
    ['Bo‘yin (1 kg)', 260_000], ['Cho‘poncha (1 kg)', 260_000], ['Shirvoz go‘shti JIZ (1 kg)', 280_000], ['Qo‘y go‘shti JIZ (1 kg)', 260_000],
    ['Uyg‘ur JIZ (1 kg)', 260_000], ['File JIZ (1 kg)', 260_000], ['Umakay (1 kg)', 260_000],
    ['Qovurma lag‘mon', 35_000], ['Fri kartoshka (1 porsiya)', 20_000],
  ] },
  { category: 'Kabob va osh', dishes: [
    ['Qiyma katta (1 dona)', 45_000], ['Qiyma (1 dona)', 25_000], ['Kuskavoy mol (1 dona)', 30_000], ['Kuskavoy qo‘y (1 dona)', 35_000],
    ['Qo‘yruq kabob (1 dona)', 30_000], ['Pomidor kabob (1 dona)', 15_000], ['Napalion kabob (1 dona)', 35_000],
    ['Osh (1 porsiya)', 30_000], ['Osh (0,7 porsiya)', 25_000], ['Debzira zakaz chaqar osh (1 kg)', 350_000],
  ] },
  { category: 'Salatlar', dishes: [
    ['Svejiy', 20_000], ['Gurman', 30_000], ['Pekin', 30_000], ['Mujskoy kapriz', 30_000], ['Sezar', 30_000],
    ['Chakki', 10_000], ['Zelen', 20_000], ['Achik-chuchuk', 20_000], ['Bahor salati', 10_000],
  ] },
  { category: 'Somsa va qo‘shimchalar', dishes: [
    ['Buyurtma somsa', 15_000], ['Kartoshka somsa', 6_000], ['Tovuq somsa', 10_000],
    ['Salyonne asarti', 20_000], ['Non', 4_000], ['Bir martalik idish', 5_000],
  ] },
];

async function main(): Promise<void> {
  const rows = await db.restaurant.findMany({ where: { name: { contains: 'muslima', mode: 'insensitive' } }, select: { id: true, slug: true, name: true } });
  if (rows.length !== 1) { log(`${rows.length} restaurants match "Muslima" (${rows.map(r => r.slug).join(', ') || 'none'}): nothing written`); return; }
  const r = rows[0]!;
  const maxPos = (await db.category.aggregate({ where: { restaurantId: r.id }, _max: { position: true } }))._max.position ?? -1;
  let madeCats = 0; let madeDishes = 0; let keptDishes = 0;
  for (const [ci, group] of MENU.entries()) {
    let cat = await db.category.findFirst({ where: { restaurantId: r.id, name: group.category }, select: { id: true } });
    if (!cat) {
      madeCats++;
      log(`${r.name}: category "${group.category}" (${group.dishes.length} dishes)`);
      if (APPLY) cat = await db.category.create({ data: { restaurantId: r.id, name: group.category, position: maxPos + 1 + ci }, select: { id: true } });
    }
    const seen = new Set<string>();
    for (const [di, [name, priceSom]] of group.dishes.entries()) {
      if (seen.has(name)) throw new Error(`duplicate name in the plan: ${name}`);
      seen.add(name);
      const exists = await db.product.findFirst({ where: { restaurantId: r.id, name, archivedAt: null }, select: { id: true } });
      if (exists) { keptDishes++; continue; }
      madeDishes++;
      if (!APPLY || !cat) continue;
      const p = await db.product.create({ data: { restaurantId: r.id, categoryId: cat.id, name, priceSom, position: di + 1 } });
      await db.catalogEvent.create({ data: { restaurantId: r.id, entity: 'PRODUCT', entityId: p.id, action: 'PRODUCT_CREATED', actorSessionId: ACTOR, after: { name, priceSom } } });
    }
  }
  log(`${r.name} (${r.slug}): ${madeCats} new categories, ${madeDishes} new dishes, ${keptDishes} already there (kept)`);
  if (APPLY) await db.adminAuditEvent.create({ data: { actorId: ACTOR, action: 'MENU_IMPORT', targetType: 'Restaurant', targetId: r.id, details: { categories: madeCats, dishes: madeDishes, kept: keptDishes } } });
  if (!APPLY) console.log('Nothing written. Add --apply to write.');
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
