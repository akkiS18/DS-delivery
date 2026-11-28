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
 * Owner request 2026-11-28 (Bobosher): packaging may come in sizes that hold several portions (3 osh = 5 000, 6 osh = 10 000). The customer
 * never picks them: `containersFor` chooses the cheapest set of sizes that holds every portion, then the fewest containers. A twin lives in
 * apps/customer-miniapp/src/lib/promo.ts; both run packaging-fixtures.json (kept identical).
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

/** A packaging size: how many portions one unit holds and what it costs (the restaurant's own price). */
export interface PackSize { id: string; capacity: number; priceSom: number }

/**
 * Containers for `portions` portions: the cheapest set of sizes that holds them all; equal cost -> the fewest containers; still equal -> the
 * bigger size first (sizes are tried biggest first, ties by id, and only a strictly better choice replaces one already found). Sizes with a
 * capacity below 1 or a negative price are ignored. No usable size, or no portions -> nothing.
 * Bobosher (3 = 5 000, 6 = 10 000): one big per full 6, a remainder of 1-3 gets a small one and 4-5 a big one; the cost is ceil(n / 3) x 5 000.
 */
export function containersFor(portions: number, sizes: PackSize[]): Map<string, number> {
  const out = new Map<string, number>();
  const usable = sizes.filter(s => Number.isSafeInteger(s.capacity) && s.capacity >= 1 && Number.isSafeInteger(s.priceSom) && s.priceSom >= 0)
    .sort((a, b) => b.capacity - a.capacity || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!Number.isSafeInteger(portions) || portions <= 0 || usable.length === 0) return out;
  // best[i] = the cheapest way to hold at least i portions; `size` is the last container added, `from` what it was added to.
  const best: Array<{ cost: number; count: number; size: number; from: number }> = [{ cost: 0, count: 0, size: -1, from: -1 }];
  for (let i = 1; i <= portions; i++) {
    let pick: { cost: number; count: number; size: number; from: number } | null = null;
    usable.forEach((s, k) => {
      const from = Math.max(0, i - s.capacity);
      const cost = best[from]!.cost + s.priceSom;
      const count = best[from]!.count + 1;
      if (!pick || cost < pick.cost || (cost === pick.cost && count < pick.count)) pick = { cost, count, size: k, from };
    });
    best.push(pick!);
  }
  for (let i = portions; i > 0; i = best[i]!.from) {
    const id = usable[best[i]!.size]!.id;
    out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

/**
 * Packaging units a basket needs. Every dish unit is one portion of its packaging (the dish links to the base packaging; several dishes may
 * share it). Without `sizes` for a base (or `sizes` not given at all): one base unit per dish unit, as before. With them: `containersFor`
 * over the base's sizes that can be sold now (an empty list = nothing is added). The result is keyed by the packaging product actually used.
 */
export function packagingUnits(lines: Array<{ quantity: number; packagingProductId: string | null }>, sizes?: ReadonlyMap<string, PackSize[]>): Map<string, number> {
  const portions = new Map<string, number>();
  for (const l of lines) if (l.packagingProductId) portions.set(l.packagingProductId, (portions.get(l.packagingProductId) ?? 0) + l.quantity);
  if (!sizes) return portions;
  const out = new Map<string, number>();
  for (const [base, n] of portions) {
    const family = sizes.get(base);
    const units = family ? containersFor(n, family) : new Map([[base, n]]);
    for (const [id, q] of units) out.set(id, (out.get(id) ?? 0) + q);
  }
  return out;
}

/** The size the menu shows on the dish (and an app built before sizes charges per dish unit): the base when on sale, else the smallest size on sale. */
export function headlineSize<S extends PackSize>(base: string, family: S[]): S | null {
  return family.find(s => s.id === base) ?? [...family].sort((a, b) => a.capacity - b.capacity || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0] ?? null;
}
