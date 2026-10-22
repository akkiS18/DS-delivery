import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateTaxiDueAt, canFallback, needsCancellationAcknowledgement, operatorTransition, taxiStage } from './workflow.js';

test('schedule before food ready and clamp at preparation start', () => {
  const t = new Date('2026-10-14T10:00:00Z');
  assert.equal(calculateTaxiDueAt(t, 20, 7).toISOString(), '2026-10-14T10:13:00.000Z');
  assert.equal(calculateTaxiDueAt(t, 5, 7).toISOString(), t.toISOString());
});
test('no invalid preparation/lead time', () => {
  for (const n of [0, -1, 4.5, 241]) assert.throws(() => calculateTaxiDueAt(new Date(), n, 7));
  assert.throws(() => calculateTaxiDueAt(new Date(), 15, -1));
});
test('operator sent needs a prior acceptance, or an explicit clarification of an unanswered request', () => {
  assert.equal(operatorTransition('ACCEPTED', 'SENT'), 'ASSIGNED');
  assert.equal(operatorTransition('CANCELLATION_PENDING', 'SENT'), 'ASSIGNED');
  assert.throws(() => operatorTransition('REQUESTED', 'SENT'), /ESKIRGAN/); // a notification is not an accepted booking
});
test('acceptance only from a fresh request', () => {
  assert.equal(operatorTransition('REQUESTED', 'ACCEPT'), 'ACCEPTED');
  for (const s of ['SCHEDULED', 'SENDING', 'ACCEPTED', 'ASSIGNED', 'DECLINED', 'DELIVERED', 'NEEDS_HELP', 'CANCELLATION_PENDING'] as const) {
    assert.throws(() => operatorTransition(s, 'ACCEPT'), s);
  }
});
test('delivered and dispatched states accept no further operator answers', () => {
  for (const a of ['ACCEPT', 'SENT', 'NO_TAXI'] as const) {
    assert.throws(() => operatorTransition('DELIVERED', a));
    assert.throws(() => operatorTransition('ASSIGNED', a));
  }
  assert.equal(operatorTransition('ACCEPTED', 'NO_TAXI'), 'DECLINED');
});
test('stage mapping for the restaurant app', () => {
  assert.deepEqual(['SCHEDULED', 'SENDING', 'REQUESTED', 'ACCEPTED', 'ASSIGNED', 'DELIVERED', 'DECLINED', 'NEEDS_HELP', 'CANCELLATION_PENDING', 'CANCELLED'].map(taxiStage),
    ['SCHEDULED', 'REQUESTED', 'REQUESTED', 'ACCEPTED', 'DISPATCHED', 'DELIVERED', 'NEEDS_HELP', 'NEEDS_HELP', 'NEEDS_HELP', 'CANCELLED']);
});
test('no taxi explicitly declined including cancellation', () => {
  assert.equal(operatorTransition('REQUESTED', 'NO_TAXI'), 'DECLINED');
  assert.equal(operatorTransition('CANCELLATION_PENDING', 'NO_TAXI'), 'DECLINED');
});
test('stale or duplicate button is rejected', () => {
  for (const s of ['SCHEDULED', 'SENDING', 'ASSIGNED', 'DECLINED', 'DELIVERED'] as const) {
    assert.throws(() => operatorTransition(s, 'SENT'));
    assert.throws(() => operatorTransition(s, 'NO_TAXI'));
  }
});
test('no response must never automatically switch operators', () => {
  assert.equal(canFallback(true, false), false);
  assert.equal(canFallback(false, true), false);
  assert.equal(canFallback(true, true), true);
});
test('timeout requests cancellation acknowledgement instead of redispatch', () => {
  const now = new Date('2026-10-14T10:03:01Z');
  const deadline = new Date('2026-10-14T10:03:00Z');
  assert.equal(needsCancellationAcknowledgement('REQUESTED', deadline, now), true);
  assert.equal(needsCancellationAcknowledgement('ASSIGNED', deadline, now), false);
  assert.equal(needsCancellationAcknowledgement('REQUESTED', null, now), false);
});

test('uncertain send requires an explicit original operator outcome', () => {
  assert.equal(operatorTransition('NEEDS_HELP', 'SENT'), 'ASSIGNED');
  assert.equal(operatorTransition('NEEDS_HELP', 'NO_TAXI'), 'DECLINED');
  assert.equal(canFallback(true, false), false);
});
