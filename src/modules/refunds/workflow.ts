/** Pure rules of the Stage 6A cancellation/refund workflow (no database, no I/O). DS Delivery never moves money:
 *  the restaurant refunds from its own account and the platform only records who said what. */

export const CUSTOMER_REASONS = ['CHANGED_MIND', 'TOO_SLOW', 'WRONG_ORDER', 'OTHER'] as const;
export const RESTAURANT_REASONS = ['OUT_OF_STOCK', 'CANNOT_FULFIL', 'CLOSED', 'OTHER'] as const;
export const REJECT_REASONS = ['MONEY_NOT_RECEIVED', 'ALREADY_PREPARED', 'POLICY', 'OTHER'] as const;

export type RefundStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'SENT' | 'CONFIRMED' | 'DISPUTED';
export type RefundActor = 'CUSTOMER' | 'RESTAURANT_STAFF' | 'ADMIN';
export const OPEN_REFUND: readonly RefundStatus[] = ['REQUESTED', 'APPROVED', 'SENT', 'DISPUTED'];

/** Allowed refund transitions and who may perform them. Everything else is rejected. REJECTED and CONFIRMED are terminal.
 *  The restaurant can never confirm its own refund: CONFIRMED needs the customer or a DS admin. */
const TRANSITIONS: ReadonlyArray<readonly [RefundStatus, RefundStatus, readonly RefundActor[]]> = [
  ['REQUESTED', 'APPROVED', ['RESTAURANT_STAFF']],
  ['REQUESTED', 'REJECTED', ['RESTAURANT_STAFF']],
  ['APPROVED', 'SENT', ['RESTAURANT_STAFF']],
  ['SENT', 'CONFIRMED', ['CUSTOMER', 'ADMIN']],
  ['SENT', 'DISPUTED', ['CUSTOMER']],
  ['DISPUTED', 'SENT', ['RESTAURANT_STAFF']],
  ['DISPUTED', 'CONFIRMED', ['CUSTOMER', 'ADMIN']],
];
export function canRefundTransition(from: RefundStatus, to: RefundStatus, actor: RefundActor): boolean {
  return TRANSITIONS.some(([f, t, who]) => f === from && t === to && who.includes(actor));
}

export type CancelPlan =
  | { kind: 'WAITING' }                       // not accepted yet: handled by the Stage 4B cancel path
  | { kind: 'UNPAID' }                        // payment attempt still open: cancel it, no money involved
  | { kind: 'REFUND'; viaRequest: boolean }   // money was (possibly) received: refund workflow
  | { kind: 'DENIED'; reason: string };

const WAITING = ['WAITING_RESTAURANT', 'WAITING_CUSTOMER_CONSENT'];
/** Which cancellation path an order state allows. Customers may start a refund request while the restaurant has not
 *  finished cooking. Once the restaurant pressed "ready" nobody can cancel (Stage 9): the food exists and a driver is being arranged. */
export function cancellationPlan(orderStatus: string, initiator: 'CUSTOMER' | 'RESTAURANT_STAFF'): CancelPlan {
  if (WAITING.includes(orderStatus)) return initiator === 'CUSTOMER' ? { kind: 'WAITING' } : { kind: 'DENIED', reason: 'USE_REJECT' };
  if (orderStatus === 'PAYMENT_PENDING') return initiator === 'CUSTOMER' ? { kind: 'UNPAID' } : { kind: 'DENIED', reason: 'NOT_PAID' };
  if (initiator === 'CUSTOMER') {
    return ['PAYMENT_MATCHED_UNVERIFIED', 'PAYMENT_CONFIRMED', 'PREPARING'].includes(orderStatus)
      ? { kind: 'REFUND', viaRequest: true } : { kind: 'DENIED', reason: 'INVALID_STATE' };
  }
  return ['PAYMENT_CONFIRMED', 'PREPARING'].includes(orderStatus)
    ? { kind: 'REFUND', viaRequest: false } : { kind: 'DENIED', reason: 'INVALID_STATE' };
}

/** The payment must agree with the order: money can only be refunded if a match/confirmation exists. */
export function paymentAllowsRefund(paymentStatus: string | null, initiator: 'CUSTOMER' | 'RESTAURANT_STAFF'): boolean {
  if (paymentStatus === 'CONFIRMED_MANUAL') return true;
  return initiator === 'CUSTOMER' && paymentStatus === 'MATCHED_UNVERIFIED';
}

/** A bank transfer reference typed by the restaurant. A bare button press (or "ok") is not accepted. */
export function validateBankReference(raw: string): string {
  const ref = raw.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._/#:-]{3,63}$/.test(ref) || !/\d/.test(ref) || /^(.)\1+$/.test(ref)) {
    throw new Error('BANK_REFERENCE_NOTOGRI');
  }
  return ref;
}

export function validateAdminNote(raw: string): string {
  const note = raw.trim();
  if (note.length < 10 || note.length > 300) throw new Error('ADMIN_IZOH_NOTOGRI');
  return note;
}

/** Approved amount in tiyin: default = everything that was paid; never more, never zero. */
export function resolveRefundAmount(paid: bigint, requested?: bigint): bigint {
  const amount = requested ?? paid;
  if (amount <= 0n || amount > paid) throw new Error('REFUND_SUMMASI_NOTOGRI');
  return amount;
}
