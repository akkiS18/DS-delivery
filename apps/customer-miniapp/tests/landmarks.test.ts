import { describe, expect, it } from 'vitest';
import { distanceMeters, nearbyLandmarks, roundedMeters, type Landmark } from '../src/lib/landmarks';

const L = (id: string, name: string, lat: number, lng: number): Landmark => ({ id, name, kind: 'OTHER', lat, lng });
const me = { lat: 40.03, lng: 65.667 };

describe('landmark distance', () => {
  it('0.001 degrees of latitude is about 111 m; the same point is 0', () => {
    expect(Math.abs(distanceMeters(me, { lat: 40.031, lng: 65.667 }) - 111.2)).toBeLessThan(1);
    expect(distanceMeters(me, me)).toBe(0);
  });
});

describe('nearby landmarks', () => {
  const list = [L('a', 'Uzoq', 40.04, 65.667), L('b', 'Yaqin', 40.0301, 65.667), L('c', 'O‘rta', 40.0315, 65.667), L('d', 'Boshqa', 40.0325, 65.667)];
  it('nearest first, limited and cut at the radius', () => {
    expect(nearbyLandmarks(list, me, 800, 3).map(l => l.id)).toEqual(['b', 'c', 'd']);
    expect(nearbyLandmarks(list, me, 800, 2).map(l => l.id)).toEqual(['b', 'c']);
    expect(nearbyLandmarks(list, me, 100, 3).map(l => l.id)).toEqual(['b']);
    expect(nearbyLandmarks(list, me, 5, 3)).toEqual([]);
    expect(nearbyLandmarks([], me, 800, 3)).toEqual([]);
  });
  it('equal distances are ordered by name', () => {
    const same = [L('1', 'B', 40.031, 65.667), L('2', 'A', 40.031, 65.667)];
    expect(nearbyLandmarks(same, me, 500, 2).map(l => l.name)).toEqual(['A', 'B']);
  });
  it('rounds to 10 m, never 0', () => {
    expect(roundedMeters(137)).toBe(140);
    expect(roundedMeters(1)).toBe(10);
  });
});
