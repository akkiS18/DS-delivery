import { Markup, type Telegraf } from 'telegraf';
import { db } from '../lib/db.js';
import { staffOrderPresentation } from './restaurant.js';
import { expireWaitingOrders } from '../modules/restaurant/acceptance.js';
import { deliverRefundNotices } from './refunds.js';
import { restaurantTelegramEnabled } from '../lib/features.js';
import { isDelivered, notificationKey, sendOnce } from '../lib/notify-once.js';
import { autoAdvanceMockOrders } from '../modules/restaurant-orders/auto.js';

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
      await autoAdvanceMockOrders(); // MOCK-only: safe test payments move on to cooking by themselves (restart-safe sweep)
      await deliverRefundNotices(bot); // Stage 6A: refund request / decision / sent notices
      const rows = await db.order.findMany({
        where: {
          createdViaBot: true,
          status: { in: ['WAITING_RESTAURANT', 'WAITING_CUSTOMER_CONSENT', 'CUSTOMER_CANCELLED', 'RESTAURANT_REJECTED', 'RESTAURANT_EXPIRED', 'PAYMENT_MATCHED_UNVERIFIED', 'PAYMENT_CONFIRMED', 'PREPARING', 'READY'] },
        },
        orderBy: { updatedAt: 'desc' }, take: 200,
        include: {
          restaurant: { select: { staffTelegramUserId: true, staffLinkedAt: true, name: true } },
          customer: { select: { telegramUserId: true } },
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
            console.error(`[STAFF NOTICE] #${order.number}:`, err instanceof Error ? err.message : err);
          }
        }
        const customerChat = order.customer.telegramUserId;
        // No Telegram link (Android guest): there is nobody to message. Settle the marker so the row is not retried every cycle; the app shows the status.
        if (!customerChat && order.customerLastNotifiedStatus !== order.status && ['WAITING_CUSTOMER_CONSENT', 'CUSTOMER_CANCELLED', 'RESTAURANT_REJECTED', 'RESTAURANT_EXPIRED', 'PAYMENT_CONFIRMED', 'PREPARING', 'READY'].includes(order.status)) {
          await db.order.updateMany({ where: { id: order.id, status: order.status }, data: { customerLastNotifiedStatus: order.status } });
          continue;
        }
        if (customerChat && ['CUSTOMER_CANCELLED', 'RESTAURANT_REJECTED', 'RESTAURANT_EXPIRED', 'PAYMENT_CONFIRMED', 'PREPARING', 'READY'].includes(order.status) && order.customerLastNotifiedStatus !== order.status) {
          const messages: Record<string, string> = {
            CUSTOMER_CANCELLED: `❌ #${order.number}: buyurtma bekor qilindi. Pul yubormang.`,
            RESTAURANT_REJECTED: `🚫 #${order.number}: restoran buyurtmani qabul qila olmadi. Pul yubormang.`,
            RESTAURANT_EXPIRED: `⌛ #${order.number}: restoran vaqtida javob bermadi, buyurtma bekor bo‘ldi. Pul yubormang.`,
            PAYMENT_CONFIRMED: `✅ #${order.number}: restoran to‘lovni tekshirib tasdiqladi. Tayyorlash boshlanishini kuting.`,
            PREPARING: `👨‍🍳 #${order.number}: restoran buyurtmangizni tayyorlashni boshladi.`,
            READY: `🍽 #${order.number}: taom tayyor. Taksi operatori bosqichini /orders orqali tekshiring. Bu yetkazildi degani emas.`,
          };
          try {
            const outcome = await sendOnce(bot, { key: notificationKey('order-customer', order.id, order.status, customerChat), kind: 'order-customer',
              chatId: customerChat, orderId: order.id, text: messages[order.status]! });
            if (isDelivered(outcome)) await db.order.updateMany({ where: { id: order.id, status: order.status }, data: { customerLastNotifiedStatus: order.status } });
          } catch (err) {
            console.error(`[CUSTOMER ORDER NOTICE] #${order.number}:`, err instanceof Error ? err.message : err);
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
