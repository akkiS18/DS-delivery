import type { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';
import { accrueCommissionTx } from '../commission/ledger.js';
import { isPaymentCleared } from '../payment/status.js';
import { isSupportAdmin } from '../support/service.js';

/**
 * "O‘zim olib ketaman" (owner request 2026-11-22): the customer collects the order at the restaurant. The customer chooses it at checkout,
 * so the order is PICKUP from the start (deliveryPreference = deliveryMode = PICKUP, a database check keeps them together): no taxi is ever
 * booked (the dispatch trigger refuses one) and the restaurant completes it with "Mijozga berildi".
 *
 * Two switches must both be on for a new pickup order:
 *  - Restaurant.customerPickupEnabled (default on; the restaurant can turn it off in its settings);
 *  - the platform rollout switch below (default OFF, administrator command /pickup). Restaurant apps installed before this feature have no
 *    "Mijozga berildi" button, so a pickup order would wait in READY forever; the administrator opens it once the new app is installed.
 */
export const PICKUP_OPEN_KEY = 'customer_pickup_open';
/** What a pickup order stores as its address (the column is required; the customer gives no address for a pickup). */
export const PICKUP_ADDRESS_LABEL = 'Restorandan o‘zi olib ketadi';

type Tx = Prisma.TransactionClient | typeof db;
const OPEN_REFUND = ['REQUESTED', 'APPROVED', 'SENT', 'DISPUTED'];

/** Pickup is offered only after an administrator opened it (/pickup). A missing row means CLOSED. */
export async function pickupOpen(tx: Tx = db): Promise<boolean> {
  const row = await tx.platformSetting.findUnique({ where: { key: PICKUP_OPEN_KEY }, select: { value: true } });
  return row?.value === 'true';
}

export async function setPickupOpen(input: { adminId: string; open: boolean }): Promise<'CHANGED' | 'UNCHANGED'> {
  if (!isSupportAdmin(input.adminId)) throw new Error('ADMIN_RUXSAT_YOQ');
  return db.$transaction(async tx => {
    const before = await pickupOpen(tx);
    if (before === input.open) return 'UNCHANGED' as const;
    const value = input.open ? 'true' : 'false';
    await tx.platformSetting.upsert({ where: { key: PICKUP_OPEN_KEY }, create: { key: PICKUP_OPEN_KEY, value, updatedBy: input.adminId }, update: { value, updatedBy: input.adminId } });
    await tx.adminAuditEvent.create({ data: {
      actorId: input.adminId, action: input.open ? 'CUSTOMER_PICKUP_OPENED' : 'CUSTOMER_PICKUP_CLOSED', targetType: 'PlatformSetting', targetId: PICKUP_OPEN_KEY, details: { previous: before },
    } });
    return 'CHANGED' as const;
  });
}

/** Whether a new checkout at this restaurant may offer pickup: both switches on. */
export function pickupAvailable(restaurant: { customerPickupEnabled: boolean }, open: boolean): boolean {
  return open && restaurant.customerPickupEnabled;
}

/**
 * The restaurant hands a pickup order to the customer ("Mijozga berildi"). Nobody else can confirm a pickup, so this is the one place that completes
 * it: READY -> COMPLETED with pickedUpAt, an immutable OrderEvent and, in the same transaction, the commission accrual (the ledger decides eligibility
 * exactly as for a delivery). Same shape as completeSelfDelivery: serialized by the order row lock, a repeat is a no-op, another restaurant's order is
 * "not found".
 *  - 'DONE': completed now; 'ALREADY': it was already handed over; 'STALE': wrong state (not READY / not a pickup / money not cleared);
 *  - throws QAYTARISH_JARAYONIDA while a refund is open (a person decides first).
 */
export async function completePickup(input: { restaurantId: string; orderId: string; actorLabel: string }): Promise<'DONE' | 'ALREADY' | 'NOT_FOUND' | 'STALE'> {
  return db.$transaction(async tx => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} AND "restaurantId" = ${input.restaurantId} FOR UPDATE`;
    if (!locked.length) return 'NOT_FOUND';
    const order = await tx.order.findUniqueOrThrow({
      where: { id: input.orderId },
      select: { id: true, status: true, deliveryMode: true, createdViaBot: true, pickedUpAt: true, payment: { select: { status: true } }, refundRequests: { select: { status: true } } },
    });
    if (!order.createdViaBot || order.deliveryMode !== 'PICKUP') return 'STALE';
    if (order.status === 'COMPLETED' && order.pickedUpAt) return 'ALREADY';
    if (order.status !== 'READY') return 'STALE';
    if (order.refundRequests.some(r => OPEN_REFUND.includes(r.status))) throw new Error('QAYTARISH_JARAYONIDA');
    if (!isPaymentCleared(order.payment?.status)) return 'STALE';
    const now = new Date();
    const done = await tx.order.updateMany({ where: { id: order.id, status: 'READY', deliveryMode: 'PICKUP' }, data: { status: 'COMPLETED', pickedUpAt: now } });
    if (done.count !== 1) return 'STALE';
    await tx.orderEvent.create({ data: {
      orderId: order.id, actorTelegramId: input.actorLabel, actorType: 'RESTAURANT_STAFF', action: 'PICKUP_HANDED_OVER',
      fromStatus: 'READY', toStatus: 'COMPLETED', details: { handedOverAt: now.toISOString() },
    } });
    await accrueCommissionTx(tx, order.id, { id: 'pickup-handover', type: 'SYSTEM' });
    return 'DONE';
  });
}
