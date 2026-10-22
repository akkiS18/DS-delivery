import { db } from '../lib/db.js';
import { restaurantTelegramEnabled } from '../lib/features.js';
import { notificationKey, sendOnce, type Sender } from '../lib/notify-once.js';
import { formatSom } from '../modules/payment/uzcard.js';

/**
 * Stage 8C: the restaurant app only polls while it is on screen and there is no push yet, so a phone with the screen off would miss a
 * paid order. This sends the restaurant's linked staff Telegram account a short "open the app" alert (no buttons, no actions: the app
 * stays the only place where orders are handled). It is the interim until push notifications exist.
 *
 * - One alert per order (durable de-duplication, survives restarts), only for orders touched in the last 2 hours so switching it on never floods.
 * - A single reminder when a REAL payment has waited for the restaurant's confirmation for 8+ minutes.
 * - Off when the legacy Telegram panel is enabled (it already messages the staff with buttons) or RESTAURANT_TELEGRAM_ALERTS=false.
 */
const WINDOW_MS = 2 * 3600_000;
export const REMINDER_AFTER_MS = 8 * 60_000;
const alertsEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => !restaurantTelegramEnabled() && env.RESTAURANT_TELEGRAM_ALERTS !== 'false';

export async function deliverPaidOrderAlerts(bot: Sender, now = new Date()): Promise<number> {
  if (!alertsEnabled()) return 0;
  let sent = 0;
  const orders = await db.order.findMany({
    where: {
      createdViaBot: true, updatedAt: { gte: new Date(now.getTime() - WINDOW_MS) },
      status: { in: ['PAYMENT_MATCHED_UNVERIFIED', 'PAYMENT_CONFIRMED', 'PREPARING'] },
      restaurant: { staffTelegramUserId: { not: null } },
    },
    orderBy: { updatedAt: 'asc' }, take: 100,
    select: { id: true, number: true, totalSom: true, status: true, paymentIsTest: true, restaurant: { select: { staffTelegramUserId: true } } },
  });
  for (const o of orders) {
    const chatId = o.restaurant.staffTelegramUserId!;
    const text = o.paymentIsTest
      ? `🧪 SINOV: #${o.number} buyurtma to‘landi (MOCK, ${formatSom(BigInt(o.totalSom) * 100n)}). Ilovani oching.`
      : o.status === 'PAYMENT_MATCHED_UNVERIFIED'
        ? `🔔 #${o.number}: to‘lov keldi (${formatSom(BigInt(o.totalSom) * 100n)}). Bankni tekshiring va ilovada „To‘lovni tasdiqlash“ni bosing.`
        : `🔔 #${o.number}: yangi buyurtma (${formatSom(BigInt(o.totalSom) * 100n)}). Ilovani oching.`;
    const outcome = await sendOnce(bot, { key: notificationKey('order-alert', o.id, chatId), kind: 'order-alert', chatId, orderId: o.id, text });
    if (outcome === 'SENT') sent++;
  }
  // a real payment still waiting for the restaurant's confirmation
  const waiting = await db.payment.findMany({
    where: {
      status: 'MATCHED_UNVERIFIED', isTest: false, matchedAt: { lte: new Date(now.getTime() - REMINDER_AFTER_MS), gte: new Date(now.getTime() - WINDOW_MS) },
      order: { is: { createdViaBot: true, status: 'PAYMENT_MATCHED_UNVERIFIED', restaurant: { staffTelegramUserId: { not: null } } } },
    },
    select: { order: { select: { id: true, number: true, restaurant: { select: { staffTelegramUserId: true } } } } }, take: 50,
  });
  for (const p of waiting) {
    const o = p.order!;
    const chatId = o.restaurant.staffTelegramUserId!;
    const outcome = await sendOnce(bot, {
      key: notificationKey('order-alert-reminder', o.id, chatId), kind: 'order-alert-reminder', chatId, orderId: o.id,
      text: `⏰ #${o.number}: mijoz to‘lagan, lekin to‘lov hali tasdiqlanmadi. Bankni tekshirib, ilovada tasdiqlang.`,
    });
    if (outcome === 'SENT') sent++;
  }
  return sent;
}
