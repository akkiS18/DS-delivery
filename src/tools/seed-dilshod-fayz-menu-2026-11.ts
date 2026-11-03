import { db } from '../lib/db.js';

/**
 * Owner request 2026-11-04: the menu of the restaurant "Dilshod Fayz" (slug dilshod-fayz), read by hand from 11 photos of the restaurant's cash-register
 * screen. No pictures yet (the owner supplies them later). Idempotent: a category / dish that already exists (same name) is kept as it is, so a price
 * the restaurant changed in its app stays. Prints the plan unless --apply is given.
 * Run on the server:  docker exec ds-prod-backend-1 node dist/src/tools/seed-dilshod-fayz-menu-2026-11.js --apply
 *
 * Dishes the register showed greyed out (no stock count) are created as NOT available; the restaurant switches them on in its app.
 * Prices are per portion unless the name says "(1 kg)" (the register sold those by weight: one unit = 1 kg).
 * Not imported on purpose: "Kumir" (charcoal), the second copy of "Uyg‘urcha jiz" (listed under two courses), and the categories of which no photo was
 * taken (breakfast, bread and service, tea, dishes, spirits, beer snacks, beer).
 */
const APPLY = process.argv.includes('--apply');
const SLUG = 'dilshod-fayz';
const ACTOR = 'owner-menu-import-20261104';
const log = (msg: string): void => console.log(`${APPLY ? '[APPLY]' : '[PLAN] '} ${msg}`);

type Dish = [name: string, priceSom: number, available?: boolean];
const OFF = false;

const MENU: Array<{ category: string; dishes: Dish[] }> = [
  { category: '1-chi ovqatlar', dishes: [
    ['Mastava', 25_000], ['Pelmen uzi', 25_000], ['Saboy teftil shurva', 35_000], ['Teftil shurva', 30_000], ['Shurva yarim porsiya', 22_000],
    ['Uyg‘urcha lag‘mon', 25_000], ['Golubsi', 25_000], ['Shurva', 30_000], ['Shurva bulon 10 000', 10_000], ['Shurva bulon 5 000', 5_000],
    ['Pelmen shurva', 25_000], ['Saboy shurva', 35_000],
  ] },
  { category: '2-chi ovqatlar', dishes: [
    ['Ozarbayjon dulma', 35_000], ['Grudinka yarim porsiya', 22_000], ['Saryog‘', 3_000], ['Tabaka (1 kg)', 60_000], ['Tandir qo‘y go‘shti (1 kg)', 275_000],
    ['Tuxum barak', 8_000], ['Uyg‘urcha jiz (1 kg)', 220_000], ['Shurvani go‘sht (1 kg)', 220_000], ['Osh', 25_000], ['Manti', 10_000],
    ['Kavurma lag‘mon', 25_000], ['Yaxna go‘sht (1 kg)', 220_000], ['Grudinka saboy', 35_000], ['Grudinka (1 kg)', 200_000], ['Qovurdoq tovuq go‘shti', 25_000],
    ['Grudinka porsiya', 30_000], ['KFC (1 kg)', 75_000], ['Sous baliq', 4_000], ['Baliq sazan (1 kg)', 70_000],
  ] },
  { category: '3-chi ovqatlar', dishes: [
    ['Vagura qo‘y go‘shti (1 kg)', 230_000], ['Buglama mol go‘shti (1 kg)', 260_000, OFF], ['Qo‘y go‘shti jiz (1 kg)', 220_000], ['Qo‘l qo‘y go‘shti (1 kg)', 220_000],
    ['File jiz (1 kg)', 220_000], ['Buyin qo‘y go‘shti (1 kg)', 220_000], ['Achchiq go‘sht (1 kg)', 220_000], ['Cho‘pon jiz qo‘y go‘shti (1 kg)', 220_000],
    ['Buglama qo‘y go‘shti (1 kg)', 260_000], ['Mol go‘shti jiz (1 kg)', 220_000],
  ] },
  { category: 'Somsa', dishes: [['Somsa 15 000', 15_000], ['Sous', 2_000], ['Somsa 10 000', 10_000], ['Somsa qo‘y go‘shti', 16_000]] },
  { category: 'Shashliklar', dishes: [
    ['Shashlik assorti katta', 565_500], ['Baliq shashlik', 25_000], ['Barbekyu qo‘y go‘shti', 210_000], ['Dumba', 25_000], ['Jigar shashlik', 30_000],
    ['Kuskovoy 1 metr qo‘y go‘shti', 180_000], ['Xom farsh (1 kg)', 150_000], ['O‘rdak barbekyu', 75_000, OFF], ['Napoleon shashlik', 52_000], ['Pamidor', 15_000],
    ['Steyk', 210_000], ['O‘rdak go‘shti', 25_000], ['Farsh 1 metr', 170_000], ['Rulet shashlik', 52_000], ['Shashlik assorti kichkina', 422_000],
    ['Koreyka shashlik', 60_000], ['Tovuq barbekyu (1 kg)', 65_000], ['Tovuq shashlik', 20_000], ['Kuskovoy mol go‘shti', 52_000], ['Kuskovoy qo‘y go‘shti', 52_000], ['Farsh', 48_000],
  ] },
  { category: 'Salatlar', dishes: [
    ['Zelen', 15_000], ['Qovun va tarvuz', 15_000], ['Karam salat', 15_000], ['Limon', 10_000], ['Erkaklar kapriz salat', 25_000], ['Yangi assorti', 30_000],
    ['Yangi salat', 15_000], ['Pishloqli sous', 10_000], ['Meva asortiy', 110_000], ['Yangi chakki aralash salat', 18_000], ['Meva assorti 0.5', 6_000],
    ['Chakki zelen', 8_000], ['Sarimsoq', 5_000], ['Chakki', 5_000], ['Tarvuz', 10_000], ['Sezar salat', 23_000], ['Tuzlangan karam', 10_000],
    ['Tuzlangan assorti', 15_000], ['Yapon salat', 30_000], ['Ayron', 7_000], ['Ayron grafin', 20_000], ['Achchiq-chuchuk salat', 15_000], ['Achchiq qalampir', 1_000],
    ['Vetchina salat', 16_000], ['Bahor salat', 15_000], ['Gurman salat', 25_000], ['Ayollar kapriz salat', 25_000],
  ] },
  { category: 'Yaxna ichimliklar', dishes: [
    ['Fanta 1.0 L', 12_000], ['Chortoq', 12_000], ['Fanta 1.5 L', 16_000], ['Koka kola 1 L', 12_000], ['Koka kola 2.0 L', 20_000, OFF], ['Adrenalin', 17_000, OFF],
    ['Koka kola 1.5 L', 16_000], ['Gazsiz suv 1.5 L', 5_000], ['+18', 13_000], ['Moxito 0.5 L', 12_000], ['Borjomi', 18_000], ['Fanta 2.0 L', 20_000, OFF], ['Bliss sok', 16_000],
    ['Mountain Dew 0.5 L', 5_000], ['Rokstar 0.5 L', 12_000], ['Flesh 0.5 L', 12_000], ['Koka kola 0.5 L', 8_000], ['Moxito Fresh', 12_000], ['Sprite 1.5 L', 16_000, OFF],
    ['Anor suv 0.5 L', 12_000, OFF], ['Anor suv 0.3 L', 8_000, OFF], ['Gazli suv 1.5 L', 6_000], ['Gorilla', 12_000], ['Qovunli sok 0.5 L', 10_000, OFF],
    ['Qovunli sok 1.1 L', 15_000, OFF], ['Lipton choy 1 L', 12_000, OFF], ['Merenda 1.5 L', 12_000, OFF], ['Pepsi 0.5 L', 7_000, OFF], ['Pepsi 1.5 L', 16_000],
    ['Pepsi 1 L', 12_000], ['Pepsi 2.0 L', 20_000], ['Pepsi banka 0.5 L', 11_000], ['Limonat 0.5 L', 12_000],
  ] },
];

async function main(): Promise<void> {
  const r = await db.restaurant.findUnique({ where: { slug: SLUG }, select: { id: true, name: true } });
  if (!r) { console.log(`restaurant "${SLUG}" not found`); process.exitCode = 1; return; }
  let madeCats = 0; let madeDishes = 0; let keptDishes = 0;
  for (const [ci, group] of MENU.entries()) {
    let cat = await db.category.findFirst({ where: { restaurantId: r.id, name: group.category }, select: { id: true } });
    if (!cat) {
      madeCats++;
      log(`${r.name}: category "${group.category}" (${group.dishes.length} dishes)`);
      if (APPLY) cat = await db.category.create({ data: { restaurantId: r.id, name: group.category, position: ci }, select: { id: true } });
    }
    const seen = new Set<string>();
    for (const [di, [name, priceSom, available = true]] of group.dishes.entries()) {
      if (seen.has(name)) throw new Error(`duplicate name in the plan: ${name}`);
      seen.add(name);
      const exists = await db.product.findFirst({ where: { restaurantId: r.id, name, archivedAt: null }, select: { id: true } });
      if (exists) { keptDishes++; continue; }
      madeDishes++;
      if (!APPLY || !cat) continue;
      const p = await db.product.create({ data: { restaurantId: r.id, categoryId: cat.id, name, priceSom, isAvailable: available, position: di + 1 } });
      await db.catalogEvent.create({ data: { restaurantId: r.id, entity: 'PRODUCT', entityId: p.id, action: 'PRODUCT_CREATED', actorSessionId: ACTOR, after: { name, priceSom, isAvailable: available } } });
    }
  }
  log(`${r.name}: ${madeCats} new categories, ${madeDishes} new dishes, ${keptDishes} already there (kept)`);
  if (APPLY) await db.adminAuditEvent.create({ data: { actorId: ACTOR, action: 'MENU_IMPORT', targetType: 'Restaurant', targetId: r.id, details: { categories: madeCats, dishes: madeDishes, kept: keptDishes } } });
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
