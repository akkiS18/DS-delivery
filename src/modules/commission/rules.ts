/** Stage 6B pure rules: commission eligibility, configuration, refund presentation and report date ranges. No I/O. */

/** Stage 6D: the assigned taxi company's linked operator confirms delivery (taxi/service.ts completeDelivery), which moves
 *  the order READY -> COMPLETED with an audited OrderEvent. Taxi dispatch states, payment matching/confirmation and READY
 *  alone still never prove delivery. Informational (reported by the finance API); accrual is gated by the data itself
 *  (COMPLETED order + COMPLETED OrderEvent), never by this flag. */
export const DELIVERY_CONFIRMATION_IMPLEMENTED = true;

export const COMMISSION_RULE_CODE = 'FLAT_SOM';
export const DEFAULT_COMMISSION_SOM = 5000;
/** Stored on the ledger row of an order whose fee was baked into the customer's prices (the amount is that order's frozen fee). */
export const SERVICE_FEE_RULE_CODE = 'SERVICE_FEE';

/** Flat commission in som per delivered order. Fails closed on a bad value instead of silently charging something else. */
export function commissionFlatSom(env: Record<string, string | undefined> = process.env): number {
  const raw = env.COMMISSION_FLAT_SOM;
  if (raw === undefined || raw.trim() === '') return DEFAULT_COMMISSION_SOM;
  if (!/^[0-9]{1,7}$/.test(raw.trim())) throw new Error('COMMISSION_CONFIG_INVALID');
  const v = Number(raw.trim());
  if (!Number.isSafeInteger(v) || v < 1 || v > 1_000_000) throw new Error('COMMISSION_CONFIG_INVALID');
  return v;
}

export type NotEligibleReason =
  | 'NOT_COMPLETED' | 'NO_DELIVERY_PROOF' | 'TEST_ORDER' | 'NO_PAYMENT' | 'PAYMENT_NOT_VERIFIED' | 'REFUND_EXISTS'
  /** A service-fee order whose baked-in fee rounded to nothing: there is nothing to collect from the restaurant. */
  | 'NO_FEE';

export interface EligibilityInput {
  orderStatus: string;
  orderPaymentIsTest: boolean;
  hasCompletedEvent: boolean;
  payment: { status: string; isTest: boolean } | null;
  /** Statuses of every RefundRequest of the order. */
  refundStatuses: string[];
}

/** Commission is earned only for a genuinely delivered (COMPLETED + audited), restaurant-verified, non-test, refund-free order. */
export function commissionEligibility(i: EligibilityInput): { ok: true } | { ok: false; reason: NotEligibleReason } {
  if (i.orderStatus !== 'COMPLETED') return { ok: false, reason: 'NOT_COMPLETED' };
  if (!i.hasCompletedEvent) return { ok: false, reason: 'NO_DELIVERY_PROOF' };
  if (i.orderPaymentIsTest) return { ok: false, reason: 'TEST_ORDER' };
  if (!i.payment) return { ok: false, reason: 'NO_PAYMENT' };
  if (i.payment.isTest || i.payment.status !== 'CONFIRMED_MANUAL') return { ok: false, reason: 'PAYMENT_NOT_VERIFIED' };
  if (i.refundStatuses.some(s => s !== 'REJECTED')) return { ok: false, reason: 'REFUND_EXISTS' };
  return { ok: true };
}

// ---- refund presentation (never equates confirmation with bank settlement) ----
export type RefundStage =
  | 'REQUESTED' | 'APPROVED_AWAITING_SEND' | 'SENT_UNCONFIRMED' | 'CONFIRMED_BY_CUSTOMER' | 'CONFIRMED_BY_ADMIN' | 'DISPUTED' | 'REJECTED';

export function refundStage(status: string, confirmedByType: string | null): RefundStage {
  switch (status) {
    case 'REQUESTED': return 'REQUESTED';
    case 'APPROVED': return 'APPROVED_AWAITING_SEND';
    case 'SENT': return 'SENT_UNCONFIRMED';
    case 'DISPUTED': return 'DISPUTED';
    case 'REJECTED': return 'REJECTED';
    case 'CONFIRMED': return confirmedByType === 'ADMIN' ? 'CONFIRMED_BY_ADMIN' : 'CONFIRMED_BY_CUSTOMER';
    default: throw new Error(`UNKNOWN_REFUND_STATUS:${status}`);
  }
}
/** Open = the money question is not settled by both parties yet. */
export const isRefundUnresolved = (status: string): boolean => ['REQUESTED', 'APPROVED', 'SENT', 'DISPUTED'].includes(status);

export interface RefundRow { status: string; confirmedByType: string | null; paidAmountTiyin: bigint; approvedAmountTiyin: bigint | null }
export interface RefundTotals { count: number; amountTiyin: bigint }
export type RefundSummary = Record<RefundStage, RefundTotals> & { unresolved: RefundTotals };

/** Amount that is (or would be) refunded: the approved amount when decided, otherwise what was paid. */
export const refundAmountTiyin = (r: { paidAmountTiyin: bigint; approvedAmountTiyin: bigint | null }): bigint => r.approvedAmountTiyin ?? r.paidAmountTiyin;

export function summarizeRefunds(rows: RefundRow[]): RefundSummary {
  const zero = (): RefundTotals => ({ count: 0, amountTiyin: 0n });
  const out = {
    REQUESTED: zero(), APPROVED_AWAITING_SEND: zero(), SENT_UNCONFIRMED: zero(), CONFIRMED_BY_CUSTOMER: zero(),
    CONFIRMED_BY_ADMIN: zero(), DISPUTED: zero(), REJECTED: zero(), unresolved: zero(),
  } satisfies RefundSummary;
  for (const r of rows) {
    const t = out[refundStage(r.status, r.confirmedByType)];
    const amount = refundAmountTiyin(r);
    t.count += 1; t.amountTiyin += amount;
    if (isRefundUnresolved(r.status)) { out.unresolved.count += 1; out.unresolved.amountTiyin += amount; }
  }
  return out;
}

/** Payment amounts are stored in tiyin (1 som = 100 tiyin). */
export const tiyinToSom = (tiyin: bigint): number => Number(tiyin / 100n);

// ---- report date ranges ----
export const REPORT_TZ_OFFSET = '+05:00'; // Asia/Tashkent has no DST
export const MAX_RANGE_DAYS = 366;
export const DEFAULT_RANGE_DAYS = 30;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function parsePoint(s: string, edge: 'from' | 'to'): Date {
  let d: Date;
  if (DATE_ONLY.test(s)) {
    d = new Date(`${s}T00:00:00${REPORT_TZ_OFFSET}`);
    if (!Number.isNaN(d.getTime()) && edge === 'to') d = new Date(d.getTime() + 86_400_000); // date-only `to` is inclusive of that day
  } else if (DATE_TIME.test(s)) d = new Date(s);
  else throw new Error('DATE_FILTER_INVALID');
  if (Number.isNaN(d.getTime())) throw new Error('DATE_FILTER_INVALID');
  return d;
}

/** Half-open range [from, to). Defaults to the last 30 days. Date-only values are Asia/Tashkent days. */
export function parseReportRange(q: { from?: string; to?: string }, now = new Date()): { from: Date; to: Date } {
  const to = q.to ? parsePoint(q.to, 'to') : new Date(now.getTime() + 1);
  const from = q.from ? parsePoint(q.from, 'from') : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 86_400_000);
  if (from >= to) throw new Error('DATE_FILTER_INVALID');
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) throw new Error('DATE_RANGE_TOO_LARGE');
  return { from, to };
}
