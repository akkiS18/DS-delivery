import assert from 'node:assert/strict';
import test from 'node:test';
import { nextAutoLabel } from './address-label.js';

test('first address is "Manzil 1"', () => {
  assert.equal(nextAutoLabel([]), 'Manzil 1');
});

test('numbering continues after the existing addresses', () => {
  assert.equal(nextAutoLabel(['Manzil 1']), 'Manzil 2');
  assert.equal(nextAutoLabel(['Manzil 1', 'Manzil 2']), 'Manzil 3');
});

test('a taken number is skipped, case and spaces ignored', () => {
  assert.equal(nextAutoLabel(['Uy', 'Manzil 2']), 'Manzil 3');
  assert.equal(nextAutoLabel(['MANZIL 3 ', 'Uy']), 'Manzil 4'); // "Manzil 3" is taken (case and spaces ignored)
  assert.equal(nextAutoLabel(['Manzil 3', 'Ish']), 'Manzil 4'); // 3 is taken by the name above, so the next free is 4
});

test('names the customer typed earlier never produce a duplicate', () => {
  const labels = ['Uy', 'Ish'];
  const next = nextAutoLabel(labels);
  assert.ok(!labels.includes(next));
  assert.equal(next, 'Manzil 3');
});
