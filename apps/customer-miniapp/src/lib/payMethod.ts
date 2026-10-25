import type { PaymentMethod, PaymentOptions } from './types';

/** Which choices the checkout shows. Without server advice (older backend, quote failed) only the card is offered: the safe, existing behaviour. */
export interface MethodChoices { card: boolean; cash: boolean; cardBusy: boolean; cashNote: string | null }

export function methodChoices(options: PaymentOptions | null | undefined): MethodChoices {
  if (!options) return { card: true, cash: false, cardBusy: false, cashNote: null };
  const cash = options.cash.available;
  const cardOpen = options.card.state !== 'NONE';
  return {
    // A restaurant with no usable card can only take cash; if cash is off too, keep the card so the server answers with the real reason.
    card: cardOpen || !cash,
    cash,
    cardBusy: options.card.state === 'BUSY',
    cashNote: !cash && options.cash.reason === 'TOO_LARGE' ? 'Naqd to‘lov bu summa uchun mavjud emas.' : null,
  };
}

/** The preselected method: card normally; cash when the payee card is busy (or missing) and cash is offered. The customer can always change it. */
export function defaultMethod(options: PaymentOptions | null | undefined): PaymentMethod {
  const c = methodChoices(options);
  if (c.cash && (c.cardBusy || !c.card)) return 'CASH';
  return 'CARD';
}

/** What is actually sent: a choice that is no longer offered falls back to the default. */
export function effectiveMethod(chosen: PaymentMethod | null, options: PaymentOptions | null | undefined): PaymentMethod {
  const c = methodChoices(options);
  if (chosen === 'CASH' && c.cash) return 'CASH';
  if (chosen === 'CARD' && c.card) return 'CARD';
  return defaultMethod(options);
}
