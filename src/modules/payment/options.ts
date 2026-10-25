import { db } from '../../lib/db.js';
import { cashEnabled, cashMaxOrderSom } from './method.js';

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
  const [cards, cooling, taken, queued, enabled] = await Promise.all([
    db.card.findMany({ where: { active: true, isTest: input.isTest, restaurantId: input.restaurantId }, select: { id: true } }),
    db.cardCooldown.findMany({ where: { amountTiyin, until: { gt: now } }, select: { cardId: true } }),
    db.payment.findMany({ where: { amountTiyin, status: 'AWAITING', isTest: input.isTest, restaurantId: input.restaurantId }, select: { cardId: true } }),
    db.payment.count({ where: { amountTiyin, status: 'QUEUED', isTest: input.isTest, restaurantId: input.restaurantId } }),
    cashEnabled(),
  ]);
  const blocked = new Set([...cooling.map(c => c.cardId), ...taken.map(t => t.cardId).filter((id): id is string => id !== null)]);
  const free = cards.filter(c => !blocked.has(c.id)).length;
  const maxSom = cashMaxOrderSom();
  return {
    card: { state: cards.length === 0 ? 'NONE' : free > queued ? 'FREE' : 'BUSY' },
    cash: !enabled ? { available: false, reason: 'OFF' } : input.totalSom > maxSom ? { available: false, reason: 'TOO_LARGE', maxSom } : { available: true, maxSom },
  };
}
