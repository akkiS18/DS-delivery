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

import { classifyAmountMismatch, incomingFingerprint, isDelayedNotification } from './matching.js';

test('fingerprint is stable for the same bank event and differs by card, amount or minute', () => {
  const t = new Date('2026-10-18T10:15:00+05:00');
  const base = incomingFingerprint('8167', 2_100_000n, t);
  assert.equal(base, incomingFingerprint('8167', 2_100_000n, new Date(t)));
  assert.notEqual(base, incomingFingerprint('8168', 2_100_000n, t));
  assert.notEqual(base, incomingFingerprint('8167', 2_100_001n, t));
  assert.notEqual(base, incomingFingerprint('8167', 2_100_000n, new Date(t.getTime() + 60_000)));
});
test('partial and excess amounts are classified, exact amounts are not', () => {
  assert.equal(classifyAmountMismatch(2_100_000n, 2_000_000n), 'AMOUNT_BELOW_EXPECTED');
  assert.equal(classifyAmountMismatch(2_100_000n, 2_100_001n), 'AMOUNT_ABOVE_EXPECTED');
  assert.equal(classifyAmountMismatch(2_100_000n, 2_100_000n), null);
});
test('delayed notification threshold is exclusive', () => {
  assert.equal(isDelayedNotification(0, 30 * 60_000, 30 * 60_000), false);
  assert.equal(isDelayedNotification(0, 30 * 60_000 + 1, 30 * 60_000), true);
});
