import { db } from '../lib/db.js';

/**
 * Owner request 2026-11-22: Asl Market (slug asl-market) drinks, prices typed by the owner in chat. Pictures come later.
 * Order: by popularity, NOT alphabetical (owner's words). The owner gave no ranking, so this one is my estimate:
 * the big Coca-Cola / Pepsi / Fanta bottles (1.5 L, 1 L) first, then 0.5 L and 2 L, then cans and the bigger Fanta, energy drinks last.
 * The menu shows a group's dishes by Product.position (src/modules/miniapp/views.ts), so the shop can reorder them in its app later.
 * "FREEZ MIX" 275 ml came without a price and is NOT added.
 * Idempotent: a dish that already exists (same name) is kept as it is. Prints the plan unless --apply is given.
 * No release needed: streamed into the prod container like seed-asl-market-sweets-2026-11.ts, then
 *   node /tmp/asl-tool/seed-asl-market-drinks-2026-11.js [--apply]
 */
const APPLY = process.argv.includes('--apply');
const ACTOR = 'owner-menu-import-20261122';
const SLUG = 'asl-market';
const CATEGORY = 'Ichimliklar';
const log = (msg: string): void => console.log(`${APPLY ? '[APPLY]' : '[PLAN] '} ${msg}`);

/** Most popular first; the index + 1 becomes Product.position. */
const DRINKS: Array<[name: string, priceSom: number]> = [
  ['Coca-Cola 1.5 L', 14_000],
  ['Coca-Cola 1 L', 12_000],
  ['Pepsi 1.5 L', 14_000],
  ['Coca-Cola 0.5 L', 8_000],
  ['Fanta 1.5 L', 14_000],
  ['Pepsi 1 L', 12_000],
  ['Coca-Cola 2 L', 19_000],
  ['Pepsi 0.5 L', 8_000],
  ['Fanta 1 L', 12_000],
  ['Pepsi 2 L', 19_000],
  ['Fanta 0.5 L', 8_000],
  ['Coca-Cola 0.25 L (banka)', 6_000],
  ['Pepsi 0.45 L (banka)', 9_000],
  ['Fanta 2.5 L', 19_000],
  ['Fanta 0.25 L (banka)', 6_000],
  ['Energetik ichimlik "Aligator" 0.25 L', 16_000],
  ['Energetik ichimlik "Cannabis" 0.33 L', 23_000],
];

async function main(): Promise<void> {
  const r = await db.restaurant.findUnique({ where: { slug: SLUG }, select: { id: true, name: true, isPaused: true } });
  if (!r) { log(`no restaurant with slug "${SLUG}": nothing written`); return; }
  log(`${r.name}: paused=${r.isPaused}`);
  let cat = await db.category.findFirst({ where: { restaurantId: r.id, name: CATEGORY }, select: { id: true } });
  if (!cat) {
    const position = ((await db.category.aggregate({ where: { restaurantId: r.id }, _max: { position: true } }))._max.position ?? -1) + 1;
    log(`group "${CATEGORY}" at position ${position} (${DRINKS.length} drinks)`);
    if (APPLY) cat = await db.category.create({ data: { restaurantId: r.id, name: CATEGORY, position }, select: { id: true } });
  }
  let made = 0; let kept = 0;
  for (const [i, [name, priceSom]] of DRINKS.entries()) {
    // Names are unique per restaurant (case-insensitive), so look in every group.
    const exists = await db.product.findFirst({ where: { restaurantId: r.id, name: { equals: name, mode: 'insensitive' }, archivedAt: null }, select: { id: true } });
    if (exists) { kept++; continue; }
    made++;
    log(`   ${i + 1}. ${name} — ${priceSom.toLocaleString('ru-RU')} so‘m`);
    if (!APPLY || !cat) continue;
    const p = await db.product.create({ data: { restaurantId: r.id, categoryId: cat.id, name, priceSom, position: i + 1 } });
    await db.catalogEvent.create({ data: { restaurantId: r.id, entity: 'PRODUCT', entityId: p.id, action: 'PRODUCT_CREATED', actorSessionId: ACTOR, after: { name, priceSom } } });
  }
  log(`${r.name}: ${made} new drinks, ${kept} already there (kept)`);
  if (APPLY) await db.adminAuditEvent.create({ data: { actorId: ACTOR, action: 'MENU_IMPORT', targetType: 'Restaurant', targetId: r.id, details: { category: CATEGORY, dishes: made, kept } } });
  if (!APPLY) console.log('Nothing written. Add --apply to write.');
}

main().catch(e => { console.error('[FAILED]', e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => db.$disconnect());
