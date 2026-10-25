import { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';
import { COMMISSION_RULE_CODE, SERVICE_FEE_RULE_CODE, commissionEligibility, commissionFlatSom, type NotEligibleReason } from './rules.js';

type Tx = Prisma.TransactionClient;

export type AccrueResult =
  | { result: 'ACCRUED'; entryId: string; amountSom: number }
  | { result: 'ALREADY_ACCRUED'; entryId: string; amountSom: number }
  | { result: 'NOT_ELIGIBLE'; reason: NotEligibleReason }
  | { result: 'NOT_FOUND' };

export interface LedgerActor { id: string; type: 'SYSTEM' | 'ADMIN' }

/**
 * Accrues the flat platform commission for ONE delivered order, inside the caller's transaction (the future delivery stage
 * calls this in the same transaction that moves the order to COMPLETED and writes its OrderEvent).
 * Locks the order row, so concurrent delivery updates / accruals for the same order are serialized; the unique index on
 * orderId and the DB insert guard are the backstops. Idempotent: a second call returns the first entry unchanged.
 * `amountSom` is read from configuration now and then frozen in the row; it is never recomputed.
 * A service-fee order (serviceFeeSom set at checkout) owes exactly that frozen fee instead of the flat amount: the customer already paid it
 * to the restaurant's card inside the dish prices, and the restaurant settles it through this ledger.
 */
export async function accrueCommissionTx(tx: Tx, orderId: string, actor: LedgerActor): Promise<AccrueResult> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
  if (!locked.length) return { result: 'NOT_FOUND' };

  const existing = await tx.commissionEntry.findUnique({ where: { orderId }, select: { id: true, amountSom: true } });
  if (existing) return { result: 'ALREADY_ACCRUED', entryId: existing.id, amountSom: existing.amountSom };

  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      status: true, restaurantId: true, totalSom: true, paymentIsTest: true, serviceFeeSom: true, feeRuleCode: true,
      payment: { select: { id: true, status: true, isTest: true } },
      refundRequests: { select: { status: true } },
      events: { where: { toStatus: 'COMPLETED' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { id: true } },
    },
  });
  const verdict = commissionEligibility({
    orderStatus: order.status, orderPaymentIsTest: order.paymentIsTest, hasCompletedEvent: order.events.length > 0,
    payment: order.payment, refundStatuses: order.refundRequests.map(r => r.status),
  });
  if (!verdict.ok) return { result: 'NOT_ELIGIBLE', reason: verdict.reason };

  const feeOrder = order.serviceFeeSom !== null;
  if (feeOrder && order.serviceFeeSom! <= 0) return { result: 'NOT_ELIGIBLE', reason: 'NO_FEE' };
  const amountSom = feeOrder ? order.serviceFeeSom! : commissionFlatSom();
  const ruleCode = feeOrder ? SERVICE_FEE_RULE_CODE : COMMISSION_RULE_CODE;
  const entry = await tx.commissionEntry.create({
    data: {
      orderId, restaurantId: order.restaurantId, paymentId: order.payment!.id, amountSom, orderTotalSom: order.totalSom,
      ruleCode, proofEventId: order.events[0]!.id, accruedBy: actor.id,
    },
    select: { id: true },
  });
  await tx.commissionEvent.create({
    data: {
      entryId: entry.id, actorId: actor.id, actorType: actor.type, action: 'ACCRUED',
      details: { amountSom, orderTotalSom: order.totalSom, ruleCode, ...(feeOrder ? { feeRuleCode: order.feeRuleCode } : {}), proofEventId: order.events[0]!.id },
    },
  });
  return { result: 'ACCRUED', entryId: entry.id, amountSom };
}

export async function accrueCommission(orderId: string, actor: LedgerActor = { id: 'system', type: 'SYSTEM' }): Promise<AccrueResult> {
  try {
    return await db.$transaction(tx => accrueCommissionTx(tx, orderId, actor));
  } catch (error) {
    // Lost a race on the unique index: report the winner's entry instead of failing.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const winner = await db.commissionEntry.findUnique({ where: { orderId }, select: { id: true, amountSom: true } });
      if (winner) return { result: 'ALREADY_ACCRUED', entryId: winner.id, amountSom: winner.amountSom };
    }
    throw error;
  }
}
