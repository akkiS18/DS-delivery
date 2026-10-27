import { describe, expect, it } from 'vitest';
import { parseRoute, parentOf, routeToHash, isTab, cartBarVisible } from '../src/lib/router';
import { itemsLine, STUCK_PAYMENT_MINUTES, troubleHint, validTicketText } from '../src/lib/support';
import type { CustomerStage } from '../src/lib/types';

const order = (stage: CustomerStage, ageMinutes = 1) => ({
  stage, createdAt: new Date(Date.UTC(2026, 9, 26, 10, 0, 0)).toISOString(),
  serverNow: new Date(Date.UTC(2026, 9, 26, 10, ageMinutes, 0)).toISOString(),
});

describe('payment trouble hint (when "write about the problem" is promoted)', () => {
  it('an expired payment and a stuck delivery always offer it', () => {
    expect(troubleHint(order('EXPIRED'), null)).toMatch(/pul o‘tkazgan bo‘lsangiz/);
    expect(troubleHint(order('NEEDS_HELP'), null)).toBeTruthy();
  });
  it('a running payment window offers it only once the time is up', () => {
    expect(troubleHint(order('PAYMENT_PENDING'), 300)).toBeNull();
    expect(troubleHint(order('PAYMENT_PENDING'), null)).toBeNull();
    expect(troubleHint(order('PAYMENT_PENDING'), 0)).toBeTruthy();
  });
  it('a payment still being checked is normal at first and a problem after a while', () => {
    expect(troubleHint(order('PAYMENT_CHECKING', 3), null)).toBeNull();
    expect(troubleHint(order('PAYMENT_CHECKING', STUCK_PAYMENT_MINUTES), null)).toBeTruthy();
  });
  it('healthy orders get no warning', () => {
    for (const s of ['PREPARING', 'READY', 'TAXI_SENT', 'DELIVERED', 'CANCELLED'] as const) expect(troubleHint(order(s, 90), null)).toBeNull();
  });
});

describe('support routes', () => {
  it('round-trips and keeps "new" apart from a ticket id', () => {
    for (const r of [{ name: 'support' }, { name: 'ticket', id: 'abc_1' }, { name: 'supportNew', orderId: 'o-9' }] as const) {
      expect(parseRoute(routeToHash(r))).toEqual(r);
    }
    expect(parseRoute('#/support/new')).toEqual({ name: 'home' });
    expect(parseRoute('#/support/a/b')).toEqual({ name: 'home' });
    expect(parseRoute('#/support/bad id')).toEqual({ name: 'home' });
  });
  it('back from a chat goes to the help tab, which is a tab', () => {
    expect(parentOf({ name: 'ticket', id: 'x' })).toEqual({ name: 'support' });
    expect(parentOf({ name: 'supportNew', orderId: 'x' })).toEqual({ name: 'support' });
    expect(isTab({ name: 'support' })).toBe(true);
    expect(isTab({ name: 'ticket', id: 'x' })).toBe(false);
  });
});

describe('ticket text', () => {
  it('needs 5 to 1000 characters after trimming', () => {
    expect(validTicketText('   abc  ')).toBe(false);
    expect(validTicketText('Muammo')).toBe(true);
    expect(validTicketText('x'.repeat(1001))).toBe(false);
  });
});

describe('order picker dish line', () => {
  it('lists the first dishes and how many more, and is null for an older backend', () => {
    expect(itemsLine({ itemsPreview: [{ name: 'Lavash', quantity: 2 }, { name: 'Cola', quantity: 1 }], itemsMore: 0 })).toBe('2× Lavash, 1× Cola');
    expect(itemsLine({ itemsPreview: [{ name: 'Lavash', quantity: 2 }], itemsMore: 3 })).toBe('2× Lavash +3 ta');
    expect(itemsLine({})).toBeNull();
    expect(itemsLine({ itemsPreview: [] })).toBeNull();
  });
});

describe('floating basket button', () => {
  it('shows on any browsing screen once the cart has something, never on an empty cart', () => {
    for (const r of [{ name: 'home' }, { name: 'menu', id: 'x' }, { name: 'orders' }, { name: 'order', id: 'x' }, { name: 'support' }, { name: 'profile' }] as const) {
      expect(cartBarVisible(r, 1)).toBe(true);
      expect(cartBarVisible(r, 0)).toBe(false);
    }
  });
  it('is hidden where the basket itself, the checkout button or a message input already occupy the bottom', () => {
    for (const r of [{ name: 'cart' }, { name: 'checkout' }, { name: 'ticket', id: 'x' }, { name: 'supportNew', orderId: 'x' }] as const) expect(cartBarVisible(r, 3)).toBe(false);
  });
  it('the basket is a tab of its own', () => {
    expect(isTab({ name: 'cart' })).toBe(true);
  });
});
