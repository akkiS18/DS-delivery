import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canRefundTransition, cancellationPlan, paymentAllowsRefund, resolveRefundAmount, validateAdminNote, validateBankReference,
  type RefundActor, type RefundStatus,
} from './workflow.js';

const STATUSES: RefundStatus[] = ['REQUESTED', 'APPROVED', 'REJECTED', 'SENT', 'CONFIRMED', 'DISPUTED'];
const ACTORS: RefundActor[] = ['CUSTOMER', 'RESTAURANT_STAFF', 'ADMIN'];

test('refund transitions: exactly the documented edges are allowed, nothing else', () => {
  const allowed = new Set([
    'REQUESTED>APPROVED:RESTAURANT_STAFF', 'REQUESTED>REJECTED:RESTAURANT_STAFF', 'APPROVED>SENT:RESTAURANT_STAFF',
    'SENT>CONFIRMED:CUSTOMER', 'SENT>CONFIRMED:ADMIN', 'SENT>DISPUTED:CUSTOMER', 'DISPUTED>SENT:RESTAURANT_STAFF',
    'DISPUTED>CONFIRMED:CUSTOMER', 'DISPUTED>CONFIRMED:ADMIN',
  ]);
  for (const from of STATUSES) for (const to of STATUSES) for (const who of ACTORS) {
    assert.equal(canRefundTransition(from, to, who), allowed.has(`${from}>${to}:${who}`), `${from}>${to} by ${who}`);
  }
});

test('the restaurant can never confirm its own refund; REJECTED and CONFIRMED are terminal', () => {
  for (const from of STATUSES) assert.equal(canRefundTransition(from, 'CONFIRMED', 'RESTAURANT_STAFF'), false);
  for (const to of STATUSES) for (const who of ACTORS) {
    assert.equal(canRefundTransition('REJECTED', to, who), false);
    assert.equal(canRefundTransition('CONFIRMED', to, who), false);
  }
});

test('cancellation plan: waiting, unpaid, refund and denied paths', () => {
  assert.deepEqual(cancellationPlan('WAITING_RESTAURANT', 'CUSTOMER'), { kind: 'WAITING' });
  assert.deepEqual(cancellationPlan('WAITING_CUSTOMER_CONSENT', 'CUSTOMER'), { kind: 'WAITING' });
  assert.deepEqual(cancellationPlan('PAYMENT_PENDING', 'CUSTOMER'), { kind: 'UNPAID' });
  for (const s of ['PAYMENT_MATCHED_UNVERIFIED', 'PAYMENT_CONFIRMED', 'PREPARING']) {
    assert.deepEqual(cancellationPlan(s, 'CUSTOMER'), { kind: 'REFUND', viaRequest: true }, s);
  }
  for (const s of ['READY', 'CANCELLATION_REQUESTED', 'CANCELLED', 'COMPLETED', 'DELIVERY_ASSUMED', 'PAYMENT_EXPIRED', 'FAILED', 'RESTAURANT_REJECTED']) {
    assert.equal(cancellationPlan(s, 'CUSTOMER').kind, 'DENIED', s);
  }
});

test('restaurant-initiated cancellation only for orders whose money the restaurant verified', () => {
  for (const s of ['PAYMENT_CONFIRMED', 'PREPARING', 'READY']) assert.deepEqual(cancellationPlan(s, 'RESTAURANT_STAFF'), { kind: 'REFUND', viaRequest: false }, s);
  for (const s of ['PAYMENT_MATCHED_UNVERIFIED', 'PAYMENT_PENDING', 'WAITING_RESTAURANT', 'CANCELLED', 'CANCELLATION_REQUESTED']) {
    assert.equal(cancellationPlan(s, 'RESTAURANT_STAFF').kind, 'DENIED', s);
  }
});

test('a payment must actually be matched/confirmed for a refund to exist', () => {
  assert.equal(paymentAllowsRefund('CONFIRMED_MANUAL', 'CUSTOMER'), true);
  assert.equal(paymentAllowsRefund('CONFIRMED_MANUAL', 'RESTAURANT_STAFF'), true);
  assert.equal(paymentAllowsRefund('MATCHED_UNVERIFIED', 'CUSTOMER'), true);
  assert.equal(paymentAllowsRefund('MATCHED_UNVERIFIED', 'RESTAURANT_STAFF'), false);
  for (const s of ['AWAITING', 'QUEUED', 'EXPIRED', 'CANCELLED', null]) {
    assert.equal(paymentAllowsRefund(s, 'CUSTOMER'), false, String(s));
    assert.equal(paymentAllowsRefund(s, 'RESTAURANT_STAFF'), false, String(s));
  }
});

test('a bank reference must be typed and plausible; a button press or filler is not accepted', () => {
  assert.equal(validateBankReference('  TRX-20261023-0042 '), 'TRX-20261023-0042');
  assert.equal(validateBankReference('A1B2C3D4'), 'A1B2C3D4');
  for (const bad of ['', '   ', 'ok', 'done', 'yes sent', '1', '123', 'aaaaaaaa', '1111111', 'x'.repeat(65), '<script>1234', 'screenshot.png;rm']) {
    assert.throws(() => validateBankReference(bad), /BANK_REFERENCE_NOTOGRI/, bad);
  }
});

test('admin confirmation needs a real note; amounts are bounded by what was paid', () => {
  assert.equal(validateAdminNote('  restoran hisobi tekshirildi  '), 'restoran hisobi tekshirildi');
  for (const bad of ['', 'ok', 'tekshirdi', 'x'.repeat(301)]) assert.throws(() => validateAdminNote(bad), /ADMIN_IZOH_NOTOGRI/);
  assert.equal(resolveRefundAmount(2_100_000n), 2_100_000n);
  assert.equal(resolveRefundAmount(2_100_000n, 1_000_000n), 1_000_000n);
  for (const bad of [0n, -1n, 2_100_001n]) assert.throws(() => resolveRefundAmount(2_100_000n, bad), /REFUND_SUMMASI_NOTOGRI/);
});
