import { db } from '../../lib/db.js';
import { CASH_ACCEPTED, CASH_PENDING } from '../payment/method.js';
import { actorLabel, isActorOf, restaurantScope, type StaffActor } from './actor.js';
import { REJECT_REASONS, type RejectReason } from './acceptance.js';

/**
 * Cash on delivery, restaurant side. A cash order is created PAYMENT_PENDING with a CASH_PENDING payment; the restaurant (a person, in the app)
 * either accepts it (-> PAYMENT_CONFIRMED + CASH_ACCEPTED, after which cooking starts and the taxi is scheduled exactly like a verified card
 * payment) or rejects it. Automation never accepts cash: the system actor is refused here, so a fake order cannot start cooking by itself.
 */
export type CashResult = { result: 'DONE' } | { result: 'STALE' } | { result: 'EXPIRED' };

async function lockedCashOrder(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], input: StaffActor & { orderId: string }) {
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} FOR UPDATE`;
  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    include: { restaurant: { select: { id: true, staffTelegramUserId: true } }, payment: true },
  });
  // Another restaurant's order, a missing one and a non-bot one are all "not found" to the caller.
  if (!order || !order.createdViaBot || !isActorOf(order.restaurant, input)) throw new Error('RUXSAT_YOQ');
  return order;
}

export async function acceptCashOrder(input: StaffActor & { orderId: string }): Promise<CashResult> {
  if (input.actorSystemId !== undefined) throw new Error('RUXSAT_YOQ'); // accepting cash is a human decision
  const actor = actorLabel(input);
  return db.$transaction(async (tx): Promise<CashResult> => {
    const now = new Date();
    const order = await lockedCashOrder(tx, input);
    const pay = order.payment;
    if (order.status !== 'PAYMENT_PENDING' || !pay || pay.method !== 'CASH' || pay.status !== CASH_PENDING) return { result: 'STALE' };
    if (!pay.expiresAt || pay.expiresAt <= now) return { result: 'EXPIRED' }; // the sweep expires it; a late tap must not revive it
    const moved = await tx.payment.updateMany({ where: { id: pay.id, status: CASH_PENDING, method: 'CASH' }, data: { status: CASH_ACCEPTED } });
    if (moved.count !== 1) return { result: 'STALE' };
    const updated = await tx.order.updateMany({
      where: { id: order.id, status: 'PAYMENT_PENDING', restaurant: restaurantScope(input) },
      data: { status: 'PAYMENT_CONFIRMED', acceptedAt: now, acceptedBy: actor, ...(input.actorRestaurantId === undefined ? { staffLastNotifiedStatus: 'PAYMENT_CONFIRMED' } : {}) },
    });
    if (updated.count !== 1) throw new Error('HOLAT_ORALIQDA_OZGARDI');
    await tx.paymentEvent.create({ data: {
      paymentId: pay.id, action: 'CASH_ACCEPTED', fromStatus: CASH_PENDING, toStatus: CASH_ACCEPTED, actorType: 'RESTAURANT_STAFF', actorId: actor,
    } });
    await tx.orderEvent.create({ data: {
      orderId: order.id, actorTelegramId: actor, actorType: 'RESTAURANT_STAFF', action: 'ACCEPT_CASH', fromStatus: 'PAYMENT_PENDING', toStatus: 'PAYMENT_CONFIRMED',
      details: { method: 'CASH', amountTiyin: pay.amountTiyin.toString(), paymentIsTest: pay.isTest },
    } });
    return { result: 'DONE' };
  });
}

export async function rejectCashOrder(input: StaffActor & { orderId: string; reason: RejectReason }): Promise<CashResult> {
  if (input.actorSystemId !== undefined) throw new Error('RUXSAT_YOQ');
  if (!REJECT_REASONS.includes(input.reason)) throw new Error('RAD_SABABI_NOTOGRI');
  const actor = actorLabel(input);
  return db.$transaction(async (tx): Promise<CashResult> => {
    const now = new Date();
    const order = await lockedCashOrder(tx, input);
    const pay = order.payment;
    if (order.status !== 'PAYMENT_PENDING' || !pay || pay.method !== 'CASH' || pay.status !== CASH_PENDING) return { result: 'STALE' };
    const moved = await tx.payment.updateMany({ where: { id: pay.id, status: CASH_PENDING, method: 'CASH' }, data: { status: 'CANCELLED' } });
    if (moved.count !== 1) return { result: 'STALE' };
    const updated = await tx.order.updateMany({
      where: { id: order.id, status: 'PAYMENT_PENDING', restaurant: restaurantScope(input) },
      data: { status: 'RESTAURANT_REJECTED', rejectedAt: now, rejectedBy: actor, rejectReason: input.reason },
    });
    if (updated.count !== 1) throw new Error('HOLAT_ORALIQDA_OZGARDI');
    await tx.paymentEvent.create({ data: {
      paymentId: pay.id, action: 'CANCELLED', fromStatus: CASH_PENDING, toStatus: 'CANCELLED', actorType: 'RESTAURANT_STAFF', actorId: actor, details: { reason: input.reason },
    } });
    await tx.orderEvent.create({ data: {
      orderId: order.id, actorTelegramId: actor, actorType: 'RESTAURANT_STAFF', action: 'REJECT_CASH', fromStatus: 'PAYMENT_PENDING', toStatus: 'RESTAURANT_REJECTED',
      details: { reason: input.reason, method: 'CASH' },
    } });
    return { result: 'DONE' };
  });
}
