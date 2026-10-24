import { anchorOf, isTerminal, prepPending, remainingSeconds } from './order';
import type { CustomerStage, PrepClock } from './types';

/** Active = anything the backend has not finished (includes NEEDS_HELP and CANCELLATION_REQUESTED). No states are invented here. */
export const isActive = (s: CustomerStage): boolean => !isTerminal(s);

/** Lower = shown first. Things that need the customer come first, then the furthest-along orders. */
const RELEVANCE: Record<CustomerStage, number> = {
  NEEDS_HELP: 0, PAYMENT_PENDING: 1, TAXI_SENT: 2, TAXI_ACCEPTED: 3, TAXI_REQUESTED: 4, READY: 5, PREPARING: 6,
  PAYMENT_CHECKING: 7, CANCELLATION_REQUESTED: 8, DELIVERED: 20, CANCELLED: 21, EXPIRED: 22,
};

/** Orders that need the customer's attention: highlighted in the list. */
export const needsAttention = (s: CustomerStage): boolean => s === 'PAYMENT_PENDING' || s === 'NEEDS_HELP';

/** Active orders (most relevant first, then newest) and history (newest first). Duplicate ids are dropped. */
export function groupOrders<T extends { id: string; stage: CustomerStage; createdAt: string }>(list: readonly T[]): { active: T[]; history: T[] } {
  const seen = new Set<string>();
  const unique = list.filter(o => (seen.has(o.id) ? false : (seen.add(o.id), true)));
  const newest = (a: T, b: T) => Date.parse(b.createdAt) - Date.parse(a.createdAt);
  return {
    active: unique.filter(o => isActive(o.stage)).sort((a, b) => RELEVANCE[a.stage] - RELEVANCE[b.stage] || newest(a, b)),
    history: unique.filter(o => isTerminal(o.stage)).sort(newest),
  };
}

/** Short preparation hint for list cards; only while the restaurant is preparing. Uses the server clock, like the tracking screen. */
export function prepHint(o: { stage: CustomerStage; prep?: PrepClock | undefined; serverNow?: string | undefined }, perfNow: number, receivedAtPerf: number): string | null {
  if (o.stage !== 'PREPARING' || !o.prep) return null;
  if (prepPending(o.stage, o.prep)) return 'Tayyor bo‘lish vaqti aniqlanmoqda';
  if (o.prep.estimatedReadyAt && o.serverNow) {
    const left = remainingSeconds(o.prep, anchorOf(o.serverNow, receivedAtPerf), perfNow);
    if (left !== null) return left > 0 ? `~${Math.max(1, Math.ceil(left / 60))} daqiqa qoldi` : 'Tez orada tayyor bo‘ladi';
  }
  return o.prep.minutes > 0 ? `Tayyorlash ~${o.prep.minutes} daqiqa` : null;
}

/** The one action each active card offers. */
export const nextAction = (s: CustomerStage): string => (s === 'PAYMENT_PENDING' ? 'To‘lash' : s === 'NEEDS_HELP' ? 'Batafsil' : 'Kuzatish');
