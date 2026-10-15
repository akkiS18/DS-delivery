import { db } from '../../lib/db.js';
import { planStaffTransition, type StaffAction } from './workflow.js';
import { advanceTaxiWhenReady, scheduleTaxiWhenPreparing } from '../taxi/service.js';

export async function findAssignedRestaurant(telegramUserId: string) {
  return db.restaurant.findUnique({
    where: { staffTelegramUserId: telegramUserId },
    select: { id: true, name: true, staffLinkedAt: true },
  });
}

export async function staffOrderDetails(telegramUserId: string, orderId: string) {
  const restaurant = await findAssignedRestaurant(telegramUserId);
  if (!restaurant) return null;
  return db.order.findFirst({
    where: { id: orderId, restaurantId: restaurant.id, createdViaBot: true },
    include: {
      customer: { select: { telegramUserId: true, displayName: true } },
      taxiCompany: { select: { name: true } },
      items: { select: { name: true, quantity: true, subtotalSom: true } },
      payment: { include: { card: { select: { last4: true, isTest: true } } } },
    },
  });
}

/** Atomic compare-and-swap transition. Stale or repeated button presses are harmless. */
export async function takeStaffAction(input: {
  actorTelegramId: string;
  orderId: string;
  action: StaffAction;
  prepMinutes?: number;
}): Promise<{ changed: boolean; status: string }> {
  return db.$transaction(async tx => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: { restaurant: { select: { staffTelegramUserId: true } }, payment: true },
    });
    if (!order || !order.createdViaBot || order.restaurant.staffTelegramUserId !== input.actorTelegramId) {
      throw new Error('RUXSAT_YOQ');
    }
    // Verify may only be requested for payment matcher, never from a photo or unchecked receipt.
    const plan = planStaffTransition(order.status, order.payment?.status ?? null, input.action, input.prepMinutes);
    const now = new Date();
    const updated = await tx.order.updateMany({
      where: { id: order.id, status: plan.from, restaurant: { staffTelegramUserId: input.actorTelegramId } },
      data: {
        status: plan.to,
        staffLastNotifiedStatus: plan.to, // The interactive callback itself shows the updated staff view.
        ...(input.action === 'VERIFY_PAYMENT' ? { paymentVerifiedAt: now, paymentVerifiedBy: input.actorTelegramId } : {}),
        ...(input.action === 'START_PREPARING' ? { prepMinutes: input.prepMinutes, preparingStartedAt: now } : {}),
        ...(input.action === 'MARK_READY' ? { readyAt: now } : {}),
      },
    });
    if (updated.count !== 1) return { changed: false, status: 'STALE' };
    if (input.action === 'START_PREPARING') {
      await scheduleTaxiWhenPreparing(tx, order, input.prepMinutes!, now);
    }
    if (input.action === 'MARK_READY') {
      await advanceTaxiWhenReady(tx, order.id, now);
    }
    if (input.action === 'VERIFY_PAYMENT') {
      const verified = await tx.payment.updateMany({
        where: { id: order.payment?.id ?? '', status: 'MATCHED_UNVERIFIED', orderId: order.id },
        data: { status: 'CONFIRMED_MANUAL' },
      });
      if (verified.count !== 1) throw new Error('TOLOV_MOS_EMAS');
    }
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        actorTelegramId: input.actorTelegramId,
        actorType: 'RESTAURANT_STAFF',
        action: input.action,
        fromStatus: plan.from,
        toStatus: plan.to,
        ...(input.prepMinutes ? { details: { prepMinutes: input.prepMinutes } } : {}),
      },
    });
    return { changed: true, status: plan.to };
  });
}
