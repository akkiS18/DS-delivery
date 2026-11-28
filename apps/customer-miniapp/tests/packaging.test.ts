import { describe, expect, it } from 'vitest';
import { cartReducer, cartView, loadCart, saveCart } from '../src/lib/cart';
import { containersFor, type PackSize } from '../src/lib/promo';
import type { CartState, Packaging } from '../src/lib/types';
import fixtures from './packaging-fixtures.json';

// Owner request 2026-11-28 (Bobosher): "Soboy idish" by size, picked by the app with the server's rule (same fixtures as the server).
describe('packaging sizes (same fixtures as the server)', () => {
  for (const f of fixtures as Array<{ name: string; portions: number; sizes: PackSize[]; units: Record<string, number> }>) {
    it(f.name, () => expect(Object.fromEntries(containersFor(f.portions, f.sizes))).toEqual(f.units));
  }
});

const sized: Packaging = {
  id: 'small', name: 'Soboy idish (3 osh)', priceSom: 5000,
  sizes: [{ id: 'small', name: 'Soboy idish (3 osh)', priceSom: 5000, capacity: 3 }, { id: 'big', name: 'Soboy idish (6 osh)', priceSom: 10_000, capacity: 6 }],
};
const cart = (quantity: number, extra: CartState['lines'] = []): CartState => ({
  restaurantId: 'r', restaurantName: 'Bobosher', lines: [{ productId: 'osh', name: 'Osh', priceSom: 35_000, quantity, packaging: sized }, ...extra],
  pricing: { mode: 'FLAT', percentBp: 1000, kneeSom: 50_000, lowBp: 1000, highBp: 300, milestonesSom: [], lineSom: 5000, lineWaived: false },
});

describe('cart with sized packaging', () => {
  it('2 osh: one small container (5 000), not two', () => {
    const v = cartView(cart(2));
    expect(v.extras.map(x => [x.productId, x.quantity, x.subtotalSom, x.sized])).toEqual([['small', 1, 5000, true]]);
    expect(v.totalSom).toBe(70_000 + 5000);
  });
  it('5 osh: one big container; 7 osh: one big and one small', () => {
    expect(cartView(cart(5)).extras.map(x => [x.name, x.quantity])).toEqual([['Soboy idish (6 osh)', 1]]);
    const seven = cartView(cart(7));
    expect(Object.fromEntries(seven.extras.map(x => [x.productId, x.quantity]))).toEqual({ big: 1, small: 1 });
    expect(seven.totalSom).toBe(7 * 35_000 + 15_000);
  });
  it('dishes that share the packaging are counted together', () => {
    const v = cartView(cart(2, [{ productId: 'osh2', name: 'To‘y oshi', priceSom: 40_000, quantity: 2, packaging: sized }]));
    expect(v.extras.map(x => [x.productId, x.quantity])).toEqual([['big', 1]]);
  });
  it('a packaging without sizes keeps one per dish unit', () => {
    const v = cartView({ ...cart(3), lines: [{ productId: 'osh', name: 'Osh', priceSom: 30_000, quantity: 3, packaging: { id: 'box', name: 'Soboy idishi', priceSom: 3000 } }] });
    expect(v.extras.map(x => [x.productId, x.quantity, x.sized])).toEqual([['box', 3, false]]);
  });
  it('the sizes survive the saved cart and the catalog sync', () => {
    const store = new Map<string, string>();
    saveCart({ setItem: (k: string, v: string) => store.set(k, v), removeItem: () => {} }, cart(4));
    const back = loadCart({ getItem: k => store.get(k) ?? null });
    expect(back.lines[0]!.packaging).toEqual(sized);
    const synced = cartReducer({ ...cart(4), lines: [{ ...cart(4).lines[0]!, packaging: { id: 'small', name: 'Soboy idishi', priceSom: 5000 } }] },
      { type: 'catalog', restaurantId: 'r', promos: [], packaging: { osh: sized } });
    expect(synced.lines[0]!.packaging).toEqual(sized);
  });
});
