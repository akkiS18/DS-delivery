import { Prisma, type TaxiDispatchStatus } from '@prisma/client';
import { db } from '../../lib/db.js';
import { accrueCommissionTx, type AccrueResult } from '../commission/ledger.js';
import { createNextAttempt, eligibleCompanyWhere, nextEligibleCompany } from './assignment.js';
import { calculateTaxiDueAt, canFallback, operatorTransition, type OperatorAction } from './workflow.js';

export type Transaction = Prisma.TransactionClient;
/** How long an accepted booking may wait for "Taksi yuborildi" before it is escalated (never auto-redispatched). */
export const acceptToSentSeconds = Number(process.env.TAXI_ACCEPT_TO_SENT_SECONDS ?? 900);
const leadMinutes = Number(process.env.TAXI_LEAD_MINUTES ?? 7);
if (!Number.isSafeInteger(leadMinutes) || leadMinutes < 0 || leadMinutes > 120) {
  throw new Error('TAXI_LEAD_MINUTES 0–120 oralig‘ida bo‘lsin');
}

/** Must be called from the SAME transaction that starts cooking. */
export async function scheduleTaxiWhenPreparing(
  tx: Transaction,
  order: { id: string; taxiCompanyId: string | null; createdViaBot: boolean },
  prepMinutes: number,
  now: Date,
): Promise<void> {
  if (!order.createdViaBot) return;
  const existing = await tx.taxiDispatch.count({ where: { orderId: order.id } });
  if (existing) return;
  // Dispatch is automatic: the restaurant never requests a taxi. The customer's chosen company is used; an order
  // without one gets the first eligible company (active, operator linked) so it is never left without a taxi step.
  let companyId = order.taxiCompanyId;
  if (!companyId) {
    const eligible = await tx.taxiCompany.findFirst({
      where: eligibleCompanyWhere(), orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true },
    });
    if (!eligible) {
      await tx.orderEvent.create({ data: { orderId: order.id, actorTelegramId: 'SYSTEM', actorType: 'SYSTEM', action: 'TAXI_NO_ELIGIBLE_COMPANY',
        fromStatus: 'PREPARING', toStatus: 'PREPARING' } });
      return;
    }
    companyId = eligible.id;
    await tx.order.update({ where: { id: order.id }, data: { taxiCompanyId: companyId } });
  }
  await tx.taxiDispatch.create({
    data: { orderId: order.id, taxiCompanyId: companyId, attemptNo: 1,
      dueAt: calculateTaxiDueAt(now, prepMinutes, leadMinutes), status: 'SCHEDULED' },
  });
}

/** If cooking finishes early, ask the scheduler to dispatch now. No double-send. */
export async function advanceTaxiWhenReady(tx: Transaction, orderId: string, now: Date): Promise<void> {
  await tx.taxiDispatch.updateMany({
    where: { orderId, status: 'SCHEDULED', dueAt: { gt: now } },
    data: { dueAt: now },
  });
}

export async function taxiCompanyForOperator(telegramUserId: string) {
  return db.taxiCompany.findUnique({
    where: { operatorTelegramUserId: telegramUserId },
    select: { id: true, name: true, isActive: true },
  });
}

/** The operator side of a dispatch is authorized either by the Telegram id linked to the company (bot) or, for the DS Taxi app, by the company
 *  its session belongs to. Both compare against the dispatch's OWN company, so one operator can never reach another company's requests. */
export type TaxiActor = { actorTelegramId: string; actorCompanyId?: string };
const isCompanyActor = (d: { taxiCompanyId: string; taxiCompany: { operatorTelegramUserId: string | null } }, a: TaxiActor): boolean =>
  a.actorCompanyId !== undefined ? d.taxiCompanyId === a.actorCompanyId : d.taxiCompany.operatorTelegramUserId === a.actorTelegramId;

export async function taxiDispatchDetails(telegramUserId: string, dispatchId: string, companyId?: string) {
  return db.taxiDispatch.findFirst({
    where: { id: dispatchId, taxiCompany: companyId !== undefined ? { id: companyId } : { operatorTelegramUserId: telegramUserId } },
    include: {
      taxiCompany: { select: { name: true, operatorTelegramUserId: true } },
      order: { include: {
        restaurant: { select: { name: true, pickupAddress: true, pickupPhone: true } },
        customer: { select: { displayName: true } },
      } },
    },
  });
}

export type TaxiActionResult = {
  changed: boolean;
  finalStatus: TaxiDispatchStatus | 'STALE';
  fallbackCompany: string | null;
  nextDispatchId: string | null;
};

/** Locks the order row to serialize operator replies, then CASes this dispatch.
 *  Only an explicit NO_TAXI reply permits a consented fallback.
 *  Timeout never silently causes a second car to be dispatched.
 */
export async function respondToTaxi(input: {
  actorTelegramId: string;
  actorCompanyId?: string;
  dispatchId: string;
  action: OperatorAction;
}): Promise<TaxiActionResult> {
  return db.$transaction(async tx => {
    const candidate = await tx.taxiDispatch.findUnique({ where: { id: input.dispatchId }, select: { orderId: true } });
    if (!candidate) throw new Error('TAKSI_SOROVI_TOPILMADI');
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${candidate.orderId} FOR UPDATE`;
    const dispatch = await tx.taxiDispatch.findUnique({
      where: { id: input.dispatchId },
      include: { taxiCompany: true, order: true },
    });
    if (!dispatch || !isCompanyActor(dispatch, input)) {
      throw new Error('TAKSI_OPERATOR_RUXSAT_YOQ');
    }
    if (!['REQUESTED', 'ACCEPTED', 'CANCELLATION_PENDING', 'NEEDS_HELP'].includes(dispatch.status)) {
      return { changed: false, finalStatus: 'STALE', fallbackCompany: null, nextDispatchId: null };
    }
    // PREPARING/READY are deliberately independent from taxi dispatch status.
    if (!['PREPARING', 'READY'].includes(dispatch.order.status)) {
      throw new Error('BUYURTMA_YETKAZISH_UCHUN_FAOL_EMAS');
    }
    let to: 'ACCEPTED' | 'ASSIGNED' | 'DECLINED';
    try { to = operatorTransition(dispatch.status, input.action); }
    catch (err) {
      // A repeated or out-of-order button (e.g. accepting twice) is stale, not an application error.
      if (err instanceof Error && err.message === 'TAKSI_SOROVI_ESKIRGAN') {
        return { changed: false, finalStatus: 'STALE', fallbackCompany: null, nextDispatchId: null };
      }
      throw err;
    }
    const now = new Date();
    const result = await tx.taxiDispatch.updateMany({
      where: { id: dispatch.id, status: dispatch.status },
      data: {
        status: to, respondedAt: now, customerNotifiedAt: null, staffNotifiedAt: null, adminNotifiedAt: null,
        ...(to === 'ACCEPTED' ? { acceptedAt: now, acceptedBy: input.actorTelegramId, expiresAt: new Date(now.getTime() + acceptToSentSeconds * 1000) } : {}),
        ...(to === 'ASSIGNED' ? { dispatchedAt: now, dispatchedBy: input.actorTelegramId, expiresAt: null } : {}),
      },
    });
    if (result.count !== 1) return { changed: false, finalStatus: 'STALE', fallbackCompany: null, nextDispatchId: null };
    await tx.orderEvent.create({
      data: {
        orderId: dispatch.orderId, actorTelegramId: input.actorTelegramId, actorType: 'TAXI_OPERATOR',
        action: input.action === 'ACCEPT' ? 'TAXI_ACCEPTED' : input.action === 'SENT' ? 'TAXI_DRIVER_SENT' : 'TAXI_NOT_AVAILABLE',
        fromStatus: dispatch.order.status, toStatus: dispatch.order.status,
        details: { companyId: dispatch.taxiCompanyId, companyName: dispatch.taxiCompany.name, attemptNo: dispatch.attemptNo },
      },
    });
    if (to !== 'DECLINED' || !canFallback(dispatch.order.allowTaxiFallback, input.action === 'NO_TAXI')) {
      return { changed: true, finalStatus: to, fallbackCompany: null, nextDispatchId: null };
    }
    // Explicit "no driver sent" + fallback allowed: the next not-yet-tried eligible company, same rule everywhere (assignment.ts).
    const next = await nextEligibleCompany(tx, dispatch.orderId);
    if (!next) return { changed: true, finalStatus: to, fallbackCompany: null, nextDispatchId: null };
    const upcoming = await createNextAttempt(tx, dispatch.orderId, next.id);
    await tx.orderEvent.create({
      data: {
        orderId: dispatch.orderId, actorTelegramId: 'SYSTEM', actorType: 'SYSTEM',
        action: 'TAXI_FALLBACK_SCHEDULED', fromStatus: dispatch.order.status, toStatus: dispatch.order.status,
        details: { fromCompanyId: dispatch.taxiCompanyId, toCompanyId: next.id, attemptNo: upcoming.attemptNo },
      },
    });
    return { changed: true, finalStatus: to, fallbackCompany: next.name, nextDispatchId: upcoming.id };
  });
}

export type DeliveryResult =
  | { changed: true; orderNumber: number; commission: AccrueResult }
  | { changed: false; orderNumber: number; reason: 'ALREADY_DELIVERED' };

/**
 * The ONLY place that turns a dispatched taxi into a delivered order (Stage 7A contract): the assigned company's linked
 * operator confirms, the order moves READY -> COMPLETED with an immutable OrderEvent, and the flat commission is accrued
 * in the same transaction (eligibility - non-test, restaurant-verified payment, no refund - is decided by the ledger, so a
 * MOCK order completes without any commission). Serialized by the order row lock; a repeat is a no-op.
 * Errors: TAKSI_SOROVI_TOPILMADI, TAKSI_OPERATOR_RUXSAT_YOQ (also for another company's operator),
 * TAKSI_HALI_YUBORILMAGAN, BUYURTMA_HALI_TAYYOR_EMAS, BUYURTMA_BEKOR_QILINGAN, QAYTARISH_JARAYONIDA, TOLOV_TASDIQLANMAGAN.
 */
export async function completeDelivery(input: { actorTelegramId: string; actorCompanyId?: string; dispatchId: string }): Promise<DeliveryResult> {
  return db.$transaction(async tx => {
    const candidate = await tx.taxiDispatch.findUnique({ where: { id: input.dispatchId }, select: { orderId: true } });
    if (!candidate) throw new Error('TAKSI_SOROVI_TOPILMADI');
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${candidate.orderId} FOR UPDATE`;
    const dispatch = await tx.taxiDispatch.findUnique({
      where: { id: input.dispatchId },
      include: {
        taxiCompany: true,
        order: { include: { payment: { select: { status: true, isTest: true } }, refundRequests: { select: { status: true } } } },
      },
    });
    if (!dispatch || !isCompanyActor(dispatch, input)) throw new Error('TAKSI_OPERATOR_RUXSAT_YOQ');
    const order = dispatch.order;
    if (dispatch.status === 'DELIVERED') return { changed: false, orderNumber: order.number, reason: 'ALREADY_DELIVERED' };
    if (dispatch.status !== 'ASSIGNED') throw new Error('TAKSI_HALI_YUBORILMAGAN');
    if (['CANCELLATION_REQUESTED', 'CANCELLED', 'CUSTOMER_CANCELLED'].includes(order.status)) throw new Error('BUYURTMA_BEKOR_QILINGAN');
    if (order.refundRequests.some(r => r.status !== 'REJECTED')) throw new Error('QAYTARISH_JARAYONIDA');
    if (order.status !== 'READY') throw new Error('BUYURTMA_HALI_TAYYOR_EMAS');
    if (order.payment?.status !== 'CONFIRMED_MANUAL') throw new Error('TOLOV_TASDIQLANMAGAN');
    const now = new Date();
    const moved = await tx.taxiDispatch.updateMany({
      where: { id: dispatch.id, status: 'ASSIGNED' },
      data: { status: 'DELIVERED', deliveredAt: now, deliveredBy: input.actorTelegramId, expiresAt: null, customerNotifiedAt: null, staffNotifiedAt: null },
    });
    const done = await tx.order.updateMany({ where: { id: order.id, status: 'READY' }, data: { status: 'COMPLETED' } });
    if (moved.count !== 1 || done.count !== 1) throw new Error('TAKSI_SOROVI_ESKIRGAN');
    await tx.orderEvent.create({ data: {
      orderId: order.id, actorTelegramId: input.actorTelegramId, actorType: 'TAXI_OPERATOR', action: 'DELIVERY_CONFIRMED',
      fromStatus: 'READY', toStatus: 'COMPLETED',
      details: { companyId: dispatch.taxiCompanyId, companyName: dispatch.taxiCompany.name, dispatchId: dispatch.id, attemptNo: dispatch.attemptNo,
        confirmedAt: now.toISOString(), mock: order.paymentIsTest },
    } });
    const commission = await accrueCommissionTx(tx, order.id, { id: 'delivery-confirmation', type: 'SYSTEM' });
    return { changed: true, orderNumber: order.number, commission };
  });
}
