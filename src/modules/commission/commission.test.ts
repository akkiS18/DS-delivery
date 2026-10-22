import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commissionEligibility, commissionFlatSom, parseReportRange, refundStage, summarizeRefunds, tiyinToSom, type EligibilityInput,
} from './rules.js';

const good: EligibilityInput = {
  orderStatus: 'COMPLETED', orderPaymentIsTest: false, hasCompletedEvent: true,
  payment: { status: 'CONFIRMED_MANUAL', isTest: false }, refundStatuses: [],
};

test('commission is earned only for a delivered, restaurant-verified, non-test, refund-free order', () => {
  assert.deepEqual(commissionEligibility(good), { ok: true });
  assert.deepEqual(commissionEligibility({ ...good, refundStatuses: ['REJECTED'] }), { ok: true });
  const reason = (over: Partial<EligibilityInput>) => { const v = commissionEligibility({ ...good, ...over }); return v.ok ? 'OK' : v.reason; };
  // Payment matched/confirmed, kitchen ready, taxi on its way, or "delivery assumed" are NOT delivery.
  for (const s of ['PAYMENT_MATCHED_UNVERIFIED', 'PAYMENT_CONFIRMED', 'PREPARING', 'READY', 'TAXI_REQUESTED', 'DRIVER_ASSIGNED', 'DELIVERY_ASSUMED',
    'CANCELLED', 'CANCELLATION_REQUESTED', 'RESTAURANT_REJECTED', 'CUSTOMER_CANCELLED', 'FAILED']) {
    assert.equal(reason({ orderStatus: s }), 'NOT_COMPLETED', s);
  }
  assert.equal(reason({ hasCompletedEvent: false }), 'NO_DELIVERY_PROOF');
  assert.equal(reason({ orderPaymentIsTest: true }), 'TEST_ORDER');
  assert.equal(reason({ payment: null }), 'NO_PAYMENT');
  for (const status of ['MATCHED_UNVERIFIED', 'AWAITING', 'QUEUED', 'EXPIRED', 'CANCELLED']) {
    assert.equal(reason({ payment: { status, isTest: false } }), 'PAYMENT_NOT_VERIFIED', status);
  }
  assert.equal(reason({ payment: { status: 'CONFIRMED_MANUAL', isTest: true } }), 'PAYMENT_NOT_VERIFIED');
  for (const s of ['REQUESTED', 'APPROVED', 'SENT', 'CONFIRMED', 'DISPUTED']) assert.equal(reason({ refundStatuses: [s] }), 'REFUND_EXISTS', s);
});

test('commission amount is configurable, integer, and fails closed', () => {
  assert.equal(commissionFlatSom({}), 5000);
  assert.equal(commissionFlatSom({ COMMISSION_FLAT_SOM: '' }), 5000);
  assert.equal(commissionFlatSom({ COMMISSION_FLAT_SOM: ' 7500 ' }), 7500);
  for (const bad of ['0', '-5', '5000.5', '5e3', 'abc', '1000001', '99999999']) {
    assert.throws(() => commissionFlatSom({ COMMISSION_FLAT_SOM: bad }), /COMMISSION_CONFIG_INVALID/, bad);
  }
});

test('refund stages separate requested / sent / customer-confirmed / admin-confirmed / disputed', () => {
  assert.equal(refundStage('REQUESTED', null), 'REQUESTED');
  assert.equal(refundStage('APPROVED', null), 'APPROVED_AWAITING_SEND');
  assert.equal(refundStage('SENT', null), 'SENT_UNCONFIRMED');
  assert.equal(refundStage('CONFIRMED', 'CUSTOMER'), 'CONFIRMED_BY_CUSTOMER');
  assert.equal(refundStage('CONFIRMED', 'ADMIN'), 'CONFIRMED_BY_ADMIN');
  assert.equal(refundStage('DISPUTED', null), 'DISPUTED');
  assert.equal(refundStage('REJECTED', null), 'REJECTED');
  assert.throws(() => refundStage('SETTLED', null), /UNKNOWN_REFUND_STATUS/);
});

test('refund summary: unresolved excludes rejected and confirmed; amount is approved amount else paid', () => {
  const s = summarizeRefunds([
    { status: 'REQUESTED', confirmedByType: null, paidAmountTiyin: 2_100_000n, approvedAmountTiyin: null },
    { status: 'SENT', confirmedByType: null, paidAmountTiyin: 1_000_000n, approvedAmountTiyin: 400_000n },
    { status: 'DISPUTED', confirmedByType: null, paidAmountTiyin: 500_000n, approvedAmountTiyin: 500_000n },
    { status: 'CONFIRMED', confirmedByType: 'CUSTOMER', paidAmountTiyin: 300_000n, approvedAmountTiyin: 300_000n },
    { status: 'CONFIRMED', confirmedByType: 'ADMIN', paidAmountTiyin: 200_000n, approvedAmountTiyin: 200_000n },
    { status: 'REJECTED', confirmedByType: null, paidAmountTiyin: 900_000n, approvedAmountTiyin: null },
  ]);
  assert.deepEqual(s.unresolved, { count: 3, amountTiyin: 3_000_000n });
  assert.equal(s.SENT_UNCONFIRMED.amountTiyin, 400_000n);
  assert.equal(s.CONFIRMED_BY_CUSTOMER.count, 1);
  assert.equal(s.CONFIRMED_BY_ADMIN.count, 1);
  assert.equal(s.REJECTED.count, 1);
  assert.equal(tiyinToSom(2_100_000n), 21_000);
});

test('report ranges: Tashkent day boundaries, half-open, bounded', () => {
  const now = new Date('2026-10-20T10:00:00Z');
  const r = parseReportRange({ from: '2026-10-01', to: '2026-10-02' }, now);
  assert.equal(r.from.toISOString(), '2026-09-30T19:00:00.000Z');
  assert.equal(r.to.toISOString(), '2026-10-02T19:00:00.000Z'); // `to` date is inclusive
  const d = parseReportRange({}, now);
  assert.equal(d.to.getTime() - d.from.getTime(), 30 * 86_400_000);
  assert.equal(parseReportRange({ from: '2026-10-01T00:00:00Z', to: '2026-10-01T12:00:00Z' }, now).to.toISOString(), '2026-10-01T12:00:00.000Z');
  for (const bad of [{ from: 'yesterday' }, { from: '2026-13-01' }, { from: '2026-10-05', to: '2026-10-01' }, { from: '2026-10-01T00:00:00' }]) {
    assert.throws(() => parseReportRange(bad, now), /DATE_FILTER_INVALID/, JSON.stringify(bad));
  }
  assert.throws(() => parseReportRange({ from: '2025-01-01', to: '2026-10-01' }, now), /DATE_RANGE_TOO_LARGE/);
});
