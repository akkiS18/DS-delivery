import { db } from '../../lib/db.js';
import { planStaffTransition, type StaffAction } from './workflow.js';
import { actorChannel, actorLabel, isActorOf, restaurantScope, type StaffActor } from './actor.js';
import { advanceTaxiWhenReady, scheduleTaxiWhenPreparing } from '../taxi/service.js';
import { GMAIL_AUTO_ACTOR, gmailAutoConfirmEnabled } from './auto-policy.js';

const OPEN_REFUND = ['REQUESTED', 'APPROVED', 'SENT', 'DISPUTED'];

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
      items: { where: { supersededAt: null }, select: { name: true, quantity: true, subtotalSom: true } },
      payment: { include: { card: { select: { last4: true, isTest: true } } } },
    },
  });
}

/** Atomic compare-and-swap transition. Stale or repeated button presses are harmless. */
export async function takeStaffAction(input: StaffActor & {
  orderId: string;
  action: StaffAction;
  prepMinutes?: number;
}): Promise<{ changed: boolean; status: string }> {
  // Payment verification is the restaurant's own bank check: Telegram staff (legacy) or the authenticated restaurant app
  // after an explicit confirmation. The built-in system actor exists ONLY for MOCK/test payments (checked below).
  const actor = actorLabel(input);
  const channel = actorChannel(input);
  if (input.actorSystemId !== undefined && input.action === 'MARK_READY') throw new Error('RUXSAT_YOQ'); // READY is never automatic
  return db.$transaction(async tx => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: { restaurant: { select: { id: true, staffTelegramUserId: true } }, payment: true },
    });
    if (!order || !order.createdViaBot || !isActorOf(order.restaurant, input)) {
      throw new Error('RUXSAT_YOQ');
    }
    if (input.actorSystemId !== undefined) {
      // The system actor has exactly two jobs: MOCK/test payments (Stage 6E) and, since Stage 8D, confirming + starting an order whose REAL
      // payment the bank e-mail matched (kill switch GMAIL_AUTO_CONFIRM=false). It can never mark an order ready.
      const mock = order.paymentIsTest && order.payment?.isTest;
      const gmailAuto = input.actorSystemId === GMAIL_AUTO_ACTOR && gmailAutoConfirmEnabled()
        && (input.action === 'VERIFY_PAYMENT' || input.action === 'START_PREPARING')
        && !order.paymentIsTest && order.payment !== null && !order.payment.isTest;
      if (!mock && !gmailAuto) throw new Error('RUXSAT_YOQ');
      if (!mock && await tx.refundRequest.findFirst({ where: { orderId: order.id, status: { in: OPEN_REFUND } }, select: { id: true } })) {
        throw new Error('TOLOV_MOS_EMAS'); // the customer already asked for the money back: a person decides
      }
    }
    // Verify may only be requested for payment matcher, never from a photo or unchecked receipt.
    const plan = planStaffTransition(order.status, order.payment?.status ?? null, input.action, input.prepMinutes);
    const now = new Date();
    const updated = await tx.order.updateMany({
      where: { id: order.id, status: plan.from, restaurant: restaurantScope(input) },
      data: {
        status: plan.to,
        // The interactive Telegram callback itself shows the updated staff view; an app action leaves it unset so the
        // notifier still tells the linked Telegram staff about the new state.
        ...(input.actorRestaurantId === undefined ? { staffLastNotifiedStatus: plan.to } : {}),
        ...(input.action === 'VERIFY_PAYMENT' ? { paymentVerifiedAt: now, paymentVerifiedBy: actor } : {}),
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
      // Stage 4A: a mail match is only a signal. The restaurant actor confirms it against the real bank
      // statement, and the stored match must still be consistent (same order amount, one linked transaction).
      const pay = order.payment;
      if (!pay || pay.amountTiyin !== BigInt(order.totalSom) * 100n) throw new Error('TOLOV_SUMMASI_MOS_EMAS');
      if (!pay.isTest) {
        const incoming = pay.matchedTransactionId
          ? await tx.incomingTransaction.findUnique({ where: { id: pay.matchedTransactionId } }) : null;
        if (!incoming || incoming.status !== 'MATCHED_UNVERIFIED' || incoming.matchedPaymentId !== pay.id
          || incoming.amountTiyin !== pay.amountTiyin || !incoming.trustedSender) throw new Error('TOLOV_MOS_EMAS');
        if (input.actorSystemId !== undefined && incoming.source !== 'GMAIL') throw new Error('TOLOV_MOS_EMAS'); // automatic: only a real bank e-mail
      }
      const verified = await tx.payment.updateMany({
        where: { id: order.payment?.id ?? '', status: 'MATCHED_UNVERIFIED', orderId: order.id },
        data: { status: 'CONFIRMED_MANUAL' },
      });
      if (verified.count !== 1) throw new Error('TOLOV_MOS_EMAS');
      await tx.paymentEvent.create({ data: {
        paymentId: pay.id, action: 'CONFIRMED_MANUAL', fromStatus: 'MATCHED_UNVERIFIED', toStatus: 'CONFIRMED_MANUAL',
        actorType: input.actorSystemId !== undefined ? 'SYSTEM' : 'RESTAURANT_STAFF', actorId: actor, incomingTransactionId: pay.matchedTransactionId,
      } });
    }
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        actorTelegramId: actor,
        actorType: 'RESTAURANT_STAFF',
        action: input.action,
        fromStatus: plan.from,
        toStatus: plan.to,
        details: {
          channel,
          ...(input.prepMinutes ? { prepMinutes: input.prepMinutes } : {}),
          ...(input.action === 'VERIFY_PAYMENT' && order.payment ? {
            amountTiyin: order.payment.amountTiyin.toString(), paymentIsTest: order.payment.isTest, matchedTransactionId: order.payment.matchedTransactionId,
          } : {}),
        },
      },
    });
    return { changed: true, status: plan.to };
  });
}
