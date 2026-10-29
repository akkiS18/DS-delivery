import type { Prisma } from '@prisma/client';

/**
 * Platform card pool (owner decision 2026-10-30, "B mode"). A restaurant flagged `collectsToPlatform` is paid on the platform's own cards
 * (Card.restaurantId = null, real) instead of cards of its own; every other restaurant keeps using its own cards exactly as before.
 * The payment keeps its restaurantId (attribution, reports); only the OWNER of the card that may take it changes.
 * Test (MOCK) payments never use the pool: test cards stay per restaurant.
 *
 * Turnover cap: a bank may flag a card whose monthly intake grows too large, so a pool card is not given to a new payment when its
 * last-30-days intake (matched payments + payments waiting on it right now) plus the new amount would pass the cap. The card choice also
 * prefers the card with the lowest turnover, which keeps the cards even. Cards of single restaurants are not capped here.
 */
type Tx = Prisma.TransactionClient;

export const POOL_TURNOVER_DAYS = 30;
export const DEFAULT_POOL_CAP_SOM = 40_000_000;
const MAX_POOL_CAP_SOM = 10_000_000_000;

/** CARD_TURNOVER_CAP_SOM: unset/blank/invalid -> the safe default; "0" -> explicitly no cap. A bad value never silently removes the cap. */
export function poolCapSom(env: Record<string, string | undefined> = process.env): number {
  const raw = env.CARD_TURNOVER_CAP_SOM?.trim();
  if (!raw) return DEFAULT_POOL_CAP_SOM;
  if (!/^[0-9]{1,11}$/.test(raw)) return DEFAULT_POOL_CAP_SOM;
  const v = Number(raw);
  return v === 0 || (Number.isSafeInteger(v) && v <= MAX_POOL_CAP_SOM && v >= 1_000_000) ? v : DEFAULT_POOL_CAP_SOM;
}

/** Pure. A card with `turnoverSom` of intake can take `amountSom` more only while the total stays within the cap (cap 0 = unlimited). */
export const withinCap = (turnoverSom: number, amountSom: number, capSom: number): boolean => capSom === 0 || turnoverSom + amountSom <= capSom;

export interface RankableCard { id: string; last4: string; lastAssignedAt: Date | null }
/** Pure. Fewest open payments first, then lowest turnover, then the longest-unused card, then last4 (a stable tie-break). */
export function rankCards<T extends RankableCard>(cards: T[], openCount: Map<string, number>, turnoverSom: Map<string, number>): T[] {
  return [...cards].sort((a, b) =>
    (openCount.get(a.id) ?? 0) - (openCount.get(b.id) ?? 0) ||
    (turnoverSom.get(a.id) ?? 0) - (turnoverSom.get(b.id) ?? 0) ||
    (a.lastAssignedAt?.getTime() ?? 0) - (b.lastAssignedAt?.getTime() ?? 0) ||
    a.last4.localeCompare(b.last4));
}

/** Which Card.restaurantId may take this restaurant's real payments: null = the platform pool, otherwise the restaurant's own cards. */
export async function cardOwnerOf(tx: Tx, restaurantId: string | null, isTest: boolean): Promise<string | null> {
  if (isTest || restaurantId === null) return restaurantId;
  const r = await tx.restaurant.findUnique({ where: { id: restaurantId }, select: { collectsToPlatform: true } });
  return r?.collectsToPlatform ? null : restaurantId;
}

/** Filter for every payment that is paid on cards of `owner` (the platform pool also serves the restaurants flagged collectsToPlatform). */
export function paymentsOfOwner(owner: string | null, isTest: boolean): Prisma.PaymentWhereInput {
  if (owner !== null || isTest) return { restaurantId: owner };
  return { OR: [{ restaurantId: null }, { restaurant: { is: { collectsToPlatform: true } } }] };
}

/** Intake of each card over the last 30 days: payments the bank signal matched, plus payments waiting for money on the card right now. */
export async function cardTurnoverSom(tx: Tx, cardIds: string[], now: Date): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!cardIds.length) return out;
  const since = new Date(now.getTime() - POOL_TURNOVER_DAYS * 86_400_000);
  const rows = await tx.payment.groupBy({
    by: ['cardId'], _sum: { amountTiyin: true },
    where: {
      cardId: { in: cardIds }, isTest: false,
      OR: [{ status: { in: ['MATCHED_UNVERIFIED', 'CONFIRMED_MANUAL'] }, matchedAt: { gte: since } }, { status: 'AWAITING' }],
    },
  });
  for (const r of rows) if (r.cardId) out.set(r.cardId, Number((r._sum.amountTiyin ?? 0n) / 100n));
  return out;
}

/** Active real cards that can take a payment of `amountSom` now (pool cards are filtered by the turnover cap; a restaurant's own cards are not). */
export async function usableCardCount(tx: Tx, restaurantId: string, amountSom: number, now = new Date()): Promise<number> {
  const owner = await cardOwnerOf(tx, restaurantId, false);
  const cards = await tx.card.findMany({ where: { active: true, isTest: false, restaurantId: owner }, select: { id: true } });
  if (owner !== null || !cards.length) return cards.length;
  const cap = poolCapSom();
  const turnover = await cardTurnoverSom(tx, cards.map(c => c.id), now);
  return cards.filter(c => withinCap(turnover.get(c.id) ?? 0, amountSom, cap)).length;
}
