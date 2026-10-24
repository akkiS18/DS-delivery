import { describe, expect, it } from 'vitest';
import { shouldAnnouncePaid } from '../src/lib/order';

const now = '2026-10-24T10:00:00.000Z';
const secondsAgo = (s: number) => new Date(Date.parse(now) - s * 1000).toISOString();

describe('shouldAnnouncePaid', () => {
  it('announces when the screen sees waiting-for-payment turn into cooking', () => {
    expect(shouldAnnouncePaid('PAYMENT_PENDING', 'PREPARING', false)).toBe(true);
    expect(shouldAnnouncePaid('PAYMENT_CHECKING', 'PREPARING', false)).toBe(true);
  });
  it('never twice for the same order', () => {
    expect(shouldAnnouncePaid('PAYMENT_PENDING', 'PREPARING', true)).toBe(false);
    expect(shouldAnnouncePaid('PREPARING', 'READY', false)).toBe(false);
  });
  it('is silent while the payment is still awaited or the order failed', () => {
    expect(shouldAnnouncePaid(null, 'PAYMENT_PENDING', false)).toBe(false);
    expect(shouldAnnouncePaid('PAYMENT_PENDING', 'PAYMENT_CHECKING', false)).toBe(false);
    expect(shouldAnnouncePaid('PAYMENT_PENDING', 'EXPIRED', false)).toBe(false);
    expect(shouldAnnouncePaid('PAYMENT_PENDING', 'CANCELLED', false)).toBe(false);
  });
  it('on a first open, announces only a payment accepted within the last two minutes (server time)', () => {
    expect(shouldAnnouncePaid(null, 'PREPARING', false, secondsAgo(30), now)).toBe(true);
    expect(shouldAnnouncePaid(null, 'PREPARING', false, secondsAgo(121), now)).toBe(false);
    expect(shouldAnnouncePaid(null, 'DELIVERED', false, secondsAgo(86_400), now)).toBe(false);
    expect(shouldAnnouncePaid(null, 'PREPARING', false, null, now)).toBe(false);
    expect(shouldAnnouncePaid(null, 'PREPARING', false, secondsAgo(-60), now)).toBe(false);
  });
});
