import { db } from '../lib/db.js';
import { deleteCategory } from '../modules/restaurant-catalog/service.js';

/**
 * Owner request 2026-11-22: Asl Market has no "Konfetlar" group any more; Raffaello 150 g and Ferrero Collection go to "Shokoladlar"
 * (after its own dishes, in that order). Uses the restaurant app's own delete-with-reassign (deleteCategory), so the catalog event is the same.
 * Prints the plan unless --apply is given; a second run finds no "Konfetlar" and changes nothing.
 * After this, seed-asl-market-sweets-2026-11.ts must NOT be run again (it would make "Konfetlar" anew and stop on the unique dish names).
 * No release needed: streamed into the prod container (imports rewritten to /app paths), then
 *   node /tmp/asl-tool/asl-market-fold-konfetlar-2026-11-22.js [--apply]
 */
const APPLY = process.argv.includes('--apply');
const ACTOR = 'owner-menu-edit-20261122';
const SLUG = 'asl-market';
const log = (msg: string): void => console.log(`${APPLY ? '[APPLY]' : '[PLAN] '} ${msg}`);

async function main(): Promise<void> {
  const r = await db.restaurant.findUnique({ where: { slug: SLUG }, select: { id: true, name: true } });
  if (!r) { log(`no restaurant with slug "${SLUG}": nothing written`); return; }
  const from = await db.category.findFirst({ where: { restaurantId: r.id, name: 'Konfetlar' }, select: { id: true } });
  const to = await db.category.findFirst({ where: { restaurantId: r.id, name: 'Shokoladlar' }, select: { id: true } });
  if (!to) throw new Error('no "Shokoladlar" group');
  if (!from) { log('no "Konfetlar" group: nothing to do'); return; }

  const moving = await db.product.findMany({ where: { categoryId: from.id, archivedAt: null }, orderBy: [{ position: 'asc' }, { name: 'asc' }], select: { id: true, name: true } });
  const maxPos = (await db.product.aggregate({ where: { categoryId: to.id, archivedAt: null }, _max: { position: true } }))._max.position ?? 0;
  for (const [i, p] of moving.entries()) log(`"${p.name}": Konfetlar -> Shokoladlar, position ${maxPos + 1 + i}`);
  log('group "Konfetlar": delete');
  if (!APPLY) { console.log('Nothing written. Add --apply to write.'); return; }

  await deleteCategory(r.id, ACTOR, from.id, to.id);
  for (const [i, p] of moving.entries()) await db.product.update({ where: { id: p.id }, data: { position: maxPos + 1 + i } });
  await db.adminAuditEvent.create({ data: { actorId: ACTOR, action: 'MENU_EDIT', targetType: 'Restaurant', targetId: r.id, details: { deletedCategory: 'Konfetlar', movedTo: 'Shokoladlar', products: moving.map(p => p.name) } } });
  log(`${moving.length} dishes moved, "Konfetlar" deleted`);
}

main().catch(e => { console.error('[FAILED]', e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => db.$disconnect());
