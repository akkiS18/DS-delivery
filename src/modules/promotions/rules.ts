/**
 * 1+1 promotions and dish packaging, pure rules (no I/O). The customer app has a TypeScript twin (apps/customer-miniapp/src/lib/promo.ts);
 * both run src/modules/promotions/fixtures.json / apps/customer-miniapp/tests/promo-fixtures.json (kept identical).
 *
 * Owner decisions 2026-11-01:
 *  - 1+1: of every pair of units of a promotion's products the CHEAPER one is free (the free unit may be another product of the same promotion).
 *    Units are sorted by price, dearest first, and paired in that order; an odd last unit is paid. `maxFreePerOrder` (optional) caps the free units
 *    of one order (the first pairs, i.e. the dearest ones, keep the offer).
 *  - The restaurant bears the cost; the platform takes nothing from an order that contains a free unit (the platform line is shown crossed out).
 *  - Packaging ("soboy idishi"): one packaging unit per unit of a dish that has one.
 */
export interface PromoDef { id: string; maxFreePerOrder: number | null; productIds: string[] }
export interface PromoLine { productId: string; baseUnitSom: number; quantity: number }

/** Free units per product id (only products with at least one free unit appear). Each unit belongs to at most one promotion (the first listed wins). */
export function freeUnits(lines: PromoLine[], promos: PromoDef[]): Map<string, number> {
  const remaining = new Map<string, { price: number; qty: number }>();
  for (const l of lines) {
    const cur = remaining.get(l.productId);
    remaining.set(l.productId, { price: l.baseUnitSom, qty: (cur?.qty ?? 0) + l.quantity });
  }
  const free = new Map<string, number>();
  for (const promo of promos) {
    const set = new Set(promo.productIds);
    const units: Array<{ productId: string; price: number }> = [];
    for (const [productId, r] of remaining) if (set.has(productId)) for (let i = 0; i < r.qty; i++) units.push({ productId, price: r.price });
    // dearest first; ties by product id so the result never depends on map order
    units.sort((a, b) => b.price - a.price || (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
    let pairs = Math.floor(units.length / 2);
    if (promo.maxFreePerOrder !== null) pairs = Math.min(pairs, promo.maxFreePerOrder);
    for (let i = 0; i < pairs; i++) {
      const u = units[2 * i + 1]!;
      free.set(u.productId, (free.get(u.productId) ?? 0) + 1);
    }
    // the units this promotion looked at are spent (paired ones and the odd one), so another promotion cannot give them away again
    for (const [productId, r] of remaining) if (set.has(productId)) remaining.set(productId, { price: r.price, qty: 0 });
  }
  return free;
}

/** Packaging units a basket needs: one per unit of every dish that has packaging. Several dishes may share one packaging product. */
export function packagingUnits(lines: Array<{ quantity: number; packagingProductId: string | null }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) if (l.packagingProductId) out.set(l.packagingProductId, (out.get(l.packagingProductId) ?? 0) + l.quantity);
  return out;
}
