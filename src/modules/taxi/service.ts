import { Prisma, type TaxiDispatchStatus } from '@prisma/client';
import { db } from '../../lib/db.js';
import { calculateTaxiDueAt, canFallback, operatorTransition, type OperatorAction } from './workflow.js';

export type Transaction = Prisma.TransactionClient;
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
  if (!order.createdViaBot || !order.taxiCompanyId) return;
  const existing = await tx.taxiDispatch.count({ where: { orderId: order.id } });
  if (existing) return;
  await tx.taxiDispatch.create({
    data: { orderId: order.id, taxiCompanyId: order.taxiCompanyId, attemptNo: 1,
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

export async function taxiDispatchDetails(telegramUserId: string, dispatchId: string) {
  return db.taxiDispatch.findFirst({
    where: { id: dispatchId, taxiCompany: { operatorTelegramUserId: telegramUserId } },
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
    if (!dispatch || dispatch.taxiCompany.operatorTelegramUserId !== input.actorTelegramId) {
      throw new Error('TAKSI_OPERATOR_RUXSAT_YOQ');
    }
    if (dispatch.status !== 'REQUESTED' && dispatch.status !== 'CANCELLATION_PENDING' && dispatch.status !== 'NEEDS_HELP') {
      return { changed: false, finalStatus: 'STALE', fallbackCompany: null, nextDispatchId: null };
    }
    // PREPARING/READY are deliberately independent from taxi dispatch status.
    if (!['PREPARING', 'READY'].includes(dispatch.order.status)) {
      throw new Error('BUYURTMA_YETKAZISH_UCHUN_FAOL_EMAS');
    }
    const to = operatorTransition(dispatch.status, input.action);
    const result = await tx.taxiDispatch.updateMany({
      where: { id: dispatch.id, status: dispatch.status },
      data: { status: to, respondedAt: new Date(), customerNotifiedAt: null, staffNotifiedAt: null, adminNotifiedAt: null },
    });
    if (result.count !== 1) return { changed: false, finalStatus: 'STALE', fallbackCompany: null, nextDispatchId: null };
    await tx.orderEvent.create({
      data: {
        orderId: dispatch.orderId, actorTelegramId: input.actorTelegramId, actorType: 'TAXI_OPERATOR',
        action: input.action === 'SENT' ? 'TAXI_DRIVER_SENT' : 'TAXI_NOT_AVAILABLE',
        fromStatus: dispatch.order.status, toStatus: dispatch.order.status,
        details: { companyId: dispatch.taxiCompanyId, companyName: dispatch.taxiCompany.name, attemptNo: dispatch.attemptNo },
      },
    });
    if (to === 'ASSIGNED' || !canFallback(dispatch.order.allowTaxiFallback, input.action === 'NO_TAXI')) {
      return { changed: true, finalStatus: to, fallbackCompany: null, nextDispatchId: null };
    }
    const previous = await tx.taxiDispatch.findMany({ where: { orderId: dispatch.orderId }, select: { taxiCompanyId: true } });
    const next = await tx.taxiCompany.findFirst({
      where: {
        isActive: true, operatorTelegramUserId: { not: null },
        id: { notIn: previous.map(row => row.taxiCompanyId) },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    if (!next) return { changed: true, finalStatus: to, fallbackCompany: null, nextDispatchId: null };
    const upcoming = await tx.taxiDispatch.create({
      data: { orderId: dispatch.orderId, taxiCompanyId: next.id, attemptNo: dispatch.attemptNo + 1,
        status: 'SCHEDULED', dueAt: new Date() },
    });
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
