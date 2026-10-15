import assert from 'node:assert/strict';
import test from 'node:test';
import { couldBelongToEarlierPayment, overlapsPaymentWindow } from './matching.js';

test('minute rounding: 12:00:00 event may belong to an order opened 12:00:45', () => {
  assert.equal(overlapsPaymentWindow(0, 45_000, 345_000, true), true);
  assert.equal(overlapsPaymentWindow(0, 65_000, 365_000, true), false);
});

test('an exact mock-old event never matches a later order', () => {
  assert.equal(overlapsPaymentWindow(0, 45_000, 345_000, false), false);
  assert.equal(overlapsPaymentWindow(45_000, 45_000, 345_000, false), true);
});

test('previous allocation within ambiguity window must be reviewed', () => {
  assert.equal(couldBelongToEarlierPayment(0, 10 * 60_000, 15 * 60_000), true);
  assert.equal(couldBelongToEarlierPayment(0, 20 * 60_000, 15 * 60_000), false);
});
