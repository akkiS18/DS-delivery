import type { PublicPricing } from './types';

/**
 * Service fee prices, the TypeScript twin of src/modules/pricing/fee.ts (same exact integer maths; both run the same fixtures, see
 * tests/fee-fixtures.json). The app shows these prices while the customer edits the cart; the server re-prices at checkout and refuses
 * the order (NARX_OZGARGAN) if the two ever disagree, so this file can never make the customer pay a different amount.
 */
export const ROUND_SOM = 100;
const SCALE = 10_000n;

/** Nothing added to the menu prices (FLAT, or until the server's settings are known). */
/** LINE mode: the separate platform line the customer is charged (0 while the administrator has waived it). Same rule as the server's lineChargeSom. */
export const lineCharge = (p: PublicPricing): number => (p.mode === 'LINE' && !p.lineWaived ? p.lineSom ?? 0 : 0);
/** LINE mode with a line to show: charged, or crossed out when waived. */
export const lineShown = (p: PublicPricing): { somShown: number; waived: boolean } | null =>
  p.mode === 'LINE' && (p.lineSom ?? 0) > 0 ? { somShown: p.lineSom!, waived: p.lineWaived === true } : null;

export const FLAT_PRICING: PublicPricing = { mode: 'FLAT', percentBp: 1000, kneeSom: 50_000, lowBp: 1000, highBp: 300, milestonesSom: [] };

const feeScaled = (base: number, p: PublicPricing): bigint => {
  const b = BigInt(base);
  if (p.mode === 'PERCENT') return b * BigInt(p.percentBp);
  if (p.mode === 'TIERED') {
    const knee = BigInt(p.kneeSom);
    return b <= knee ? b * BigInt(p.lowBp) : knee * BigInt(p.lowBp) + (b - knee) * BigInt(p.highBp);
  }
  return 0n;
};

const roundToStep = (num: bigint, den: bigint): number => {
  const step = BigInt(ROUND_SOM);
  return Number(((2n * num + den * step) / (2n * den * step)) * step);
};
const ceilToStep = (som: number): number => Math.ceil(som / ROUND_SOM) * ROUND_SOM;

/** One unit's price when the basket is worth `base` som at the restaurant's own prices. */
export function unitPrice(baseUnitSom: number, base: number, p: PublicPricing): number {
  if (p.mode === 'FLAT' || p.mode === 'LINE' || base <= 0) return baseUnitSom;
  const d = BigInt(base) * SCALE;
  return Math.max(ceilToStep(baseUnitSom), roundToStep(BigInt(baseUnitSom) * (d + feeScaled(base, p)), d));
}

/** The price at the first rate: what a dish costs before the basket makes it cheaper. */
export function referenceUnitPrice(baseUnitSom: number, p: PublicPricing): number {
  if (p.mode === 'FLAT' || p.mode === 'LINE') return baseUnitSom;
  const bp = p.mode === 'PERCENT' ? p.percentBp : p.lowBp;
  return Math.max(ceilToStep(baseUnitSom), roundToStep(BigInt(baseUnitSom) * (SCALE + BigInt(bp)), SCALE));
}

export interface PricedLine { unitSom: number; referenceSom: number; subtotalSom: number }

/** Prices every line of a basket given as [restaurant price, quantity]. */
export function priceLines(lines: Array<{ priceSom: number; quantity: number }>, p: PublicPricing) {
  const base = lines.reduce((s, l) => s + l.priceSom * l.quantity, 0);
  const priced: PricedLine[] = lines.map(l => {
    const unitSom = unitPrice(l.priceSom, base, p);
    return { unitSom, referenceSom: Math.max(unitSom, referenceUnitPrice(l.priceSom, p)), subtotalSom: unitSom * l.quantity };
  });
  const dishesSom = priced.reduce((s, l) => s + l.subtotalSom, 0);
  const totalSom = dishesSom + (lines.length > 0 ? lineCharge(p) : 0);
  const savedSom = lines.reduce((s, l, i) => s + (priced[i]!.referenceSom - priced[i]!.unitSom) * l.quantity, 0);
  return { lines: priced, baseTotalSom: base, dishesSom, totalSom, savedSom };
}

/** Progress toward the next price drop (TIERED only). `ratio` fills the bar between the previous and the next station. */
export function feeProgress(base: number, p: PublicPricing): { remainingSom: number; ratio: number; first: boolean } | null {
  if (p.mode !== 'TIERED' || base <= 0 || p.milestonesSom.length === 0) return null;
  const next = p.milestonesSom.find(m => m > base);
  if (next === undefined) return null;
  const previous = [...p.milestonesSom].reverse().find(m => m <= base) ?? 0;
  return { remainingSom: next - base, ratio: Math.min(1, Math.max(0, (base - previous) / (next - previous))), first: previous === 0 };
}

/** True once the basket has passed the last station: the best prices the customer can get. */
export const atBestPrice = (base: number, p: PublicPricing): boolean =>
  p.mode === 'TIERED' && p.milestonesSom.length > 0 && base >= p.milestonesSom[p.milestonesSom.length - 1]!;

export const isPricing = (x: unknown): x is PublicPricing => {
  const p = x as PublicPricing;
  return !!p && ['FLAT', 'PERCENT', 'TIERED', 'LINE'].includes(p.mode) && [p.percentBp, p.kneeSom, p.lowBp, p.highBp].every(n => Number.isSafeInteger(n) && n >= 0)
    && (p.lineSom === undefined || (Number.isSafeInteger(p.lineSom) && p.lineSom >= 0)) && (p.lineWaived === undefined || typeof p.lineWaived === 'boolean')
    && Array.isArray(p.milestonesSom) && p.milestonesSom.every(n => Number.isSafeInteger(n) && n > 0);
};
