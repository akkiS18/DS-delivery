import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../lib/db.js';

/**
 * Owner request 2026-11-28 (Bobosher Osh): the takeaway container comes in two sizes and the program adds them by the number of osh:
 * a small one holds 3 osh (5 000 so'm), a big one holds 6 osh (10 000 so'm). The customer never adds them.
 *
 * Turns it on for ONE restaurant (default bobosher-osh), idempotent, prints the plan unless --apply is given:
 *  - the packaging the restaurant's dishes link to (exactly one is expected) becomes "Soboy idish (3 osh)", 5 000, capacity 3;
 *  - a second packaging "Soboy idish (6 osh)", 10 000, capacity 6, is created as its bigger size (or updated when it exists).
 * Each container gets its icon (prisma/seed-assets/soboy-idish-{kichik,katta}.png, drawn by docs/icons/soboy-idish-icons.mjs): set when it has
 * no picture; a picture the restaurant set itself is kept unless --force-image.
 * --off turns it back to the old rule (capacity cleared on the base, the bigger size switched off); names and prices stay.
 * Every change is written to CatalogEvent (actor below). Run on the server:
 *   docker exec ds-prod-backend-1 node dist/src/tools/packaging-sizes-2026-11.js [bobosher-osh] [--apply] [--off] [--force-image]
 */
const APPLY = process.argv.includes('--apply');
const OFF = process.argv.includes('--off');
const SLUG = process.argv.slice(2).find(a => !a.startsWith('--')) ?? 'bobosher-osh';
const ACTOR = 'owner-packaging-sizes-20261128';
const FORCE_IMAGE = process.argv.includes('--force-image');
const SMALL = { name: 'Soboy idish (3 osh)', priceSom: 5000, capacity: 3, icon: 'soboy-idish-kichik.png' };
const BIG = { name: 'Soboy idish (6 osh)', priceSom: 10_000, capacity: 6, icon: 'soboy-idish-katta.png' };
const log = (msg: string): void => console.log(`${APPLY ? '[APPLY]' : '[PLAN] '} ${msg}`);

type Row = { id: string; name: string; priceSom: number; isAvailable: boolean; packagingCapacity: number | null; packagingBaseId: string | null };
const pick = { id: true, name: true, priceSom: true, isAvailable: true, packagingCapacity: true, packagingBaseId: true } as const;
const snap = (p: Row) => ({ name: p.name, priceSom: p.priceSom, isAvailable: p.isAvailable, packagingCapacity: p.packagingCapacity, packagingBaseId: p.packagingBaseId });

async function change(restaurantId: string, before: Row, data: Partial<Omit<Row, 'id'>>): Promise<void> {
  const keys = (Object.keys(data) as Array<keyof typeof data>).filter(k => data[k] !== before[k]);
  if (!keys.length) { log(`"${before.name}": already as wanted, kept`); return; }
  log(`"${before.name}": ${keys.map(k => `${k} ${JSON.stringify(before[k])} -> ${JSON.stringify(data[k])}`).join(', ')}`);
  if (!APPLY) return;
  await db.$transaction(async tx => {
    const after = await tx.product.update({ where: { id: before.id }, data: { ...data, version: { increment: 1 } }, select: pick });
    await tx.catalogEvent.create({ data: { restaurantId, entity: 'PRODUCT', entityId: before.id, action: 'PRODUCT_UPDATED', actorSessionId: ACTOR, before: snap(before), after: snap(after) } });
  });
}

/** Sets the container's icon (PNG, transparent background) unless it already has it, or has a picture of its own and --force-image is not given. */
async function icon(restaurantId: string, productId: string, label: string, file: string): Promise<void> {
  const data = readFileSync(resolve(process.cwd(), 'prisma/seed-assets', file));
  const sha256 = createHash('sha256').update(data).digest('hex');
  const cur = await db.productImage.findUnique({ where: { productId }, select: { sha256: true, version: true } });
  if (cur?.sha256 === sha256) { log(`"${label}": icon already set, kept`); return; }
  if (cur && !FORCE_IMAGE) { log(`"${label}": has its own picture (version ${cur.version}), kept (--force-image replaces it)`); return; }
  log(`"${label}": icon ${file} (${data.length} bytes)${cur ? ` replaces version ${cur.version}` : ''}`);
  if (!APPLY) return;
  const version = (cur?.version ?? 0) + 1;
  const img = { mime: 'image/png', data: Uint8Array.from(data), sha256 };
  await db.$transaction(async tx => {
    await tx.productImage.upsert({ where: { productId }, create: { productId, ...img, version }, update: { ...img, version } });
    await tx.catalogEvent.create({ data: { restaurantId, entity: 'PRODUCT', entityId: productId, action: 'PRODUCT_IMAGE_SET', actorSessionId: ACTOR, after: { source: `prisma/seed-assets/${file} (drawn icon)`, version } } });
  });
}

async function main(): Promise<void> {
  const r = await db.restaurant.findUnique({ where: { slug: SLUG }, select: { id: true, name: true } });
  if (!r) throw new Error(`restaurant ${SLUG} not found`);
  const linked = await db.product.findMany({ where: { restaurantId: r.id, isPackaging: false, archivedAt: null, packagingProductId: { not: null } }, select: { name: true, packagingProductId: true } });
  const baseIds = [...new Set(linked.map(d => d.packagingProductId!))];
  if (baseIds.length !== 1) throw new Error(`${r.name}: expected the dishes to share exactly one packaging, found ${baseIds.length} (${linked.map(d => d.name).join(', ') || 'no dish with packaging'})`);
  const base = await db.product.findFirst({ where: { id: baseIds[0]!, restaurantId: r.id, isPackaging: true, archivedAt: null }, select: pick });
  if (!base) throw new Error(`${r.name}: the linked packaging is missing, archived or not a packaging product`);
  log(`${r.name}: dishes with packaging: ${linked.map(d => d.name).join(', ')}; base packaging "${base.name}"`);
  const bigger = await db.product.findMany({ where: { restaurantId: r.id, isPackaging: true, archivedAt: null, packagingBaseId: base.id }, select: pick, orderBy: { createdAt: 'asc' } });

  if (OFF) {
    await change(r.id, base, { packagingCapacity: null });
    for (const b of bigger) await change(r.id, b, { isAvailable: false });
    return;
  }
  await change(r.id, base, { name: SMALL.name, priceSom: SMALL.priceSom, packagingCapacity: SMALL.capacity, isAvailable: true });
  await icon(r.id, base.id, SMALL.name, SMALL.icon);
  let big: { id: string } | undefined = bigger.find(b => b.packagingCapacity === BIG.capacity) ?? bigger[0];
  if (big) await change(r.id, bigger.find(b => b.id === big!.id)!, { name: BIG.name, priceSom: BIG.priceSom, packagingCapacity: BIG.capacity, isAvailable: true });
  else {
    log(`${r.name}: create "${BIG.name}" ${BIG.priceSom} (capacity ${BIG.capacity}, bigger size of "${SMALL.name}")`);
    if (!APPLY) { log(`"${BIG.name}": icon ${BIG.icon} (set when created)`); return; }
    big = await db.$transaction(async tx => {
      const p = await tx.product.create({ data: { restaurantId: r.id, name: BIG.name, priceSom: BIG.priceSom, isPackaging: true, packagingCapacity: BIG.capacity, packagingBaseId: base.id }, select: pick });
      await tx.catalogEvent.create({ data: { restaurantId: r.id, entity: 'PRODUCT', entityId: p.id, action: 'PRODUCT_CREATED', actorSessionId: ACTOR, after: { ...snap(p), isPackaging: true } } });
      return p;
    });
  }
  await icon(r.id, big.id, BIG.name, BIG.icon);
}

try {
  await main();
  if (!APPLY) console.log('Nothing written. Add --apply to write.');
} catch (err) {
  console.error('[FAILED]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
