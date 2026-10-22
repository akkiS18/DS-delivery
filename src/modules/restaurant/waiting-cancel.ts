import type { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';

async function cancelOrder(
  tx: Prisma.TransactionClient, orderId: string, from: 'WAITING_RESTAURANT' | 'WAITING_CUSTOMER_CONSENT',
  actor: string, actorType: 'CUSTOMER' | 'SYSTEM', reason: string, now: Date,
): Promise<boolean> {
  const { count } = await tx.order.updateMany({
    where: { id: orderId, status: from },
    data: { status: 'CUSTOMER_CANCELLED', cancelledAt: now, cancelledBy: actor, cancelReason: reason, customerLastNotifiedStatus: null },
  });
  if (count !== 1) return false;
  await tx.orderEvent.create({ data: {
    orderId, actorTelegramId: actor, actorType, action: 'CANCEL', fromStatus: from, toStatus: 'CUSTOMER_CANCELLED', details: { reason },
  } });
  return true;
}

export type CancelResult = { result: 'CANCELLED' } | { result: 'NOT_FOUND' } | { result: 'TOO_LATE' };

/** Customer cancels while the restaurant is still deciding (legacy accept-first orders). Racing with an acceptance is safe: both are
 *  compare-and-set on the order status, so exactly one of them wins. `WAITING_CUSTOMER_CONSENT` is a legacy status kept only so that an old
 *  row in it can still be closed; no workflow produces it any more (price changes after ordering do not exist). */
export async function cancelWaitingOrder(input: { telegramUserId: string; orderId: string }): Promise<CancelResult> {
  const owned = await db.order.findFirst({
    where: { id: input.orderId, customer: { telegramUserId: input.telegramUserId } }, select: { id: true },
  });
  if (!owned) return { result: 'NOT_FOUND' };
  return db.$transaction(async (tx): Promise<CancelResult> => {
    const now = new Date();
    if (await cancelOrder(tx, owned.id, 'WAITING_RESTAURANT', input.telegramUserId, 'CUSTOMER', 'CUSTOMER_REQUEST', now)) return { result: 'CANCELLED' };
    if (await cancelOrder(tx, owned.id, 'WAITING_CUSTOMER_CONSENT', input.telegramUserId, 'CUSTOMER', 'CUSTOMER_REQUEST', now)) {
      await tx.orderPriceRevision.updateMany({ where: { orderId: owned.id, status: 'PROPOSED' }, data: { status: 'VOID', respondedAt: now } });
      return { result: 'CANCELLED' };
    }
    return { result: 'TOO_LATE' };
  });
}
