import { Markup, type Telegraf } from 'telegraf';
import { db } from '../lib/db.js';
import { staffOrderPresentation } from './restaurant.js';
import { expireWaitingOrders } from '../modules/restaurant/acceptance.js';
import { deliverRefundNotices } from './refunds.js';
import { restaurantTelegramEnabled } from '../lib/features.js';
import { isDelivered, notificationKey, sendOnce } from '../lib/notify-once.js';
import { autoAdvanceMockOrders, autoConfirmRealOrders } from '../modules/restaurant-orders/auto.js';
import { deliverAutoConfirmRefusals, deliverPaidOrderAlerts } from './restaurant-alert.js';
import { autoConfirmReservations, expireReservations } from '../modules/reservations/service.js';
import { deliverReservationNotices } from './reservation-notify.js';
import { sweepDemoOrders } from '../modules/restaurant-orders/demo.js';
import { sweepTaxiDemoRequests } from '../modules/taxi-app/demo.js';

/** At-least-once delivery: Telegram sends can repeat after a process crash.
 *  Buttons are guarded with DB compare-and-swap and therefore safe on retry.
 */
export function startRestaurantOrderNotifier(bot: Telegraf<any>): () => void {
  let busy = false;
  let stopped = false;
  const run = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      await expireWaitingOrders(); // response timeout sweep (idempotent)
      await sweepTaxiDemoRequests(); // the same for the taxi operator's fake request
      await sweepDemoOrders(); // admin "sinov" orders: old ones and ones marked ready a few minutes ago are deleted (nothing stays in history)
      await autoAdvanceMockOrders(); // MOCK-only: safe test payments move on to cooking by themselves (restart-safe sweep)
      await deliverAutoConfirmRefusals(bot, (await autoConfirmRealOrders()).refused); // Stage 8D: Gmail-matched REAL payments confirm themselves; only refusals reach an admin
      await deliverRefundNotices(bot); // Stage 6A: refund request / decision / sent notices
      await expireReservations(); // unpaid table reservations whose payment window has passed
      await autoConfirmReservations(); // a matched deposit books the table (same policy as an order's payment)
      await deliverReservationNotices(bot); // "money arrived, table booked" to the restaurant's Telegram staff (the app shows it too)
      await deliverPaidOrderAlerts(bot); // Stage 8C: "open the app" alert for the restaurant staff (no push yet)
      const rows = await db.order.findMany({
        where: {
          createdViaBot: true, isDemo: false,
          status: { in: ['WAITING_RESTAURANT', 'WAITING_CUSTOMER_CONSENT', 'CUSTOMER_CANCELLED', 'RESTAURANT_REJECTED', 'RESTAURANT_EXPIRED', 'PAYMENT_MATCHED_UNVERIFIED', 'PAYMENT_CONFIRMED', 'PREPARING', 'READY'] },
        },
        orderBy: { updatedAt: 'desc' }, take: 200,
        include: {
          restaurant: { select: { staffTelegramUserId: true, staffLinkedAt: true, name: true } },
          customer: { select: { telegramUserId: true } },
          payment: { select: { method: true } },
        },
      });
      for (const order of rows) {
        if (stopped) break;
        const staffId = order.restaurant.staffTelegramUserId;
        // Skip old unchanged orders from before account linking; notify newly matched orders.
        const linkedBeforeOrder = Boolean(staffId && order.restaurant.staffLinkedAt && order.updatedAt >= order.restaurant.staffLinkedAt);
        if (restaurantTelegramEnabled() && linkedBeforeOrder && order.staffLastNotifiedStatus !== order.status && !['RESTAURANT_REJECTED', 'RESTAURANT_EXPIRED', 'WAITING_CUSTOMER_CONSENT', 'CUSTOMER_CANCELLED'].includes(order.status)) {
          try {
            const presentation = await staffOrderPresentation(staffId!, order.id);
            if (presentation) {
              const outcome = await sendOnce(bot, { key: notificationKey('order-staff', order.id, order.status, staffId!), kind: 'order-staff',
                chatId: staffId!, orderId: order.id, text: presentation.text, extra: presentation.markup });
              if (isDelivered(outcome)) await db.order.updateMany({ where: { id: order.id, status: order.status }, data: { staffLastNotifiedStatus: order.status } });
            }
          } catch (err) {
            console.error(`[STAFF NOTICE] #${order.code}:`, err instanceof Error ? err.message : err);
          }
        }
        const customerChat = order.customer.telegramUserId;
        // No Telegram link (Android guest): there is nobody to message. Settle the marker so the row is not retried every cycle; the app shows the status.
        if (!customerChat && order.customerLastNotifiedStatus !== order.status && ['WAITING_CUSTOMER_CONSENT', 'CUSTOMER_CANCELLED', 'RESTAURANT_REJECTED', 'RESTAURANT_EXPIRED', 'PAYMENT_CONFIRMED', 'PREPARING', 'READY'].includes(order.status)) {
          await db.order.updateMany({ where: { id: order.id, status: order.status }, data: { customerLastNotifiedStatus: order.status } });
          continue;
        }
        // Owner decision 2026-10-31: "being cooked" is told only after the restaurant accepted the order (its one-tap "Qabul qildim"). Not settled, so it goes out then.
        if (order.status === 'PREPARING' && order.prepChosenMinutes === null) continue;
        if (customerChat && ['CUSTOMER_CANCELLED', 'RESTAURANT_REJECTED', 'RESTAURANT_EXPIRED', 'PAYMENT_CONFIRMED', 'PREPARING', 'READY'].includes(order.status) && order.customerLastNotifiedStatus !== order.status) {
          const messages: Record<string, string> = {
            CUSTOMER_CANCELLED: `❌ #${order.code}: buyurtma bekor qilindi. Pul yubormang.`,
            RESTAURANT_REJECTED: `🚫 #${order.code}: restoran buyurtmani qabul qila olmadi. Pul yubormang.`,
            RESTAURANT_EXPIRED: `⌛ #${order.code}: restoran vaqtida javob bermadi, buyurtma bekor bo‘ldi. Pul yubormang.`,
            // Cash: nothing was paid yet, the restaurant only accepted the order; the customer pays the driver.
            PAYMENT_CONFIRMED: order.payment?.method === 'CASH' ? `✅ #${order.code}: buyurtmangiz restoran tomonidan qabul qilindi. Pulni haydovchiga naqd to‘laysiz.`
              : order.payment?.method === 'CARD_MANUAL' ? `✅ #${order.code}: restoran to‘lovni tasdiqladi, buyurtma qabul qilindi.` // "Shirin": the confirming tap is also the acceptance
              : `✅ #${order.code}: to‘lov qabul qilindi. Restoran buyurtmani qabul qilishini kutyapmiz.`,
            PREPARING: `👨‍🍳 #${order.code}: restoran buyurtmani qabul qildi, tayyorlanmoqda.`,
          };
          // Walking delivery has no taxi "on the way" news, so the customer is told here that the restaurant brings it itself.
          if (order.status === 'READY' && order.deliveryMode === 'SELF') messages.READY = `🚶 #${order.code}: buyurtmangiz tayyor, restoran uni o‘zi olib boradi.`;
          if (!messages[order.status]) { // READY has no message of its own: the next news is "on the way"
            await db.order.updateMany({ where: { id: order.id, status: order.status }, data: { customerLastNotifiedStatus: order.status } });
            continue;
          }
          try {
            const outcome = await sendOnce(bot, { key: notificationKey('order-customer', order.id, order.status, customerChat), kind: 'order-customer',
              chatId: customerChat, orderId: order.id, text: messages[order.status]! });
            if (isDelivered(outcome)) await db.order.updateMany({ where: { id: order.id, status: order.status }, data: { customerLastNotifiedStatus: order.status } });
          } catch (err) {
            console.error(`[CUSTOMER ORDER NOTICE] #${order.code}:`, err instanceof Error ? err.message : err);
          }
        }
      }
    } catch (err) {
      console.error('[RESTAURANT NOTIFIER]', err instanceof Error ? err.message : err);
    } finally { busy = false; }
  };
  const timer = setInterval(() => { void run(); }, 7_000);
  void run();
  return () => { stopped = true; clearInterval(timer); };
}
