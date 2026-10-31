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

export const CASH_MAX_KEY = 'cash_max_order_som';
export const CASH_MAX_MIN_SOM = 10_000;
export const CASH_MAX_MAX_SOM = 100_000_000;
const validCashMax = (n: number): boolean => Number.isInteger(n) && n >= CASH_MAX_MIN_SOM && n <= CASH_MAX_MAX_SOM;

/** The built-in largest food total (so‘m) accepted in cash (owner decision 2026-10-31: 500 000; CASH_MAX_ORDER_SOM overrides it). The administrator's own value, if set, wins: see loadCashMaxOrderSom. */
export function cashMaxOrderSom(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.CASH_MAX_ORDER_SOM);
  return validCashMax(n) ? n : 500_000;
}

/** Largest food total (so‘m) accepted in cash: a fake order costs the restaurant and the driver real money. Set by the administrator in the app (PlatformSetting), else the built-in default. */
export async function loadCashMaxOrderSom(tx: Tx = db, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const row = await tx.platformSetting.findUnique({ where: { key: CASH_MAX_KEY }, select: { value: true } });
  const n = row ? Number(row.value) : NaN;
  return validCashMax(n) ? n : cashMaxOrderSom(env);
}

export async function setCashMaxOrderSom(input: { adminId: string; maxOrderSom: number }): Promise<'CHANGED' | 'UNCHANGED'> {
  if (!isSupportAdmin(input.adminId)) throw new Error('ADMIN_RUXSAT_YOQ');
  if (!validCashMax(input.maxOrderSom)) throw new Error('NAQD_CHEGARA_NOTOGRI');
  return db.$transaction(async tx => {
    const before = await loadCashMaxOrderSom(tx);
    if (before === input.maxOrderSom) return 'UNCHANGED' as const;
    const value = String(input.maxOrderSom);
    await tx.platformSetting.upsert({ where: { key: CASH_MAX_KEY }, create: { key: CASH_MAX_KEY, value, updatedBy: input.adminId }, update: { value, updatedBy: input.adminId } });
    await tx.adminAuditEvent.create({ data: {
      actorId: input.adminId, action: 'CASH_MAX_CHANGED', targetType: 'PlatformSetting', targetId: CASH_MAX_KEY, details: { previous: before, next: input.maxOrderSom },
    } });
    return 'CHANGED' as const;
  });
}
/** How long a cash order waits for the restaurant to accept it before it expires. */
export function cashAcceptWindowMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.CASH_ACCEPT_MINUTES);
  return (Number.isInteger(n) && n >= 1 && n <= 120 ? n : 15) * 60_000;
}
/** Cash orders one customer may have open (not yet delivered/cancelled) at the same time. */
export const CASH_ACTIVE_LIMIT = 2;
