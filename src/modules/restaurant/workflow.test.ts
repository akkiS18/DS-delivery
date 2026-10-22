import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planStaffTransition, PREP_CHOICES } from './workflow.js';

test('payment match requires bank check from staff', () => {
  assert.deepEqual(planStaffTransition('PAYMENT_MATCHED_UNVERIFIED', 'MATCHED_UNVERIFIED', 'VERIFY_PAYMENT'), {
    from: 'PAYMENT_MATCHED_UNVERIFIED', to: 'PAYMENT_CONFIRMED', action: 'VERIFY_PAYMENT',
  });
});
test('queued/awaiting payments cannot be verified', () => {
  for (const status of ['QUEUED', 'AWAITING', 'EXPIRED']) {
    assert.throws(() => planStaffTransition('PAYMENT_PENDING', status, 'VERIFY_PAYMENT'));
  }
});
test('payment matcher alone cannot start food preparation', () => {
  assert.throws(() => planStaffTransition('PAYMENT_MATCHED_UNVERIFIED', 'MATCHED_UNVERIFIED', 'START_PREPARING', 15));
});
test('prep accepted only from verified payment', () => {
  for (const minutes of PREP_CHOICES) {
    assert.equal(planStaffTransition('PAYMENT_CONFIRMED', 'CONFIRMED_MANUAL', 'START_PREPARING', minutes).to, 'PREPARING');
  }
  // Stage 6E: any whole number of minutes 5..120 (the restaurant default range); the Telegram quick buttons are only a subset
  for (const minutes of [5, 25, 61, 90, 120]) {
    assert.equal(planStaffTransition('PAYMENT_CONFIRMED', 'CONFIRMED_MANUAL', 'START_PREPARING', minutes).to, 'PREPARING');
  }
  for (const minutes of [0, 1, 4, 121, -1, 10.5, Number.NaN]) {
    assert.throws(() => planStaffTransition('PAYMENT_CONFIRMED', 'CONFIRMED_MANUAL', 'START_PREPARING', minutes));
  }
});
test('ready only from preparing, duplicate callback not accepted', () => {
  assert.equal(planStaffTransition('PREPARING', 'CONFIRMED_MANUAL', 'MARK_READY').to, 'READY');
  assert.throws(() => planStaffTransition('READY', 'CONFIRMED_MANUAL', 'MARK_READY'));
});
test('manual confirmation cannot be applied twice', () => {
  assert.throws(() => planStaffTransition('PAYMENT_CONFIRMED', 'CONFIRMED_MANUAL', 'VERIFY_PAYMENT'));
});
