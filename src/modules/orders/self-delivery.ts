import { db } from '../../lib/db.js';
import { accrueCommissionTx } from '../commission/ledger.js';
import { isPaymentCleared } from '../payment/status.js';

const OPEN_REFUND = ['REQUESTED', 'APPROVED', 'SENT', 'DISPUTED'];

/**
 * The restaurant reports that it brought the order itself (walking delivery). The taxi path has an operator who confirms delivery; a self-delivered
 * order has nobody else, so this is the one place that completes it: READY -> COMPLETED with an immutable OrderEvent and, in the same transaction,
 * the commission accrual (the ledger decides eligibility exactly as for a taxi delivery: real money verified, no refund, not a test order).
 *
 * Only for an order of THIS restaurant that the restaurant itself chose to deliver (deliveryMode SELF, which exists only with the customer's
 * consent). Serialized by the order row lock; a repeat is a no-op. Another restaurant's order is "not found".
 *  - 'DONE': completed now; 'ALREADY': it was already completed this way; 'STALE': wrong state (not READY / not self delivery / payment not cleared);
 *  - throws QAYTARISH_JARAYONIDA while a refund is open (a person decides first).
 */
export async function completeSelfDelivery(input: { restaurantId: string; orderId: string; actorLabel: string }): Promise<'DONE' | 'ALREADY' | 'NOT_FOUND' | 'STALE'> {
  return db.$transaction(async tx => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} AND "restaurantId" = ${input.restaurantId} FOR UPDATE`;
    if (!locked.length) return 'NOT_FOUND';
    const order = await tx.order.findUniqueOrThrow({
      where: { id: input.orderId },
      select: { id: true, status: true, deliveryMode: true, createdViaBot: true, payment: { select: { status: true } }, refundRequests: { select: { status: true } } },
    });
    if (!order.createdViaBot || order.deliveryMode !== 'SELF') return 'STALE';
    if (order.status === 'COMPLETED') return 'ALREADY';
    if (order.status !== 'READY') return 'STALE';
    if (order.refundRequests.some(r => OPEN_REFUND.includes(r.status))) throw new Error('QAYTARISH_JARAYONIDA');
    if (!isPaymentCleared(order.payment?.status)) return 'STALE';
    const now = new Date();
    const done = await tx.order.updateMany({ where: { id: order.id, status: 'READY', deliveryMode: 'SELF' }, data: { status: 'COMPLETED', selfDeliveredAt: now } });
    if (done.count !== 1) return 'STALE';
    await tx.orderEvent.create({ data: {
      orderId: order.id, actorTelegramId: input.actorLabel, actorType: 'RESTAURANT_STAFF', action: 'SELF_DELIVERY_CONFIRMED',
      fromStatus: 'READY', toStatus: 'COMPLETED', details: { confirmedAt: now.toISOString() },
    } });
    await accrueCommissionTx(tx, order.id, { id: 'self-delivery-confirmation', type: 'SYSTEM' });
    return 'DONE';
  });
}
