import type { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';
import { isSupportAdmin } from '../support/service.js';

/**
 * Cash on delivery. A cash order keeps the normal order statuses; its Payment (method CASH) is the record of the promise:
 *   CASH_PENDING  the customer asked to pay in cash; the restaurant has not accepted yet (the order is PAYMENT_PENDING);
 *   CASH_ACCEPTED the restaurant accepted it (a person, in the app): cooking and the taxi may proceed, like a verified card payment.
 * The taxi driver pays the restaurant the food total and takes it from the customer; nothing is matched against bank e-mails.
 */
export type PaymentMethod = 'CARD' | 'CASH';
export { CASH_ACCEPTED, CASH_PENDING, PAYMENT_CLEARED_STATUSES, isPaymentCleared } from './status.js';

export const CASH_ENABLED_KEY = 'cash_orders_enabled';
type Tx = Prisma.TransactionClient | typeof db;

/** Cash orders are on unless an administrator switched them off (/cash). A missing row means ON. */
export async function cashEnabled(tx: Tx = db): Promise<boolean> {
  const row = await tx.platformSetting.findUnique({ where: { key: CASH_ENABLED_KEY }, select: { value: true } });
  return row?.value !== 'false';
}

export async function setCashEnabled(input: { adminId: string; enabled: boolean }): Promise<'CHANGED' | 'UNCHANGED'> {
  if (!isSupportAdmin(input.adminId)) throw new Error('ADMIN_RUXSAT_YOQ');
  return db.$transaction(async tx => {
    const before = await cashEnabled(tx);
    if (before === input.enabled) return 'UNCHANGED' as const;
    const value = input.enabled ? 'true' : 'false';
    await tx.platformSetting.upsert({ where: { key: CASH_ENABLED_KEY }, create: { key: CASH_ENABLED_KEY, value, updatedBy: input.adminId }, update: { value, updatedBy: input.adminId } });
    await tx.adminAuditEvent.create({ data: {
      actorId: input.adminId, action: input.enabled ? 'CASH_ORDERS_ENABLED' : 'CASH_ORDERS_DISABLED', targetType: 'PlatformSetting', targetId: CASH_ENABLED_KEY, details: { previous: before },
    } });
    return 'CHANGED' as const;
  });
}

/** Largest food total (so‘m) accepted in cash: a fake order costs the restaurant and the driver real money. */
export function cashMaxOrderSom(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.CASH_MAX_ORDER_SOM);
  return Number.isInteger(n) && n >= 10_000 && n <= 100_000_000 ? n : 1_000_000;
}
/** How long a cash order waits for the restaurant to accept it before it expires. */
export function cashAcceptWindowMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.CASH_ACCEPT_MINUTES);
  return (Number.isInteger(n) && n >= 1 && n <= 120 ? n : 15) * 60_000;
}
/** Cash orders one customer may have open (not yet delivered/cancelled) at the same time. */
export const CASH_ACTIVE_LIMIT = 2;
