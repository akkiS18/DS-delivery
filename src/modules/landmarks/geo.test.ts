import assert from 'node:assert/strict';
import test from 'node:test';
import { AREA, distanceMeters, inArea, isKind, landmarkLine, nearbyLandmarks, roundedMeters, type LandmarkPoint } from './geo.js';

const L = (id: string, name: string, lat: number, lng: number): LandmarkPoint => ({ id, name, kind: 'OTHER', lat, lng });

test('distance: 0.001 degrees of latitude is about 111 m, and it is symmetric', () => {
  const a = { lat: 40.03, lng: 65.667 };
  const b = { lat: 40.031, lng: 65.667 };
  assert.ok(Math.abs(distanceMeters(a, b) - 111.2) < 1, String(distanceMeters(a, b)));
  assert.equal(distanceMeters(a, b), distanceMeters(b, a));
  assert.equal(distanceMeters(a, a), 0);
});

test('distance: a degree of longitude is shorter at this latitude (cos 40 degrees)', () => {
  const d = distanceMeters({ lat: 40, lng: 65 }, { lat: 40, lng: 66 });
  assert.ok(d > 84_000 && d < 86_000, String(d));
});

test('the service area accepts the town and refuses swapped or missing coordinates', () => {
  assert.equal(inArea({ lat: 40.0304, lng: 65.6672 }), true);
  assert.equal(inArea({ lat: 65.6672, lng: 40.0304 }), false, 'latitude and longitude swapped');
  assert.equal(inArea({ lat: 41.31, lng: 69.24 }), false, 'Tashkent');
  assert.equal(inArea({ lat: NaN, lng: 65.6 }), false);
  assert.equal(inArea({ lat: AREA.south, lng: AREA.west }), true, 'the edge is inside');
});

test('nearby: nearest first, limited, and nothing beyond the radius', () => {
  const me = { lat: 40.03, lng: 65.667 };
  const list = [L('a', 'Uzoq', 40.04, 65.667), L('b', 'Yaqin', 40.0301, 65.667), L('c', 'O‘rta', 40.0315, 65.667)];
  assert.deepEqual(nearbyLandmarks(list, me, 500, 5).map(l => l.id), ['b', 'c']);
  assert.deepEqual(nearbyLandmarks(list, me, 5000, 2).map(l => l.id), ['b', 'c']);
  assert.deepEqual(nearbyLandmarks(list, me, 5, 5), []);
  assert.deepEqual(nearbyLandmarks([], me, 500), []);
});

test('nearby: equal distances are ordered by name so the answer never flickers', () => {
  const me = { lat: 40.03, lng: 65.667 };
  const same = [L('1', 'B', 40.031, 65.667), L('2', 'A', 40.031, 65.667)];
  assert.deepEqual(nearbyLandmarks(same, me, 500, 2).map(l => l.name), ['A', 'B']);
});

test('the driver line rounds to 10 m and never says 0 m', () => {
  assert.equal(roundedMeters(137), 140);
  assert.equal(roundedMeters(2), 10);
  assert.equal(landmarkLine('Markaziy bozor', 152), 'Mo‘ljal: Markaziy bozor (~150 m)');
});

test('kinds', () => {
  assert.equal(isKind('MARKET'), true);
  assert.equal(isKind('market'), false);
  assert.equal(isKind(undefined), false);
});
