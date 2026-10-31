import { describe, expect, it } from 'vitest';
import { cartBase, cartReducer, cartTotal, cartView, emptyCart, loadCart, saveCart, STORAGE_KEY } from '../src/lib/cart';
import { atBestPrice, FLAT_PRICING, feeProgress, isPricing, lineCharge, lineShown, priceLines, referenceUnitPrice, unitPrice } from '../src/lib/fee';
import type { CartState, PublicPricing } from '../src/lib/types';
import fixtures from './fee-fixtures.json';

const cfg = (name: 'tiered' | 'percent'): PublicPricing => ({ ...fixtures[name], mode: fixtures[name].mode as PublicPricing['mode'], milestonesSom: [50_000, 100_000, 200_000] });
const TIERED = cfg('tiered');

describe('service fee prices (same fixtures as the server)', () => {
  it('reproduces every hand-checked basket', () => {
    for (const c of fixtures.cases) {
      const r = priceLines(c.lines.map(([priceSom, quantity]) => ({ priceSom: priceSom!, quantity: quantity! })), cfg(c.cfg as 'tiered' | 'percent'));
      expect(r.lines.map(l => l.unitSom)).toEqual(c.units);
      expect(r.totalSom).toBe(c.totalSom);
      expect(r.totalSom - r.baseTotalSom).toBe(c.feeSom);
    }
  });

  it('FLAT changes nothing', () => {
    const r = priceLines([{ priceSom: 12_345, quantity: 3 }], FLAT_PRICING);
    expect(r.totalSom).toBe(37_035);
    expect(r.savedSom).toBe(0);
  });

  it('a dish gets cheaper past the first station while the basket total keeps rising', () => {
    expect(referenceUnitPrice(10_000, TIERED)).toBe(11_000);
    expect(unitPrice(10_000, 40_000, TIERED)).toBe(11_000);
    expect(unitPrice(10_000, 100_000, TIERED)).toBe(10_700);
    let previous = 0;
    for (let b = 100; b <= 400_000; b += 100) {
      const total = priceLines([{ priceSom: b, quantity: 1 }], TIERED).totalSom;
      expect(total).toBeGreaterThanOrEqual(previous);
      previous = total;
    }
  });

  it('progress: only so‘m, never a percentage; the bar fills between stations', () => {
    expect(feeProgress(0, TIERED)).toBeNull();
    expect(feeProgress(20_000, TIERED)).toEqual({ remainingSom: 30_000, ratio: 0.4, first: true });
    expect(feeProgress(75_000, TIERED)).toEqual({ remainingSom: 25_000, ratio: 0.5, first: false });
    expect(feeProgress(250_000, TIERED)).toBeNull();
    expect(atBestPrice(250_000, TIERED)).toBe(true);
    expect(atBestPrice(20_000, TIERED)).toBe(false);
    expect(feeProgress(20_000, FLAT_PRICING)).toBeNull();
  });

  it('validates pricing read back from storage', () => {
    expect(isPricing(TIERED)).toBe(true);
    expect(isPricing({ ...TIERED, mode: 'WEIRD' })).toBe(false);
    expect(isPricing({ ...TIERED, milestonesSom: [-1] })).toBe(false);
    expect(isPricing(null)).toBe(false);
  });
});

describe('cart with the service fee', () => {
  const add = (s: CartState, id: string, price: number) => cartReducer(s, { type: 'add', restaurantId: 'r1', restaurantName: 'R', product: { id, name: id, priceSom: price } });

  it('keeps the restaurant price in the line and shows the fee-inclusive one', () => {
    let s = cartReducer(emptyCart(), { type: 'pricing', pricing: TIERED });
    s = add(add(add(s, 'osh', 25_000), 'osh', 25_000), 'lavash', 15_000);
    expect(s.lines.map(l => l.priceSom)).toEqual([25_000, 15_000]);
    expect(cartBase(s)).toBe(65_000);
    const v = cartView(s);
    expect(v.lines.map(l => l.unitSom)).toEqual([27_100, 16_300]);
    expect(v.totalSom).toBe(70_500);
    expect(cartTotal(s)).toBe(70_500);
    expect(v.savedSom).toBe((27_500 - 27_100) * 2 + (16_500 - 16_300));
  });

  it('emptying the cart keeps the pricing; switching restaurant keeps it too', () => {
    let s = cartReducer(emptyCart(), { type: 'pricing', pricing: TIERED });
    s = add(s, 'a', 10_000);
    expect(cartReducer(s, { type: 'clear' }).pricing).toEqual(TIERED);
    expect(cartReducer(s, { type: 'dec', productId: 'a' }).pricing).toEqual(TIERED);
    const other = cartReducer(s, { type: 'add', restaurantId: 'r2', restaurantName: 'Q', product: { id: 'b', name: 'b', priceSom: 5_000 } });
    expect(other.pricing).toEqual(TIERED);
    expect(other.lines).toHaveLength(1);
  });

  it('survives storage, and a corrupted pricing falls back to the plain menu prices', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const s = add(cartReducer(emptyCart(), { type: 'pricing', pricing: TIERED }), 'a', 10_000);
    saveCart(storage, s);
    expect(loadCart(storage).pricing).toEqual(TIERED);
    store.set(STORAGE_KEY, JSON.stringify({ ...s, pricing: { mode: 'TIERED' } }));
    const loaded = loadCart(storage);
    expect(loaded.pricing).toBeUndefined();
    expect(cartTotal(loaded)).toBe(10_000);
  });

  it('a repeated identical pricing does not change the state object (no render loop)', () => {
    const s = cartReducer(emptyCart(), { type: 'pricing', pricing: TIERED });
    expect(cartReducer(s, { type: 'pricing', pricing: { ...TIERED } })).toBe(s);
  });
});

describe('LINE mode: a separate platform line (same maths as the server)', () => {
  const LINE: PublicPricing = { ...FLAT_PRICING, mode: 'LINE', lineSom: 5000, lineWaived: false };
  it('keeps the menu prices and adds the line to the total', () => {
    const r = priceLines([{ priceSom: 12_345, quantity: 3 }, { priceSom: 999, quantity: 1 }], LINE);
    expect(r.lines.map(l => l.unitSom)).toEqual([12_345, 999]);
    expect([r.baseTotalSom, r.dishesSom, r.totalSom]).toEqual([38_034, 38_034, 43_034]);
    expect(r.savedSom).toBe(0);
  });
  it('waived: shown crossed out but nothing is added', () => {
    const waived = { ...LINE, lineWaived: true };
    expect(priceLines([{ priceSom: 12_345, quantity: 3 }], waived).totalSom).toBe(37_035);
    expect(lineShown(waived)).toEqual({ somShown: 5000, waived: true });
    expect(lineShown(LINE)).toEqual({ somShown: 5000, waived: false });
    expect(lineShown(FLAT_PRICING)).toBeNull();
    expect(lineCharge(waived)).toBe(0);
    expect(lineCharge(LINE)).toBe(5000);
  });
  it('an empty basket costs nothing; stored pricing is validated', () => {
    expect(priceLines([], LINE).totalSom).toBe(0);
    expect(isPricing(LINE)).toBe(true);
    expect(isPricing({ ...LINE, lineSom: -1 })).toBe(false);
    expect(isPricing({ ...LINE, lineWaived: 'yes' })).toBe(false);
  });
});
