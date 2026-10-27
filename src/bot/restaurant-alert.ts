import { db } from '../lib/db.js';
import { restaurantTelegramEnabled } from '../lib/features.js';
import { notificationKey, sendOnce, type Sender } from '../lib/notify-once.js';
import { formatSom } from '../modules/payment/uzcard.js';
import { gmailAutoConfirmEnabled } from '../modules/restaurant/auto-policy.js';
import { supportAdminIds } from '../modules/support/service.js';
import { gmailMatchedTransactionIds, type AutoConfirmRefusal } from '../modules/restaurant-orders/auto.js';

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
/** How long a matched REAL payment may take to confirm itself before the restaurant is asked to do it. */
export const AUTO_GRACE_MS = 90_000;
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
    select: { id: true, code: true, totalSom: true, status: true, paymentIsTest: true, restaurant: { select: { staffTelegramUserId: true } }, payment: { select: { matchedAt: true, matchedTransactionId: true } } },
  });
  const autoEnabled = gmailAutoConfirmEnabled();
  const viaMail = await gmailMatchedTransactionIds(orders.map(o => o.payment?.matchedTransactionId));
  for (const o of orders) {
    // Only a payment the bank e-mail matched confirms itself; a Humocard Telegram match waits for the restaurant right away.
    const auto = autoEnabled && !!o.payment?.matchedTransactionId && viaMail.has(o.payment.matchedTransactionId);
    const chatId = o.restaurant.staffTelegramUserId!;
    const unconfirmed = !o.paymentIsTest && o.status === 'PAYMENT_MATCHED_UNVERIFIED';
    // Automatic confirmation takes seconds: do not announce "please confirm" for an order that is about to confirm itself. If it did NOT
    // confirm within the grace period, the restaurant is told to check the bank and confirm by hand.
    if (unconfirmed && auto && (o.payment?.matchedAt?.getTime() ?? 0) > now.getTime() - AUTO_GRACE_MS) continue;
    const text = o.paymentIsTest
      ? `🧪 SINOV: #${o.code} buyurtma to‘landi (MOCK, ${formatSom(BigInt(o.totalSom) * 100n)}). Ilovani oching.`
      : unconfirmed
        ? auto
          ? `🔔 #${o.code}: to‘lov keldi (${formatSom(BigInt(o.totalSom) * 100n)}), lekin avtomatik tasdiqlanmadi. Bankni tekshiring va ilovada „To‘lovni tasdiqlash“ni bosing.`
          : `🔔 #${o.code}: to‘lov keldi (${formatSom(BigInt(o.totalSom) * 100n)}). Bankni tekshiring va ilovada „To‘lovni tasdiqlash“ni bosing.`
        : `🔔 #${o.code}: yangi to‘langan buyurtma (${formatSom(BigInt(o.totalSom) * 100n)}). Ilovani oching va tayyorlang.`;
    const outcome = await sendOnce(bot, { key: notificationKey('order-alert', o.id, chatId), kind: 'order-alert', chatId, orderId: o.id, text });
    if (outcome === 'SENT') sent++;
  }
  // a real payment still waiting for the restaurant's confirmation
  const waiting = await db.payment.findMany({
    where: {
      status: 'MATCHED_UNVERIFIED', isTest: false, matchedAt: { lte: new Date(now.getTime() - REMINDER_AFTER_MS), gte: new Date(now.getTime() - WINDOW_MS) },
      order: { is: { createdViaBot: true, status: 'PAYMENT_MATCHED_UNVERIFIED', restaurant: { staffTelegramUserId: { not: null } } } },
    },
    select: { order: { select: { id: true, code: true, restaurant: { select: { staffTelegramUserId: true } } } } }, take: 50,
  });
  for (const p of waiting) {
    const o = p.order!;
    const chatId = o.restaurant.staffTelegramUserId!;
    const outcome = await sendOnce(bot, {
      key: notificationKey('order-alert-reminder', o.id, chatId), kind: 'order-alert-reminder', chatId, orderId: o.id,
      text: `⏰ #${o.code}: mijoz to‘lagan, lekin to‘lov hali tasdiqlanmadi. Bankni tekshirib, ilovada tasdiqlang.`,
    });
    if (outcome === 'SENT') sent++;
  }
  return sent;
}

/**
 * Stage 8D: the automatic confirmation refused an order (exact reason code, no card digits). Only then does an administrator hear about it:
 * the normal path needs nobody. One message per order and administrator.
 */
export async function deliverAutoConfirmRefusals(bot: Sender, refused: AutoConfirmRefusal[]): Promise<number> {
  if (!refused.length) return 0;
  let admins: string[] = [];
  try { admins = supportAdminIds(); } catch { admins = []; }
  let sent = 0;
  for (const r of refused) {
    for (const chatId of admins) {
      const outcome = await sendOnce(bot, {
        key: notificationKey('auto-confirm-refused', r.orderId, chatId), kind: 'auto-confirm-refused', chatId, orderId: r.orderId,
        text: `⚠️ #${r.code}: pul keldi, lekin to‘lov avtomatik tasdiqlanmadi (${r.reason}). Restoran bankni tekshirib qo‘lda tasdiqlaydi; muammo davom etsa /money ni oching.`,
      });
      if (outcome === 'SENT') sent++;
    }
  }
  return sent;
}
