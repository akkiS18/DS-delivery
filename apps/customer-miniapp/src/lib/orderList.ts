import { isTerminal } from './order';
import type { CustomerStage } from './types';

/** Active = anything the backend has not finished (includes NEEDS_HELP and CANCELLATION_REQUESTED). No states are invented here. */
export const isActive = (s: CustomerStage): boolean => !isTerminal(s);

/** Lower = shown first. Things that need the customer come first, then the furthest-along orders. */
const RELEVANCE: Record<CustomerStage, number> = {
  NEEDS_HELP: 0, PAYMENT_PENDING: 1, SELF_DELIVERY: 2, TAXI_SENT: 2, TAXI_ACCEPTED: 3, TAXI_REQUESTED: 4, READY: 5, PREPARING: 6,
  PAYMENT_CHECKING: 7, CANCELLATION_REQUESTED: 8, DELIVERED: 20, CANCELLED: 21, EXPIRED: 22,
};

/** Orders that need the customer's attention: highlighted in the list. */
export const needsAttention = (s: CustomerStage, method?: 'CARD' | 'CASH'): boolean => (s === 'PAYMENT_PENDING' && method !== 'CASH') || s === 'NEEDS_HELP';

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

/** The one action each active card offers. */
export const nextAction = (s: CustomerStage, method?: 'CARD' | 'CASH'): string => (s === 'PAYMENT_PENDING' ? (method === 'CASH' ? 'Kutilmoqda' : 'To‘lash') : s === 'NEEDS_HELP' ? 'Batafsil' : 'Kuzatish');
