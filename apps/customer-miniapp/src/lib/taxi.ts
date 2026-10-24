import type { TaxiOption } from './types';

const KEY = 'ds.taxiChoice.v1';

export const loadTaxiChoice = (): string | null => {
  try { return window.localStorage.getItem(KEY); } catch { return null; }
};
export const saveTaxiChoice = (id: string): void => {
  try { window.localStorage.setItem(KEY, id); } catch { /* storage may be unavailable */ }
};

/**
 * Which taxi service is selected on the checkout screen. The customer's own pick wins while it is still offered; with a single service there
 * is nothing to choose; otherwise the service used last time is pre-selected. With several services and no history nothing is selected,
 * so the customer decides (the delivery price is the taxi service's own).
 */
export function pickTaxi(options: TaxiOption[], current: string | null, saved: string | null): string | null {
  const has = (id: string | null): id is string => id !== null && options.some(o => o.id === id);
  if (has(current)) return current;
  if (options.length === 1) return options[0]!.id;
  return has(saved) ? saved : null;
}
