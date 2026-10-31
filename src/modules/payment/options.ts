import { db } from '../../lib/db.js';
import { cashEnabled, loadCashMaxOrderSom } from './method.js';
import { cardOwnerOf, cardTurnoverSom, paymentsOfOwner, poolCapSom, withinCap } from './pool.js';

/**
 * What the customer may choose at checkout for this restaurant and amount (read only, advisory: the server decides again when the order is made).
 *  card FREE  a payee card can take this exact amount right now;
 *  card BUSY  every card is occupied for this amount (the card payment would queue) - cash is the quick alternative;
 *  card NONE  the restaurant has no card that can take payments (REAL only: a MOCK checkout always has the test cards).
 *  cash       offered unless an administrator switched cash off (/cash) or the order is larger than the cash limit.
 */
export interface PaymentOptions {
  card: { state: 'FREE' | 'BUSY' | 'NONE' };
  cash: { available: boolean; reason?: 'OFF' | 'TOO_LARGE'; maxSom?: number };
}

export async function paymentOptions(input: { restaurantId: string; totalSom: number; isTest: boolean }, now = new Date()): Promise<PaymentOptions> {
  const amountTiyin = BigInt(input.totalSom) * 100n;
  // A restaurant flagged collectsToPlatform is paid on the platform's own cards (pool.ts); those cards also stop taking new payments at the turnover cap.
  const owner = await cardOwnerOf(db, input.restaurantId, input.isTest);
  const allCards = await db.card.findMany({ where: { active: true, isTest: input.isTest, restaurantId: owner }, select: { id: true } });
  const poolCard = owner === null && !input.isTest;
  const turnover = poolCard ? await cardTurnoverSom(db, allCards.map(c => c.id), now) : new Map<string, number>();
  const capSom = poolCapSom();
  const cards = poolCard ? allCards.filter(c => withinCap(turnover.get(c.id) ?? 0, input.totalSom, capSom)) : allCards;
  const [cooling, taken, queued, enabled] = await Promise.all([
    db.cardCooldown.findMany({ where: { amountTiyin, until: { gt: now } }, select: { cardId: true } }),
    db.payment.findMany({ where: { amountTiyin, status: 'AWAITING', isTest: input.isTest, cardId: { in: allCards.map(c => c.id) } }, select: { cardId: true } }),
    db.payment.count({ where: { amountTiyin, status: 'QUEUED', isTest: input.isTest, ...paymentsOfOwner(owner, input.isTest) } }),
    cashEnabled(),
  ]);
  const blocked = new Set([...cooling.map(c => c.cardId), ...taken.map(t => t.cardId).filter((id): id is string => id !== null)]);
  const free = cards.filter(c => !blocked.has(c.id)).length;
  const maxSom = await loadCashMaxOrderSom(db);
  return {
    card: { state: cards.length === 0 ? 'NONE' : free > queued ? 'FREE' : 'BUSY' },
    cash: !enabled ? { available: false, reason: 'OFF' } : input.totalSom > maxSom ? { available: false, reason: 'TOO_LARGE', maxSom } : { available: true, maxSom },
  };
}
