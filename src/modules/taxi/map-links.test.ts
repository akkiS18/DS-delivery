import assert from 'node:assert/strict';
import test from 'node:test';
import { mapLinks } from './map-links.js';

test('Yandex gets longitude first, Google gets latitude first', () => {
  const l = mapLinks(39.9, 66.2)!;
  assert.equal(l.yandex, 'https://yandex.com/maps/?pt=66.200000,39.900000&z=18&l=map');
  assert.equal(l.google, 'https://www.google.com/maps/search/?api=1&query=39.900000,66.200000');
});

test('a missing or impossible point gives no link', () => {
  assert.equal(mapLinks(null, null), null);
  assert.equal(mapLinks(undefined, 66), null);
  assert.equal(mapLinks(39, null), null);
  assert.equal(mapLinks(NaN, 66), null);
  assert.equal(mapLinks(91, 66), null);
  assert.equal(mapLinks(39, 181), null);
});

test('zero is a real coordinate, not "missing"', () => {
  assert.notEqual(mapLinks(0, 0), null);
});
