import { customerWhere } from '../../lib/customer-owner.js';
import { db } from '../../lib/db.js';
import type { PaymentEngineV3 } from '../payment/engine.js';
import { CASH_ACCEPTED, CASH_ACTIVE_LIMIT, CASH_PENDING, cashEnabled, cashMaxOrderSom } from '../payment/method.js';

export type SwitchToCashResult = 'SWITCHED' | 'ALREADY_CASH' | 'NOT_FOUND' | 'NOT_ALLOWED' | 'CASH_OFF' | 'TOO_LARGE' | 'LIMIT';

/**
 * "No card is free right now": the customer's still-QUEUED card payment becomes a cash order (the restaurant then accepts it). Only a payment that
 * has no card yet can be converted - once a card is assigned the customer may already be transferring money, so that order is cancelled instead.
 * Runs under the payment lock, so it cannot interleave with a card being assigned to this very payment. Idempotent: a second tap returns ALREADY_CASH.
 */
export async function switchOrderToCash(engine: PaymentEngineV3, input: { telegramUserId: string; orderId: string; customerId?: string }): Promise<SwitchToCashResult> {
  const owned = await db.order.findFirst({
    where: { id: input.orderId, createdViaBot: true, customer: customerWhere(input.customerId ? { customerId: input.customerId } : input.telegramUserId) },
    select: { id: true, customerId: true },
  });
  if (!owned) return 'NOT_FOUND';
  return engine.runLocked(async (tx): Promise<SwitchToCashResult> => {
    const now = new Date();
    const rows = await tx.$queryRaw<Array<{ status: string }>>`SELECT "status"::text AS status FROM "Order" WHERE "id" = ${owned.id} FOR UPDATE`;
    const status = rows[0]?.status;
    const order = await tx.order.findUnique({ where: { id: owned.id }, select: { totalSom: true, payment: { select: { method: true, status: true } } } });
    if (!status || !order?.payment) return 'NOT_FOUND';
    if (order.payment.method === 'CASH') return order.payment.status === CASH_PENDING || order.payment.status === CASH_ACCEPTED ? 'ALREADY_CASH' : 'NOT_ALLOWED';
    if (status !== 'PAYMENT_PENDING' || order.payment.status !== 'QUEUED') return 'NOT_ALLOWED';
    if (!(await cashEnabled(tx))) return 'CASH_OFF';
    if (order.totalSom > cashMaxOrderSom()) return 'TOO_LARGE';
    const active = await tx.order.count({
      where: { customerId: owned.customerId, id: { not: owned.id }, payment: { is: { method: 'CASH', status: { in: [CASH_PENDING, CASH_ACCEPTED] } } },
        status: { in: ['PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'PREPARING', 'READY', 'TAXI_REQUESTED', 'DRIVER_ASSIGNED', 'DELIVERY_ASSUMED'] } },
    });
    if (active >= CASH_ACTIVE_LIMIT) return 'LIMIT';
    const r = await engine.switchQueuedToCash(tx, owned.id, now, { type: 'CUSTOMER', id: input.telegramUserId });
    if (r !== 'SWITCHED') return 'NOT_ALLOWED';
    await tx.orderEvent.create({ data: {
      orderId: owned.id, actorTelegramId: input.telegramUserId, actorType: 'CUSTOMER', action: 'SWITCH_TO_CASH', fromStatus: 'PAYMENT_PENDING', toStatus: 'PAYMENT_PENDING',
      details: { reason: 'NO_FREE_CARD' },
    } });
    return 'SWITCHED';
  });
}
