import { describe, expect, it } from 'vitest';
import { cartReducer, cartView, emptyCart, loadCart, saveCart } from '../src/lib/cart';
import { freeUnits, type PromoDef, type PromoLine } from '../src/lib/promo';
import type { CartState, PublicPricing } from '../src/lib/types';
import fixtures from './promo-fixtures.json';

const LINE: PublicPricing = { mode: 'LINE', percentBp: 1000, kneeSom: 50_000, lowBp: 1000, highBp: 300, milestonesSom: [], lineSom: 5000, lineWaived: false };
const box = { id: 'box', name: 'Soboy idishi', priceSom: 5000 };

describe('1+1 (same fixtures as the server)', () => {
  for (const f of fixtures as Array<{ name: string; promos: PromoDef[]; lines: PromoLine[]; free: Record<string, number> }>) {
    it(f.name, () => expect(Object.fromEntries(freeUnits(f.lines, f.promos))).toEqual(f.free));
  }
});

describe('cart with packaging and 1+1', () => {
  const osh: CartState = { restaurantId: 'r', restaurantName: 'Bobosher', lines: [{ productId: 'osh', name: 'Osh', priceSom: 35_000, quantity: 2, packaging: box }], pricing: { ...LINE, mode: 'FLAT' } };

  it('adds one packaging unit per dish unit as its own line and counts it in the total', () => {
    const v = cartView(osh);
    expect(v.extras).toEqual([{ productId: 'box', name: 'Soboy idishi', quantity: 2, unitSom: 5000, subtotalSom: 10_000 }]);
    expect(v.dishesSom).toBe(70_000 + 10_000);
    expect(v.totalSom).toBe(80_000);
  });

  it('the packaging follows the dish quantity and disappears with the dish', () => {
    let c = cartReducer(emptyCart(), { type: 'add', restaurantId: 'r', restaurantName: 'B', product: { id: 'osh', name: 'Osh', priceSom: 35_000, packaging: box } });
    expect(cartView(c).extras[0]!.quantity).toBe(1);
    c = cartReducer(c, { type: 'inc', productId: 'osh' });
    expect(cartView(c).extras[0]!.quantity).toBe(2);
    c = cartReducer(cartReducer(c, { type: 'dec', productId: 'osh' }), { type: 'dec', productId: 'osh' });
    expect(c.lines).toEqual([]);
    expect(cartView(c).extras).toEqual([]);
  });

  it('a dish without packaging adds nothing', () => {
    const v = cartView({ ...osh, lines: [{ productId: 'x', name: 'X', priceSom: 10_000, quantity: 3 }] });
    expect(v.extras).toEqual([]);
    expect(v.totalSom).toBe(30_000);
  });

  const lavash: CartState = {
    restaurantId: 'r', restaurantName: 'Sifat', pricing: LINE,
    promos: [{ id: 'p', maxFreePerOrder: null, productIds: ['l1', 'l2'] }],
    lines: [{ productId: 'l1', name: 'LAVASH KATTA', priceSom: 43_000, quantity: 1 }, { productId: 'l2', name: 'LAVASH O\'RTACHA', priceSom: 33_000, quantity: 1 }],
  };

  it('1+1: the cheaper of the pair is free, the platform line is waived (crossed out), the restaurant carries it', () => {
    const v = cartView(lavash);
    expect(v.lines.map(l => l.freeQty)).toEqual([0, 1]);
    expect(v.promoSavedSom).toBe(33_000);
    expect(v.dishesSom).toBe(43_000);
    expect(v.pricing.lineWaived).toBe(true);
    expect(v.totalSom).toBe(43_000); // no platform line charged
  });

  it('without a free unit the platform line is charged as before', () => {
    const v = cartView({ ...lavash, lines: [lavash.lines[0]!] });
    expect(v.pricing.lineWaived).toBe(false);
    expect(v.totalSom).toBe(48_000);
  });

  it('the catalog action syncs promos and packaging, and ignores another restaurant', () => {
    const base: CartState = { restaurantId: 'r', restaurantName: 'B', lines: [{ productId: 'osh', name: 'Osh', priceSom: 35_000, quantity: 1 }] };
    const synced = cartReducer(base, { type: 'catalog', restaurantId: 'r', promos: [], packaging: { osh: box } });
    expect(synced.lines[0]!.packaging).toEqual(box);
    expect(cartReducer(base, { type: 'catalog', restaurantId: 'other', promos: [], packaging: { osh: box } })).toBe(base);
    const gone = cartReducer(synced, { type: 'catalog', restaurantId: 'r', promos: [], packaging: { osh: null } });
    expect(gone.lines[0]!.packaging).toBeUndefined();
  });

  it('survives a save/load round trip', () => {
    const store = new Map<string, string>();
    saveCart({ setItem: (k, v) => void store.set(k, v), removeItem: k => void store.delete(k) }, lavash);
    const back = loadCart({ getItem: k => store.get(k) ?? null });
    expect(back.promos).toEqual(lavash.promos);
    expect(cartView(back).totalSom).toBe(43_000);
  });
});
