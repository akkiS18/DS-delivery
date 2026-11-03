import { db } from '../../lib/db.js';
import { CARD_MANUAL, RESTAURANT_CHECK } from '../payment/method.js';
import { actorLabel, isActorOf, restaurantScope, type StaffActor } from './actor.js';
import { REJECT_REASONS, type RejectReason } from './acceptance.js';

/**
 * "Shirin" mode, restaurant side. The customer was shown the restaurant's own card; the order is PAYMENT_PENDING with a RESTAURANT_CHECK payment
 * (method CARD_MANUAL). The restaurant looks at ITS bank balance and either confirms (-> PAYMENT_CONFIRMED + CONFIRMED_MANUAL, after which cooking starts and the
 * taxi is scheduled exactly like after a bank-signal match) or rejects the order (the money did not arrive). Only a person in the restaurant app / staff
 * bot does this: no automatic actor may confirm money nobody saw, so the system actor is refused here.
 */
export type ManualCheckResult = { result: 'DONE' } | { result: 'STALE' } | { result: 'EXPIRED' };

async function lockedOrder(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], input: StaffActor & { orderId: string }) {
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} FOR UPDATE`;
  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    include: { restaurant: { select: { id: true, staffTelegramUserId: true } }, payment: true },
  });
  // Another restaurant's order, a missing one and a non-bot one are all "not found" to the caller.
  if (!order || !order.createdViaBot || !isActorOf(order.restaurant, input)) throw new Error('RUXSAT_YOQ');
  return order;
}

export async function confirmRestaurantCheckedPayment(input: StaffActor & { orderId: string }): Promise<ManualCheckResult> {
  if (input.actorSystemId !== undefined) throw new Error('RUXSAT_YOQ'); // confirming that money arrived is a human decision
  const actor = actorLabel(input);
  return db.$transaction(async (tx): Promise<ManualCheckResult> => {
    const now = new Date();
    const order = await lockedOrder(tx, input);
    const pay = order.payment;
    if (order.status !== 'PAYMENT_PENDING' || !pay || pay.method !== CARD_MANUAL || pay.status !== RESTAURANT_CHECK) return { result: 'STALE' };
    if (pay.amountTiyin !== BigInt(order.totalSom) * 100n) throw new Error('TOLOV_SUMMASI_MOS_EMAS');
    if (!pay.expiresAt || pay.expiresAt <= now) return { result: 'EXPIRED' }; // the sweep expires it; a late tap must not revive it
    const moved = await tx.payment.updateMany({ where: { id: pay.id, status: RESTAURANT_CHECK, method: CARD_MANUAL }, data: { status: 'CONFIRMED_MANUAL' } });
    if (moved.count !== 1) return { result: 'STALE' };
    const updated = await tx.order.updateMany({
      where: { id: order.id, status: 'PAYMENT_PENDING', restaurant: restaurantScope(input) },
      data: {
        status: 'PAYMENT_CONFIRMED', paymentVerifiedAt: now, paymentVerifiedBy: actor,
        ...(input.actorRestaurantId === undefined ? { staffLastNotifiedStatus: 'PAYMENT_CONFIRMED' } : {}),
      },
    });
    if (updated.count !== 1) throw new Error('HOLAT_ORALIQDA_OZGARDI');
    await tx.paymentEvent.create({ data: {
      paymentId: pay.id, action: 'CONFIRMED_MANUAL', fromStatus: RESTAURANT_CHECK, toStatus: 'CONFIRMED_MANUAL', actorType: 'RESTAURANT_STAFF', actorId: actor,
      details: { method: CARD_MANUAL, cardId: pay.cardId },
    } });
    await tx.orderEvent.create({ data: {
      orderId: order.id, actorTelegramId: actor, actorType: 'RESTAURANT_STAFF', action: 'VERIFY_PAYMENT', fromStatus: 'PAYMENT_PENDING', toStatus: 'PAYMENT_CONFIRMED',
      details: { method: CARD_MANUAL, amountTiyin: pay.amountTiyin.toString(), paymentIsTest: pay.isTest, signal: false },
    } });
    return { result: 'DONE' };
  });
}

export async function rejectRestaurantCheckedOrder(input: StaffActor & { orderId: string; reason: RejectReason }): Promise<ManualCheckResult> {
  if (input.actorSystemId !== undefined) throw new Error('RUXSAT_YOQ');
  if (!REJECT_REASONS.includes(input.reason)) throw new Error('RAD_SABABI_NOTOGRI');
  const actor = actorLabel(input);
  return db.$transaction(async (tx): Promise<ManualCheckResult> => {
    const now = new Date();
    const order = await lockedOrder(tx, input);
    const pay = order.payment;
    if (order.status !== 'PAYMENT_PENDING' || !pay || pay.method !== CARD_MANUAL || pay.status !== RESTAURANT_CHECK) return { result: 'STALE' };
    const moved = await tx.payment.updateMany({ where: { id: pay.id, status: RESTAURANT_CHECK, method: CARD_MANUAL }, data: { status: 'CANCELLED' } });
    if (moved.count !== 1) return { result: 'STALE' };
    const updated = await tx.order.updateMany({
      where: { id: order.id, status: 'PAYMENT_PENDING', restaurant: restaurantScope(input) },
      data: { status: 'RESTAURANT_REJECTED', rejectedAt: now, rejectedBy: actor, rejectReason: input.reason },
    });
    if (updated.count !== 1) throw new Error('HOLAT_ORALIQDA_OZGARDI');
    await tx.paymentEvent.create({ data: {
      paymentId: pay.id, action: 'CANCELLED', fromStatus: RESTAURANT_CHECK, toStatus: 'CANCELLED', actorType: 'RESTAURANT_STAFF', actorId: actor, details: { reason: input.reason },
    } });
    await tx.orderEvent.create({ data: {
      orderId: order.id, actorTelegramId: actor, actorType: 'RESTAURANT_STAFF', action: 'REJECT_UNPAID', fromStatus: 'PAYMENT_PENDING', toStatus: 'RESTAURANT_REJECTED',
      details: { reason: input.reason, method: CARD_MANUAL },
    } });
    return { result: 'DONE' };
  });
}
