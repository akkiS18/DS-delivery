import { describe, expect, it } from 'vitest';
import { bookingBounds, checkWhen, describeReservationError, localInputToIso, splitReservations, ticketWhen, toLocalInput, whenText } from '../src/lib/reservation';
import { cartBarVisible, parentOf, parseRoute, routeToHash } from '../src/lib/router';
import type { ReservationView } from '../src/lib/types';

// 2026-10-27 12:00 UTC = 17:00 in Tashkent
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);

const view = (over: Partial<ReservationView>): ReservationView => ({
  serverNow: new Date(NOW).toISOString(), id: 'r1', code: 'B1', status: 'PAID', restaurantName: 'R', restaurantPhone: null,
  startsAt: new Date(NOW + 5 * 3_600_000).toISOString(), partySize: 2, note: null, depositSom: 100000, createdAt: new Date(NOW).toISOString(), paidAt: null, isTest: false,
  payment: { status: 'CONFIRMED_MANUAL', amountSom: 100000, mode: 'REAL', queued: false, checking: false, instructions: null }, ...over,
});

describe('reservation time helpers', () => {
  it('reads the Tashkent clock for the datetime-local input and sends the +05:00 offset back', () => {
    expect(toLocalInput(new Date(NOW))).toBe('2026-10-27T17:00');
    expect(localInputToIso('2026-10-27T19:30')).toBe('2026-10-27T19:30:00+05:00');
    expect(Date.parse(localInputToIso('2026-10-27T19:30')!)).toBe(Date.UTC(2026, 9, 27, 14, 30));
    expect(localInputToIso('')).toBeNull();
    expect(localInputToIso('2026-10-27')).toBeNull();
  });
  it('bounds the picker to 60 minutes ahead .. 30 days', () => {
    expect(bookingBounds(NOW)).toEqual({ min: '2026-10-27T18:00', max: '2026-11-26T17:00' });
  });
  it('checks the time the way the server does', () => {
    expect(checkWhen('', NOW)).toMatch(/tanlang/);
    expect(checkWhen('2026-10-27T17:30', NOW)).toMatch(/60 daqiqa/);
    expect(checkWhen('2026-10-27T18:00', NOW)).toBeNull();
    expect(checkWhen('2026-12-30T18:00', NOW)).toMatch(/30 kun/);
  });
  it('shows day.month hour:minute on the Tashkent clock', () => {
    expect(whenText(new Date(NOW).toISOString())).toBe('27.10 17:00');
    expect(whenText('nope')).toBe('');
  });
});

describe('reservation list', () => {
  it('puts the coming ones first (soonest on top) and the rest by newest; dead statuses are never upcoming', () => {
    const soon = view({ id: 'a', startsAt: new Date(NOW + 3_600_000).toISOString() });
    const later = view({ id: 'b', startsAt: new Date(NOW + 86_400_000).toISOString(), status: 'PENDING_PAYMENT' });
    const expired = view({ id: 'c', status: 'EXPIRED', startsAt: new Date(NOW + 7_200_000).toISOString() });
    const old = view({ id: 'd', startsAt: new Date(NOW - 86_400_000).toISOString() });
    const { upcoming, past } = splitReservations([later, old, expired, soon], NOW);
    expect(upcoming.map(r => r.id)).toEqual(['a', 'b']);
    expect(past.map(r => r.id)).toEqual(['c', 'd']);
  });
});

describe('reservation errors and routes', () => {
  it('tells the customer nothing was charged and what to change', () => {
    expect(describeReservationError('BRON_YOPIQ')).toMatch(/bron qilmayapti/);
    expect(describeReservationError('KOP_TOLANMAGAN_BRON')).toMatch(/To‘lanmagan/);
    expect(describeReservationError('KARTA_YOQ')).toMatch(/pul olinmadi/);
    expect(describeReservationError(undefined, 429)).toMatch(/kuting/);
    expect(describeReservationError('???', 500)).toMatch(/pul olinmadi/);
  });
  it('round-trips the routes and keeps the back button inside the app', () => {
    for (const r of [{ name: 'reserve', id: 'rest1' }, { name: 'reservation', id: 'abc_9' }, { name: 'reservations' }] as const) {
      expect(parseRoute(routeToHash(r))).toEqual(r);
    }
    expect(parentOf({ name: 'reserve', id: 'rest1' })).toEqual({ name: 'menu', id: 'rest1' });
    expect(parentOf({ name: 'reservation', id: 'x' })).toEqual({ name: 'reservations' });
    expect(parentOf({ name: 'reservations' })).toEqual({ name: 'orders' });
    expect(parseRoute('#/reserve/../x')).toEqual({ name: 'home' });
  });
  it('hides the floating basket on the reservation form', () => {
    expect(cartBarVisible({ name: 'reserve', id: 'r' }, 3)).toBe(false);
    expect(cartBarVisible({ name: 'reservations' }, 3)).toBe(true);
  });
});

describe('reservation ticket date', () => {
  it('writes day-month, weekday and time on the Tashkent clock', () => {
    // 2026-11-12 14:00Z is 19:00 in Tashkent, a Thursday
    expect(ticketWhen('2026-11-12T14:00:00Z')).toEqual({ day: '12-noyabr', weekday: 'payshanba', time: '19:00' });
  });
  it('moves to the next day after 19:00Z (midnight in Tashkent)', () => {
    expect(ticketWhen('2026-11-12T19:30:00Z')).toEqual({ day: '13-noyabr', weekday: 'juma', time: '00:30' });
  });
  it('returns empty cells for a broken date', () => {
    expect(ticketWhen('nope')).toEqual({ day: '', weekday: '', time: '' });
  });
});
