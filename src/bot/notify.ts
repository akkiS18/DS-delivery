import type { Telegraf } from 'telegraf';
import { db } from '../lib/db.js';

/** Local MVP notifier. Durable status cursor; duplicate sends on a crash are possible. */
export function startBotPaymentNotifier(bot: Telegraf<any>): () => void {
  let busy = false;
  const loop = async () => {
    if (busy) return;
    busy = true;
    try {
      const payments = await db.payment.findMany({
        where: {
          order: { is: { createdViaBot: true } },
          status: { in: ['AWAITING', 'MATCHED_UNVERIFIED', 'EXPIRED', 'QUEUE_EXPIRED'] },
        },
        orderBy: { number: 'desc' }, take: 100,
        include: { card: { select: { last4: true, isTest: true } }, order: { include: { customer: true } } },
      });
      for (const payment of payments) {
        if (!payment.order || payment.botLastNotifiedStatus === payment.status) continue;
        const id = payment.order.customer.telegramUserId;
        if (!id) { // Android guest without a Telegram link: nobody to message; settle the marker so the row is not re-read every cycle
          await db.payment.updateMany({ where: { id: payment.id, status: payment.status }, data: { botLastNotifiedStatus: payment.status } });
          continue;
        }
        const n = payment.order.code;
        const msgs: Record<string, string> = {
          // Only what the customer must act on. "card assigned" and "payment seen" are on the order screen; the next real news is "paid, cooking".
          EXPIRED: `⌛ #${n}: to‘lov muddati tugadi. Pul o‘tkazgan bo‘lsangiz, qayta to‘lamang va administratorga yozing.`,
          QUEUE_EXPIRED: `⌛ #${n}: to‘lov navbati tugadi. Pul o‘tkazmang; yangi buyurtma bering.`,
        };
        const text = msgs[payment.status];
        if (!text) { // no message for this state: settle the marker so the row is not re-read every cycle
          await db.payment.updateMany({ where: { id: payment.id, status: payment.status }, data: { botLastNotifiedStatus: payment.status } });
          continue;
        }
        try {
          await bot.telegram.sendMessage(id, text);
          await db.payment.updateMany({
            where: { id: payment.id, status: payment.status },
            data: { botLastNotifiedStatus: payment.status },
          });
        } catch (error) {
          console.error(`[BOT NOTICE] #${n}: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
      }
    } catch (error) {
      console.error('[BOT NOTICE]', error instanceof Error ? error.message : 'unknown error');
    } finally { busy = false; }
  };
  const timer = setInterval(() => void loop(), 5000);
  void loop();
  return () => clearInterval(timer);
}
