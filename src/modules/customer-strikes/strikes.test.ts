import assert from 'node:assert/strict';
import test from 'node:test';
import { BLOCK_AT, CASH_OFF_AT, standingOf } from './service.js';

// Owner decision 2026-10-30: 1 active strike -> no cash; 5 -> blocked; an administrator block always blocks.
test('thresholds are the ones the owner chose', () => {
  assert.equal(CASH_OFF_AT, 1);
  assert.equal(BLOCK_AT, 5);
});

test('no strikes: everything allowed', () => {
  assert.deepEqual(standingOf(0, null), { strikes: 0, cashAllowed: true, blocked: false, manuallyBlocked: false });
});

test('one strike closes cash only', () => {
  assert.deepEqual(standingOf(1, null), { strikes: 1, cashAllowed: false, blocked: false, manuallyBlocked: false });
  assert.deepEqual(standingOf(4, null), { strikes: 4, cashAllowed: false, blocked: false, manuallyBlocked: false });
});

test('five strikes block', () => {
  assert.equal(standingOf(5, null).blocked, true);
  assert.equal(standingOf(9, null).blocked, true);
});

test('an administrator block blocks a customer with no strikes and closes cash', () => {
  assert.deepEqual(standingOf(0, new Date()), { strikes: 0, cashAllowed: false, blocked: true, manuallyBlocked: true });
});
