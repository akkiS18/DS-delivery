import { describe, expect, it } from 'vitest';
import { countThisMonth, dayText, groupByPeriod, matchesFilter, periodOf, topRestaurant } from '../src/lib/history';
import { parentOf, parseRoute, routeToHash } from '../src/lib/router';
import type { CustomerStage } from '../src/lib/types';

const NOW = Date.parse('2026-11-11T10:00:00Z');
const at = (iso: string) => ({ createdAt: iso });

describe('history screen helpers', () => {
  it('filters: delivered, and cancelled together with expired', () => {
    expect(matchesFilter('DELIVERED', 'ALL')).toBe(true);
    expect(matchesFilter('CANCELLED', 'DELIVERED')).toBe(false);
    expect(matchesFilter('EXPIRED', 'CANCELLED')).toBe(true);
    expect(matchesFilter('DELIVERED', 'CANCELLED')).toBe(false);
  });

  it('puts the last 7 days under one heading, then one heading per month', () => {
    expect(periodOf('2026-11-10T08:00:00Z', NOW).key).toBe('week');
    expect(periodOf('2026-11-02T08:00:00Z', NOW)).toMatchObject({ key: '2026-11', label: 'Noyabr' });
    expect(periodOf('2026-10-20T08:00:00Z', NOW)).toMatchObject({ key: '2026-10', label: 'Oktyabr' });
    expect(periodOf('2025-12-20T08:00:00Z', NOW).label).toBe('Dekabr 2025');
  });

  it('groups newest first and keeps each period in one group', () => {
    const groups = groupByPeriod([at('2026-10-05T08:00:00Z'), at('2026-11-10T08:00:00Z'), at('2026-10-25T08:00:00Z'), at('2026-11-03T08:00:00Z')], NOW);
    expect(groups.map(g => [g.key, g.items.length])).toEqual([['week', 1], ['2026-11', 1], ['2026-10', 2]]);
    expect(groups[2]!.items[0]!.createdAt).toBe('2026-10-25T08:00:00Z');
  });

  it('counts this month in the Tashkent calendar', () => {
    expect(countThisMonth([at('2026-11-01T01:00:00Z'), at('2026-10-31T21:00:00Z'), at('2026-10-30T10:00:00Z')], NOW)).toBe(2); // 21:00Z on the 31st is already Nov 1 in Tashkent
  });

  it('names the restaurant delivered from most often; none without a delivered order', () => {
    const o = (restaurantName: string, stage: CustomerStage, createdAt: string) => ({ restaurantName, stage, createdAt });
    expect(topRestaurant([o('A', 'CANCELLED', '2026-11-01T00:00:00Z')])).toBeNull();
    expect(topRestaurant([o('A', 'DELIVERED', '2026-10-01T00:00:00Z'), o('B', 'DELIVERED', '2026-11-01T00:00:00Z'), o('B', 'DELIVERED', '2026-11-02T00:00:00Z'), o('A', 'DELIVERED', '2026-09-01T00:00:00Z')])).toBe('B');
    expect(topRestaurant([o('A', 'DELIVERED', '2026-11-05T00:00:00Z'), o('B', 'DELIVERED', '2026-11-01T00:00:00Z')])).toBe('A'); // tie: the more recent one
  });

  it('writes the day as today, yesterday or dd.mm with the time', () => {
    expect(dayText('2026-11-11T05:00:00Z', NOW)).toMatch(/^Bugun, \d\d:\d\d$/);
    expect(dayText('2026-11-10T05:00:00Z', NOW)).toMatch(/^Kecha, \d\d:\d\d$/);
    expect(dayText('2026-11-02T05:00:00Z', NOW)).toMatch(/^02\.11, \d\d:\d\d$/);
  });

  it('has a history route that goes back to the orders tab', () => {
    expect(parseRoute('#/history')).toEqual({ name: 'history' });
    expect(routeToHash({ name: 'history' })).toBe('#/history');
    expect(parentOf({ name: 'history' })).toEqual({ name: 'orders' });
  });
});
