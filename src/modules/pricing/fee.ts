/**
 * Platform service fee, pure rules (no I/O). The customer is shown flat, rounded dish prices that already contain the fee;
 * the restaurant keeps its own menu price (base) and the platform's share is the difference.
 *
 *  FLAT    legacy: the customer pays the menu prices, the platform takes DEFAULT_COMMISSION_SOM from the restaurant (commission/rules.ts).
 *  PERCENT one percentage of the basket, baked into every dish price.
 *  LINE    owner decision 2026-10-31: dish prices stay the restaurant's own; the customer sees ONE separate line "Platforma xizmati" (lineSom, default 5 000)
 *          added to the total. When the administrator waives it (lineWaived) the line is shown crossed out as a discount and nothing is added or owed.
 *  TIERED  10% up to `kneeSom`, then `highBp` of the part above it. The fee never decreases while the basket grows, only its percentage
 *          does, so each dish gets cheaper as the order grows ("discount" effect) while the total keeps rising.
 *
 * Exact integer maths: the basket's fee is held as fee * 10_000 and every unit price is round_to_100(base * (B + fee) / B).
 * The client has a TypeScript port of this file (apps/customer-miniapp/src/lib/fee.ts); both run the same fixtures
 * (src/modules/pricing/fixtures.json and apps/customer-miniapp/tests/fee-fixtures.json must stay identical).
 */
export type FeeMode = 'FLAT' | 'PERCENT' | 'TIERED' | 'LINE';
export const FEE_MODES: readonly FeeMode[] = ['FLAT', 'PERCENT', 'TIERED', 'LINE'];

export interface FeeConfig {
  mode: FeeMode;
  /** PERCENT: the percentage in basis points (1000 = 10%). */
  percentBp: number;
  /** TIERED: the basket size where the rate changes, the rate below it and the rate for the part above it (basis points). */
  kneeSom: number;
  lowBp: number;
  highBp: number;
  /** LINE: the separate platform line in som, and whether it is currently waived (shown crossed out, charged as 0). */
  lineSom: number;
  lineWaived: boolean;
}

export const DEFAULT_FEE_CONFIG: FeeConfig = { mode: 'FLAT', percentBp: 1000, kneeSom: 50_000, lowBp: 1000, highBp: 300, lineSom: 5000, lineWaived: false };
/** The platform line the customer is charged (0 while waived). Only LINE mode has one. */
export const lineChargeSom = (cfg: FeeConfig): number => (cfg.mode === 'LINE' && !cfg.lineWaived ? cfg.lineSom : 0);
/** Dish prices shown to the customer are multiples of this. */
export const ROUND_SOM = 100;
/** The progress bar's stations (TIERED): prices keep dropping until the last one's neighbourhood; sent to the app as data. */
export const MILESTONES_SOM: readonly number[] = [50_000, 100_000, 200_000];
export const FEE_SCALE = 10_000n;

export interface BaseLine { baseUnitSom: number; quantity: number }
export interface PricedLine { baseUnitSom: number; unitSom: number; quantity: number; subtotalSom: number }
export interface PricedBasket<L> { lines: Array<L & PricedLine>; baseTotalSom: number; totalSom: number; feeSom: number }

export const baseTotal = (lines: BaseLine[]): number => lines.reduce((s, l) => s + l.baseUnitSom * l.quantity, 0);

/** Fee for a basket of `base` som, multiplied by 10_000 (exact). 0 for FLAT: nothing is added to the customer's price. */
export function feeScaled(base: number, cfg: FeeConfig): bigint {
  const b = BigInt(base);
  if (cfg.mode === 'PERCENT') return b * BigInt(cfg.percentBp);
  if (cfg.mode === 'TIERED') {
    const knee = BigInt(cfg.kneeSom);
    return b <= knee ? b * BigInt(cfg.lowBp) : knee * BigInt(cfg.lowBp) + (b - knee) * BigInt(cfg.highBp);
  }
  return 0n;
}

/** Round a rational x = num/den (som) to the nearest ROUND_SOM, halves up. */
function roundToStep(num: bigint, den: bigint): number {
  const step = BigInt(ROUND_SOM);
  return Number(((2n * num + den * step) / (2n * den * step)) * step);
}

const ceilToStep = (som: number): number => Math.ceil(som / ROUND_SOM) * ROUND_SOM;

/** One unit's customer price when the basket (menu prices) is worth `base` som. Never below the restaurant's own price. */
export function unitPrice(baseUnitSom: number, base: number, cfg: FeeConfig): number {
  if (cfg.mode === 'FLAT' || cfg.mode === 'LINE' || base <= 0) return baseUnitSom;
  const d = BigInt(base) * FEE_SCALE;
  const priced = roundToStep(BigInt(baseUnitSom) * (d + feeScaled(base, cfg)), d);
  return Math.max(ceilToStep(baseUnitSom), priced);
}

/** What a dish costs before any "discount": the price at the first rate, shown crossed out once the basket makes it cheaper. */
export function referenceUnitPrice(baseUnitSom: number, cfg: FeeConfig): number {
  if (cfg.mode === 'FLAT' || cfg.mode === 'LINE') return baseUnitSom;
  const bp = cfg.mode === 'PERCENT' ? cfg.percentBp : cfg.lowBp;
  return Math.max(ceilToStep(baseUnitSom), roundToStep(BigInt(baseUnitSom) * (10_000n + BigInt(bp)), 10_000n));
}

/** Prices a whole basket. The total is exactly the sum of the displayed lines; the platform's share is total - base (>= 0). */
export function priceBasket<L extends BaseLine>(lines: L[], cfg: FeeConfig): PricedBasket<L> {
  const base = baseTotal(lines);
  const priced = lines.map(l => {
    const unitSom = unitPrice(l.baseUnitSom, base, cfg);
    return { ...l, unitSom, subtotalSom: unitSom * l.quantity };
  });
  // LINE: the lines stay at menu prices and the platform line is added on top (the only mode where total != sum of the lines).
  const line = lineChargeSom(cfg);
  const totalSom = priced.reduce((s, l) => s + l.subtotalSom, 0) + line;
  return { lines: priced, baseTotalSom: base, totalSom, feeSom: totalSom - base };
}

/** The next station on the progress bar above the basket, or null once the last one is passed. */
export function nextMilestone(base: number, cfg: FeeConfig): number | null {
  if (cfg.mode !== 'TIERED') return null;
  return MILESTONES_SOM.find(m => m > base) ?? null;
}

/** What the app needs to reproduce the same prices locally (the server stays the authority at checkout). */
export interface PublicPricing { mode: FeeMode; percentBp: number; kneeSom: number; lowBp: number; highBp: number; milestonesSom: number[]; lineSom?: number; lineWaived?: boolean }
export const publicPricing = (cfg: FeeConfig): PublicPricing => ({
  mode: cfg.mode, percentBp: cfg.percentBp, kneeSom: cfg.kneeSom, lowBp: cfg.lowBp, highBp: cfg.highBp, milestonesSom: [...MILESTONES_SOM],
  ...(cfg.mode === 'LINE' ? { lineSom: cfg.lineSom, lineWaived: cfg.lineWaived } : {}),
});

/** Rule code frozen on an order: how its fee was made. null = legacy flat commission. */
export const feeRuleCode = (cfg: FeeConfig): string | null =>
  cfg.mode === 'LINE' ? `${cfg.lineWaived ? 'LINE_FREE' : 'LINE'}_${cfg.lineSom}` : cfg.mode === 'PERCENT' ? `PERCENT_${cfg.percentBp}` : cfg.mode === 'TIERED' ? `TIERED_${cfg.kneeSom}_${cfg.lowBp}_${cfg.highBp}` : null;
