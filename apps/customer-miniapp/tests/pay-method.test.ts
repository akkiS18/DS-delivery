import { describe, expect, it } from 'vitest';
import { defaultMethod, effectiveMethod, methodChoices } from '../src/lib/payMethod';
import { needsAttention, nextAction } from '../src/lib/orderList';
import type { PaymentOptions } from '../src/lib/types';

const opts = (card: PaymentOptions['card']['state'], cash: PaymentOptions['cash']): PaymentOptions => ({ card: { state: card }, cash });
const CASH_OK = { available: true, maxSom: 1_000_000 };

describe('payment method choices at checkout', () => {
  it('no server advice: card only, nothing new is shown', () => {
    expect(methodChoices(null)).toEqual({ card: true, cash: false, cardBusy: false, cashNote: null });
    expect(methodChoices(undefined).cash).toBe(false);
    expect(defaultMethod(null)).toBe('CARD');
  });

  it('payee card free: both options are shown and the card is preselected', () => {
    const o = opts('FREE', CASH_OK);
    expect(methodChoices(o)).toMatchObject({ card: true, cash: true, cardBusy: false });
    expect(defaultMethod(o)).toBe('CARD');
    expect(effectiveMethod(null, o)).toBe('CARD');
    expect(effectiveMethod('CASH', o)).toBe('CASH');
  });

  it('payee card busy: cash is preselected but the customer can still wait for the card', () => {
    const o = opts('BUSY', CASH_OK);
    expect(methodChoices(o)).toMatchObject({ card: true, cash: true, cardBusy: true });
    expect(defaultMethod(o)).toBe('CASH');
    expect(effectiveMethod(null, o)).toBe('CASH');
    expect(effectiveMethod('CARD', o)).toBe('CARD');
  });

  it('cash switched off or too large: card only, and a stale cash choice falls back to the card', () => {
    for (const cash of [{ available: false, reason: 'OFF' as const }, { available: false, reason: 'TOO_LARGE' as const, maxSom: 1_000_000 }]) {
      const o = opts('BUSY', cash);
      expect(methodChoices(o).cash).toBe(false);
      expect(effectiveMethod('CASH', o)).toBe('CARD');
    }
    expect(methodChoices(opts('FREE', { available: false, reason: 'TOO_LARGE', maxSom: 1 })).cashNote).toMatch(/summa/);
  });

  it('a restaurant with no usable card can only take cash', () => {
    const o = opts('NONE', CASH_OK);
    expect(methodChoices(o)).toMatchObject({ card: false, cash: true });
    expect(effectiveMethod('CARD', o)).toBe('CASH');
  });

  it('no card and no cash: the card is kept so the server can give the real reason', () => {
    expect(methodChoices(opts('NONE', { available: false, reason: 'OFF' })).card).toBe(true);
  });
});

describe('orders list for a cash order', () => {
  it('a pending cash order is "Kutilmoqda", not a payment the customer has to make', () => {
    expect(nextAction('PAYMENT_PENDING', 'CASH')).toBe('Kutilmoqda');
    expect(nextAction('PAYMENT_PENDING', 'CARD')).toBe('To‘lash');
    expect(needsAttention('PAYMENT_PENDING', 'CASH')).toBe(false);
    expect(needsAttention('PAYMENT_PENDING', 'CARD')).toBe(true);
    expect(needsAttention('NEEDS_HELP', 'CASH')).toBe(true);
  });
});
