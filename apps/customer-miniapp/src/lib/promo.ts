/**
 * 1+1 promotions, the TypeScript twin of src/modules/promotions/rules.ts (same rules, same fixtures: tests/promo-fixtures.json mirrors
 * src/modules/promotions/fixtures.json). The app uses it to show the free unit while the customer edits the cart; the server decides at checkout
 * and refuses the order (NARX_OZGARGAN) if the two ever disagree.
 *
 * Of every two units of a promotion's products the CHEAPER one is free (units sorted dearest first, paired in that order; an odd last unit is paid).
 * `maxFreePerOrder` caps the free units of one order. The restaurant bears the cost; the platform line is shown crossed out on such an order.
 */
export interface PromoDef { id: string; title?: string; maxFreePerOrder: number | null; productIds: string[] }
export interface PromoLine { productId: string; baseUnitSom: number; quantity: number }

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
    units.sort((a, b) => b.price - a.price || (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
    let pairs = Math.floor(units.length / 2);
    if (promo.maxFreePerOrder !== null) pairs = Math.min(pairs, promo.maxFreePerOrder);
    for (let i = 0; i < pairs; i++) {
      const u = units[2 * i + 1]!;
      free.set(u.productId, (free.get(u.productId) ?? 0) + 1);
    }
    for (const [productId, r] of remaining) if (set.has(productId)) remaining.set(productId, { price: r.price, qty: 0 });
  }
  return free;
}

export const isPromoDef = (x: unknown): x is PromoDef => {
  const p = x as PromoDef;
  return !!p && typeof p.id === 'string' && (p.maxFreePerOrder === null || Number.isSafeInteger(p.maxFreePerOrder)) && Array.isArray(p.productIds) && p.productIds.every(i => typeof i === 'string');
};

/**
 * Packaging sizes, the twin of containersFor in src/modules/promotions/rules.ts (same fixtures: tests/packaging-fixtures.json mirrors
 * src/modules/promotions/packaging-fixtures.json). Owner request 2026-11-28 (Bobosher): a small container holds 3 osh (5 000), a big one 6
 * (10 000); the customer never picks them. The cheapest set that holds every portion wins, then the fewest containers, then the bigger size.
 */
export interface PackSize { id: string; capacity: number; priceSom: number }
export function containersFor(portions: number, sizes: PackSize[]): Map<string, number> {
  const out = new Map<string, number>();
  const usable = sizes.filter(s => Number.isSafeInteger(s.capacity) && s.capacity >= 1 && Number.isSafeInteger(s.priceSom) && s.priceSom >= 0)
    .sort((a, b) => b.capacity - a.capacity || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!Number.isSafeInteger(portions) || portions <= 0 || usable.length === 0) return out;
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
