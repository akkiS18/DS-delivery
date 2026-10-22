import type { Context, Telegraf } from 'telegraf';
import { cancelWaitingOrder } from '../modules/restaurant/waiting-cancel.js';

/** Customer "cancel" button on an order that the restaurant has not decided yet. Ownership is enforced in the service by Telegram id. */
export function registerOrderCancelHandler<C extends Context>(bot: Telegraf<C>): void {
  bot.action(/^order:cancel:([a-zA-Z0-9_-]+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (!ctx.from || ctx.chat?.type !== 'private') return;
    try {
      const r = await cancelWaitingOrder({ telegramUserId: String(ctx.from.id), orderId: ctx.match[1]! });
      await ctx.reply(r.result === 'CANCELLED' ? '❌ Buyurtma bekor qilindi. Pul yubormang.'
        : r.result === 'TOO_LATE' ? 'Restoran buyurtmani allaqachon ko‘rib chiqdi, endi bekor qilib bo‘lmaydi. /orders orqali holatni ko‘ring.'
        : 'Buyurtma topilmadi.');
    } catch (err) {
      console.error('[ORDER CANCEL]', err instanceof Error ? err.message : 'Unknown error');
      await ctx.reply('Amal bajarilmadi. /orders orqali holatni tekshiring.');
    }
  });
}
