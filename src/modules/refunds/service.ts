import { customerWhere } from '../../lib/customer-owner.js';
import { Prisma, type OrderStatus } from '@prisma/client';
import { db } from '../../lib/db.js';
import type { PaymentEngineV3 } from '../payment/engine.js';
import { isSupportAdmin } from '../support/service.js';
import {
  CUSTOMER_REASONS, REJECT_REASONS, RESTAURANT_REASONS, canRefundTransition, cancellationPlan, paymentAllowsRefund,
  resolveRefundAmount, validateAdminNote, validateBankReference, type RefundActor, type RefundStatus,
} from './workflow.js';

type Tx = Prisma.TransactionClient;

async function lockOrder(tx: Tx, orderId: string): Promise<string | null> {
  const rows = await tx.$queryRaw<Array<{ status: string }>>`SELECT "status"::text AS status FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
  return rows[0]?.status ?? null;
}
async function refundEvent(tx: Tx, refundId: string, actorId: string, actorType: string, action: string,
  fromStatus: string | null, toStatus: string | null, details?: Prisma.InputJsonValue) {
  await tx.refundEvent.create({ data: { refundId, actorId, actorType, action, fromStatus, toStatus, ...(details ? { details } : {}) } });
}
/** Scheduled taxi requests are cancelled; anything already sent to an operator cannot be undone here and is only flagged. */
async function neutralizeTaxi(tx: Tx, orderId: string): Promise<{ cancelledScheduled: number; active: boolean }> {
  const { count } = await tx.taxiDispatch.updateMany({ where: { orderId, status: 'SCHEDULED' }, data: { status: 'CANCELLED' } });
  const active = await tx.taxiDispatch.count({
    where: { orderId, status: { in: ['SENDING', 'REQUESTED', 'CANCELLATION_PENDING', 'ASSIGNED', 'NEEDS_HELP'] } },
  });
  return { cancelledScheduled: count, active: active > 0 };
}

// ---------------------------------------------------------------- unpaid cancellation (customer)
export type CancelUnpaidResult =
  | { result: 'CANCELLED' } | { result: 'NOT_FOUND' } | { result: 'USE_REFUND_REQUEST' }
  | { result: 'NOT_CANCELLABLE'; status: string };

/** Customer cancels an accepted order whose payment attempt is still open (nothing matched). Runs under the payment
 *  lock, so it is serialized with Gmail matching: either the match wins (order is then a paid order and this returns
 *  USE_REFUND_REQUEST) or the open attempt is cancelled first and a late transfer becomes a manual-review item. */
export async function cancelUnpaidOrder(engine: PaymentEngineV3, input: { telegramUserId: string; orderId: string; customerId?: string }): Promise<CancelUnpaidResult> {
  // For a guest session `telegramUserId` is only the audit label ("guest:<customerId>"); ownership is decided by customerId.
  const owned = await db.order.findFirst({ where: { id: input.orderId, customer: customerWhere(input.customerId ? { customerId: input.customerId } : input.telegramUserId) }, select: { id: true } });
  if (!owned) return { result: 'NOT_FOUND' };
  return engine.runLocked(async (tx): Promise<CancelUnpaidResult> => {
    const now = new Date();
    const status = await lockOrder(tx, owned.id);
    if (status === null) return { result: 'NOT_FOUND' };
    const plan = cancellationPlan(status, 'CUSTOMER');
    if (plan.kind === 'REFUND') return { result: 'USE_REFUND_REQUEST' };
    if (plan.kind !== 'UNPAID') return { result: 'NOT_CANCELLABLE', status };
    const pay = await engine.cancelOpenPayment(tx, owned.id, now, { type: 'CUSTOMER', id: input.telegramUserId });
    if (!pay.cancelled && pay.status !== null) return { result: 'NOT_CANCELLABLE', status: pay.status };
    const { count } = await tx.order.updateMany({
      where: { id: owned.id, status: 'PAYMENT_PENDING' },
      data: { status: 'CANCELLED', cancelledAt: now, cancelledBy: input.telegramUserId, cancelReason: 'CUSTOMER_UNPAID', customerLastNotifiedStatus: null },
    });
    if (count !== 1) return { result: 'NOT_CANCELLABLE', status };
    await tx.orderEvent.create({ data: {
      orderId: owned.id, actorTelegramId: input.telegramUserId, actorType: 'CUSTOMER', action: 'CANCEL_UNPAID',
      fromStatus: 'PAYMENT_PENDING', toStatus: 'CANCELLED', details: { paymentStatus: pay.status },
    } });
    return { result: 'CANCELLED' };
  });
}

// ---------------------------------------------------------------- cancellation of a paid order -> refund request
export type RequestResult =
  | { result: 'REQUESTED' | 'APPROVED'; refundId: string; number: number }
  | { result: 'NOT_FOUND' } | { result: 'ALREADY_REQUESTED'; number: number }
  | { result: 'USE_UNPAID_CANCEL' } | { result: 'USE_WAITING_CANCEL' }
  | { result: 'NOT_ALLOWED'; status: string };

/** CUSTOMER: asks the restaurant to cancel; the order goes to CANCELLATION_REQUESTED and stays frozen (no verify,
 *  start-cooking or ready transition can succeed) until the restaurant decides.
 *  RESTAURANT_STAFF: cancels its own verified order; the refund is created already APPROVED and the order is CANCELLED.
 *  Ownership is checked by Telegram id inside the same transaction; the order row is locked so a concurrent
 *  payment verification, cooking start or taxi dispatch sees exactly one consistent state. */
export async function requestCancellation(input: {
  actorType: 'CUSTOMER' | 'RESTAURANT_STAFF'; actorTelegramId: string; orderId: string; reasonCode: string; note?: string;
  /** Restaurant app: scope the restaurant by its authenticated id instead of a staff Telegram id (actorTelegramId is then
   *  only the audit label, e.g. "restaurant-api:<id>"). */
  restaurantId?: string;
  /** Customer scope for an Android guest session (actorTelegramId is then only the audit label). */
  customerId?: string;
}): Promise<RequestResult> {
  const allowed: readonly string[] = input.actorType === 'CUSTOMER' ? CUSTOMER_REASONS : RESTAURANT_REASONS;
  if (!allowed.includes(input.reasonCode)) throw new Error('SABAB_NOTOGRI');
  const note = input.note?.trim().slice(0, 300) || undefined;
  try {
    return await db.$transaction(async (tx): Promise<RequestResult> => {
      const now = new Date();
      const order = await tx.order.findFirst({
        where: { id: input.orderId, ...(input.actorType === 'CUSTOMER'
          ? { customer: customerWhere(input.customerId ? { customerId: input.customerId } : input.actorTelegramId) }
          : { createdViaBot: true, restaurant: input.restaurantId ? { id: input.restaurantId } : { staffTelegramUserId: input.actorTelegramId } }) },
        include: { payment: true },
      });
      if (!order) return { result: 'NOT_FOUND' };
      const status = await lockOrder(tx, order.id);
      if (status === null) return { result: 'NOT_FOUND' };
      const open = await tx.refundRequest.findFirst({ where: { orderId: order.id, status: { in: ['REQUESTED', 'APPROVED', 'SENT', 'DISPUTED'] } }, select: { number: true } });
      if (open) return { result: 'ALREADY_REQUESTED', number: open.number };
      const plan = cancellationPlan(status, input.actorType);
      if (plan.kind === 'UNPAID') return { result: 'USE_UNPAID_CANCEL' };
      if (plan.kind === 'WAITING') return { result: 'USE_WAITING_CANCEL' };
      if (plan.kind === 'DENIED') return { result: 'NOT_ALLOWED', status };
      const pay = await tx.payment.findUnique({ where: { orderId: order.id } }); // re-read after the lock
      if (!pay || !paymentAllowsRefund(pay.status, input.actorType)) return { result: 'NOT_ALLOWED', status };
      const staff = input.actorType === 'RESTAURANT_STAFF';
      const refund = await tx.refundRequest.create({ data: {
        orderId: order.id, paymentId: pay.id, kind: staff ? 'RESTAURANT_CANCEL' : 'CUSTOMER_CANCEL',
        status: staff ? 'APPROVED' : 'REQUESTED', reasonCode: input.reasonCode, reasonNote: note ?? null,
        paidAmountTiyin: pay.amountTiyin, approvedAmountTiyin: staff ? pay.amountTiyin : null,
        orderStatusBefore: status, paymentStatusAtRequest: pay.status,
        requestedBy: input.actorTelegramId, requestedByType: input.actorType,
        ...(staff ? { decidedBy: input.actorTelegramId, decidedAt: now } : {}),
      } });
      let taxiActive = false;
      if (staff) {
        const taxi = await neutralizeTaxi(tx, order.id);
        taxiActive = taxi.active;
        await tx.refundRequest.update({ where: { id: refund.id }, data: { taxiActiveAtDecision: taxi.active } });
      }
      const moved = await tx.order.updateMany({
        where: { id: order.id, status: status as OrderStatus },
        data: staff
          ? { status: 'CANCELLED', cancelledAt: now, cancelledBy: input.actorTelegramId, cancelReason: `RESTAURANT_${input.reasonCode}` }
          : { status: 'CANCELLATION_REQUESTED' },
      });
      if (moved.count !== 1) throw new Error('HOLAT_ORALIQDA_OZGARDI');
      await tx.orderEvent.create({ data: {
        orderId: order.id, actorTelegramId: input.actorTelegramId, actorType: staff ? 'RESTAURANT_STAFF' : 'CUSTOMER',
        action: staff ? 'CANCEL_PAID' : 'CANCEL_REQUESTED', fromStatus: status as OrderStatus,
        toStatus: staff ? 'CANCELLED' : 'CANCELLATION_REQUESTED', details: { refundNumber: refund.number, reasonCode: input.reasonCode },
      } });
      await refundEvent(tx, refund.id, input.actorTelegramId, input.actorType, staff ? 'CREATED_APPROVED' : 'REQUESTED', null,
        refund.status, { reasonCode: input.reasonCode, paidTiyin: pay.amountTiyin.toString(), orderStatusBefore: status, taxiActive });
      return { result: staff ? 'APPROVED' : 'REQUESTED', refundId: refund.id, number: refund.number };
    });
  } catch (err) {
    // A concurrent identical request lost to the partial unique index.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const open = await db.refundRequest.findFirst({ where: { orderId: input.orderId, status: { in: ['REQUESTED', 'APPROVED', 'SENT', 'DISPUTED'] } }, select: { number: true } });
      if (open) return { result: 'ALREADY_REQUESTED', number: open.number };
    }
    if (err instanceof Error && err.message === 'HOLAT_ORALIQDA_OZGARDI') return { result: 'NOT_ALLOWED', status: 'CHANGED' };
    throw err;
  }
}

// ---------------------------------------------------------------- restaurant decision / sending
export type StepResult<T = object> = ({ result: 'DONE' } & T) | { result: 'NOT_FOUND' } | { result: 'STALE'; status: string };

async function staffRefund(tx: Tx, actor: string, refundId: string, restaurantId?: string) {
  const refund = await tx.refundRequest.findFirst({
    where: { id: refundId, order: { createdViaBot: true, restaurant: restaurantId ? { id: restaurantId } : { staffTelegramUserId: actor } } },
  });
  if (!refund) throw new Error('RUXSAT_YOQ');
  return refund;
}

/** Restaurant decides a customer's request. Approval cancels the order and (when still only scheduled) its taxi
 *  request in the same transaction; rejection puts the order back exactly where it was. */
export async function decideRefund(input: {
  actorTelegramId: string; refundId: string; decision: 'APPROVE' | 'REJECT'; amountTiyin?: bigint; rejectReason?: string; restaurantId?: string;
}): Promise<StepResult> {
  if (input.decision === 'REJECT' && !REJECT_REASONS.some(r => r === input.rejectReason)) throw new Error('RAD_SABABI_NOTOGRI');
  return db.$transaction(async (tx): Promise<StepResult> => {
    const now = new Date();
    const refund = await staffRefund(tx, input.actorTelegramId, input.refundId, input.restaurantId);
    await lockOrder(tx, refund.orderId);
    const to: RefundStatus = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    if (!canRefundTransition('REQUESTED', to, 'RESTAURANT_STAFF')) throw new Error('NOTOGRI_OTISH');
    const amount = input.decision === 'APPROVE' ? resolveRefundAmount(refund.paidAmountTiyin, input.amountTiyin) : null;
    const claimed = await tx.refundRequest.updateMany({
      where: { id: refund.id, status: 'REQUESTED' },
      data: { status: to, decidedBy: input.actorTelegramId, decidedAt: now,
        ...(amount !== null ? { approvedAmountTiyin: amount } : { rejectReason: input.rejectReason }) },
    });
    if (claimed.count !== 1) {
      const cur = await tx.refundRequest.findUniqueOrThrow({ where: { id: refund.id }, select: { status: true } });
      await refundEvent(tx, refund.id, input.actorTelegramId, 'RESTAURANT_STAFF', 'DECISION_REJECTED', cur.status, cur.status, { attempted: to });
      return { result: 'STALE', status: cur.status };
    }
    let taxiActive = false;
    if (to === 'APPROVED') {
      const moved = await tx.order.updateMany({ where: { id: refund.orderId, status: 'CANCELLATION_REQUESTED' },
        data: { status: 'CANCELLED', cancelledAt: now, cancelledBy: input.actorTelegramId, cancelReason: 'REFUND_APPROVED' } });
      if (moved.count !== 1) throw new Error('HOLAT_ORALIQDA_OZGARDI');
      const taxi = await neutralizeTaxi(tx, refund.orderId);
      taxiActive = taxi.active;
      await tx.refundRequest.update({ where: { id: refund.id }, data: { taxiActiveAtDecision: taxi.active } });
    } else {
      const moved = await tx.order.updateMany({ where: { id: refund.orderId, status: 'CANCELLATION_REQUESTED' },
        data: { status: refund.orderStatusBefore as OrderStatus } });
      if (moved.count !== 1) throw new Error('HOLAT_ORALIQDA_OZGARDI');
    }
    await tx.orderEvent.create({ data: {
      orderId: refund.orderId, actorTelegramId: input.actorTelegramId, actorType: 'RESTAURANT_STAFF',
      action: to === 'APPROVED' ? 'CANCEL_APPROVED' : 'CANCEL_REJECTED', fromStatus: 'CANCELLATION_REQUESTED',
      toStatus: to === 'APPROVED' ? 'CANCELLED' : (refund.orderStatusBefore as OrderStatus), details: { refundId: refund.id, taxiActive },
    } });
    await refundEvent(tx, refund.id, input.actorTelegramId, 'RESTAURANT_STAFF', to === 'APPROVED' ? 'APPROVED' : 'REJECTED', 'REQUESTED', to,
      to === 'APPROVED' ? { approvedTiyin: amount!.toString(), taxiActive } : { reason: input.rejectReason! });
    return { result: 'DONE' };
  });
}

/** The restaurant says it sent the money and MUST give the bank reference. This is a claim, not a settlement:
 *  it moves the request to SENT only, and the restaurant can never move it to CONFIRMED itself. */
export async function markRefundSent(input: {
  actorTelegramId: string; refundId: string; bankReference: string; sentAmountTiyin?: bigint; restaurantId?: string;
}): Promise<StepResult> {
  const reference = validateBankReference(input.bankReference);
  return db.$transaction(async (tx): Promise<StepResult> => {
    const refund = await staffRefund(tx, input.actorTelegramId, input.refundId, input.restaurantId);
    if (!canRefundTransition(refund.status as RefundStatus, 'SENT', 'RESTAURANT_STAFF')) {
      await refundEvent(tx, refund.id, input.actorTelegramId, 'RESTAURANT_STAFF', 'SEND_REJECTED', refund.status, refund.status);
      return { result: 'STALE', status: refund.status };
    }
    if (input.sentAmountTiyin !== undefined && input.sentAmountTiyin !== refund.approvedAmountTiyin) throw new Error('REFUND_SUMMASI_MOS_EMAS');
    if (refund.bankReference && refund.bankReference.toLowerCase() === reference.toLowerCase()) throw new Error('BANK_REFERENCE_TAKROR');
    const claimed = await tx.refundRequest.updateMany({
      where: { id: refund.id, status: refund.status },
      data: { status: 'SENT', sentBy: input.actorTelegramId, sentAt: new Date(), bankReference: reference,
        customerSentNotifiedAt: null, disputeNotifiedAt: null, disputedAt: null },
    });
    if (claimed.count !== 1) return { result: 'STALE', status: 'CHANGED' };
    await refundEvent(tx, refund.id, input.actorTelegramId, 'RESTAURANT_STAFF', 'SENT', refund.status, 'SENT',
      { bankReference: reference, previousReference: refund.bankReference });
    return { result: 'DONE' };
  });
}

// ---------------------------------------------------------------- attestation: customer or DS admin
async function attest(tx: Tx, refundId: string, to: 'CONFIRMED' | 'DISPUTED', actor: { id: string; type: 'CUSTOMER' | 'ADMIN' }, note?: string): Promise<StepResult> {
  const refund = await tx.refundRequest.findUniqueOrThrow({ where: { id: refundId } });
  if (!canRefundTransition(refund.status as RefundStatus, to, actor.type as RefundActor)) {
    await refundEvent(tx, refund.id, actor.id, actor.type, 'ATTEST_REJECTED', refund.status, refund.status, { attempted: to });
    return { result: 'STALE', status: refund.status };
  }
  const now = new Date();
  const claimed = await tx.refundRequest.updateMany({
    where: { id: refund.id, status: refund.status },
    data: to === 'CONFIRMED'
      ? { status: 'CONFIRMED', confirmedBy: actor.id, confirmedByType: actor.type, confirmedAt: now, confirmNote: note ?? null }
      : { status: 'DISPUTED', disputedAt: now },
  });
  if (claimed.count !== 1) return { result: 'STALE', status: 'CHANGED' };
  await refundEvent(tx, refund.id, actor.id, actor.type, to, refund.status, to, note ? { note } : undefined);
  return { result: 'DONE' };
}

/** The customer says "received" or "not received". Only the owner of the order (by Telegram id) can answer. */
export async function customerAnswerRefund(input: { telegramUserId: string; refundId: string; received: boolean }): Promise<StepResult> {
  return db.$transaction(async tx => {
    const own = await tx.refundRequest.findFirst({ where: { id: input.refundId, order: { customer: { telegramUserId: input.telegramUserId } } }, select: { id: true } });
    if (!own) return { result: 'NOT_FOUND' } as const;
    return attest(tx, own.id, input.received ? 'CONFIRMED' : 'DISPUTED', { id: input.telegramUserId, type: 'CUSTOMER' });
  });
}

/** A DS admin (support admin ids) can confirm after checking independently; a typed note of at least 10 characters is
 *  mandatory and stored. This is an attestation, not bank verification. */
export async function adminConfirmRefund(input: { adminTelegramId: string; refundId: string; note: string }): Promise<StepResult> {
  if (!isSupportAdmin(input.adminTelegramId)) throw new Error('ADMIN_RUXSAT_YOQ');
  const note = validateAdminNote(input.note);
  return db.$transaction(async tx => {
    if (!await tx.refundRequest.findUnique({ where: { id: input.refundId }, select: { id: true } })) return { result: 'NOT_FOUND' } as const;
    return attest(tx, input.refundId, 'CONFIRMED', { id: input.adminTelegramId, type: 'ADMIN' }, note);
  });
}
