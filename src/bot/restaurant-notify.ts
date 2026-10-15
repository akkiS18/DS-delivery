import type { Telegraf } from 'telegraf';
import { db } from '../lib/db.js';
import { staffOrderPresentation } from './restaurant.js';

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
      const rows = await db.order.findMany({
        where: {
          createdViaBot: true,
          status: { in: ['PAYMENT_MATCHED_UNVERIFIED', 'PAYMENT_CONFIRMED', 'PREPARING', 'READY'] },
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
        if (linkedBeforeOrder && order.staffLastNotifiedStatus !== order.status) {
          try {
            const presentation = await staffOrderPresentation(staffId!, order.id);
            if (presentation) {
              await bot.telegram.sendMessage(staffId!, presentation.text, presentation.markup);
              await db.order.updateMany({ where: { id: order.id, status: order.status }, data: { staffLastNotifiedStatus: order.status } });
            }
          } catch (err) {
            console.error(`[STAFF NOTICE] #${order.number}:`, err instanceof Error ? err.message : err);
          }
        }
        if (['PAYMENT_CONFIRMED', 'PREPARING', 'READY'].includes(order.status) && order.customerLastNotifiedStatus !== order.status) {
          const messages: Record<string, string> = {
            PAYMENT_CONFIRMED: `✅ #${order.number}: restoran to‘lovni tekshirib tasdiqladi. Tayyorlash boshlanishini kuting.`,
            PREPARING: `👨‍🍳 #${order.number}: restoran buyurtmangizni tayyorlashni boshladi.`,
            READY: `🍽 #${order.number}: taom tayyor. Taksi operatori bosqichini /orders orqali tekshiring. Bu yetkazildi degani emas.`,
          };
          try {
            await bot.telegram.sendMessage(order.customer.telegramUserId, messages[order.status]!);
            await db.order.updateMany({ where: { id: order.id, status: order.status }, data: { customerLastNotifiedStatus: order.status } });
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
