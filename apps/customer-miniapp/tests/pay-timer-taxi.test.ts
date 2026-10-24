import { describe, expect, it } from 'vitest';
import { anchorOf, paymentRemainingSeconds, prepPending, windowMinutes } from '../src/lib/order';
import { prepHint } from '../src/lib/orderList';
import { pickTaxi } from '../src/lib/taxi';

const A = { id: 'a', name: 'Alfa Taksi' };
const B = { id: 'b', name: 'Beta Taksi' };

describe('paymentRemainingSeconds', () => {
  const anchor = anchorOf('2026-10-24T10:00:00.000Z', 1000);
  const expires = '2026-10-24T10:10:00.000Z';
  it('counts down on the server clock plus the time elapsed since the response', () => {
    expect(paymentRemainingSeconds(expires, anchor, 1000)).toBe(600);
    expect(paymentRemainingSeconds(expires, anchor, 1000 + 61_500)).toBe(539); // 538.5 s left, rounded up
  });
  it('goes to zero and negative once the window is over', () => {
    expect(paymentRemainingSeconds(expires, anchor, 1000 + 600_000)).toBe(0);
    expect(paymentRemainingSeconds(expires, anchor, 1000 + 605_000)).toBe(-5);
  });
  it('is null without a deadline', () => {
    expect(paymentRemainingSeconds(null, anchor, 1000)).toBeNull();
    expect(paymentRemainingSeconds('nonsense', anchor, 1000)).toBeNull();
  });
});

describe('windowMinutes', () => {
  it('names the window in whole minutes, rounded up', () => {
    expect(windowMinutes(600)).toBe(10);
    expect(windowMinutes(90)).toBe(2);
    expect(windowMinutes(30)).toBe(1);
  });
  it('falls back when the server did not send it', () => {
    expect(windowMinutes(null)).toBe(10);
    expect(windowMinutes(undefined)).toBe(10);
    expect(windowMinutes(0)).toBe(10);
  });
});

describe('pickTaxi', () => {
  it('keeps the customer’s own pick while it is still offered', () => {
    expect(pickTaxi([A, B], 'b', 'a')).toBe('b');
  });
  it('a single service needs no choice', () => {
    expect(pickTaxi([A], null, null)).toBe('a');
    expect(pickTaxi([B], 'a', 'a')).toBe('b');
  });
  it('with several services it pre-selects the one used last time, else nothing', () => {
    expect(pickTaxi([A, B], null, 'b')).toBe('b');
    expect(pickTaxi([A, B], null, 'gone')).toBeNull();
    expect(pickTaxi([A, B], null, null)).toBeNull();
  });
  it('a pick that disappeared from the list is dropped', () => {
    expect(pickTaxi([A, B], 'gone', null)).toBeNull();
    expect(pickTaxi([], null, 'a')).toBeNull();
  });
});

describe('prepPending / prepHint', () => {
  const base = { minutes: 15, startedAt: null, estimatedReadyAt: null, readyAt: null, remainingSeconds: null, overdueMinutes: 0, isOverdue: false };
  it('is pending only while cooking and the restaurant has not chosen (strictly null)', () => {
    expect(prepPending('PREPARING', { ...base, chosenMinutes: null })).toBe(true);
    expect(prepPending('PREPARING', { ...base, chosenMinutes: 20 })).toBe(false);
    expect(prepPending('PREPARING', base)).toBe(false); // an older server sends nothing: show what it sent
    expect(prepPending('READY', { ...base, chosenMinutes: null })).toBe(false);
  });
  it('the list card says the time is being determined instead of a number', () => {
    expect(prepHint({ stage: 'PREPARING', prep: { ...base, minutes: 0, chosenMinutes: null } }, 0, 0)).toBe('Tayyor bo‘lish vaqti aniqlanmoqda');
  });
});
