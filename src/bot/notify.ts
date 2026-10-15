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
        const n = payment.order.number;
        const msgs: Record<string, string> = {
          AWAITING: `🟡 #${n}: karta ajratildi. Botda /orders buyrug‘i orqali rekvizitlarni ko‘ring.`,
          MATCHED_UNVERIFIED: `🔎 #${n}: kirim xabari mos keldi, ammo bank to‘lovi hali mustaqil tasdiqlanmagan. Restoran tasdig‘i kutilmoqda.`,
          EXPIRED: `⌛ #${n}: to‘lov muddati tugadi. Agar pul yuborgan bo‘lsangiz, qaytadan to‘lamang; tekshiruv uchun administratorga murojaat qiling.`,
          QUEUE_EXPIRED: `⌛ #${n}: karta ajratish navbati muddati tugadi. Pul yubormang; yangi buyurtma ochishingiz mumkin.`,
        };
        try {
          await bot.telegram.sendMessage(id, msgs[payment.status]!);
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
