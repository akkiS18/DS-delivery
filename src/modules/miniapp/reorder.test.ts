import assert from 'node:assert/strict';
import test from 'node:test';
import { reorderLines } from './reorder.js';

test('adds a 1+1 free unit to the paid line of the same dish', () => {
  assert.deepEqual(reorderLines([{ productId: 'a', quantity: 1 }, { productId: 'a', quantity: 1 }, { productId: 'b', quantity: 3 }]), [{ productId: 'a', quantity: 2 }, { productId: 'b', quantity: 3 }]);
});

test('skips lines without a dish and non-positive quantities', () => {
  assert.deepEqual(reorderLines([{ productId: null, quantity: 2 }, { productId: 'a', quantity: 0 }, { productId: 'b', quantity: -1 }, { productId: 'c', quantity: 1 }]), [{ productId: 'c', quantity: 1 }]);
});

test('an order without items gives nothing to reorder', () => {
  assert.deepEqual(reorderLines([]), []);
});
