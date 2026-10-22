import type { Context, Telegraf } from 'telegraf';
import type { PaymentEngineV3 } from '../modules/payment/engine.js';
import { cancelWaitingOrder, respondToRevision, type ConsentResult } from '../modules/restaurant/price-consent.js';

const reply = (r: ConsentResult): string => {
  switch (r.result) {
    case 'ACCEPTED': return '✅ Rozilik qabul qilindi. To‘lov rekvizitlari /orders bo‘limida. Pulni faqat ko‘rsatilgan yangi summada yuboring.';
    case 'DECLINED': return '❌ Buyurtma bekor qilindi. Pul yubormang.';
    case 'EXPIRED': return '⌛ Rozilik muddati tugadi, buyurtma bekor qilindi. Pul yubormang.';
    case 'MENU_CHANGED': return '⚠️ Menyu yana o‘zgargani uchun buyurtma bekor qilindi. Pul yubormang.';
    case 'NOT_FOUND': return 'Taklif topilmadi.';
    default: return 'Bu taklif allaqachon yopilgan.';
  }
};

/** Customer-side buttons. Ownership is enforced in the service by Telegram id, never by the callback id alone. */
export function registerPriceConsentHandlers<C extends Context>(bot: Telegraf<C>, engine: PaymentEngineV3): void {
  bot.action(/^price:(yes|no):([a-zA-Z0-9_-]+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (!ctx.from || ctx.chat?.type !== 'private') return;
    try {
      const r = await respondToRevision(engine, {
        telegramUserId: String(ctx.from.id), revisionId: ctx.match[2]!, accept: ctx.match[1] === 'yes' });
      await ctx.reply(reply(r));
    } catch (err) {
      console.error('[PRICE CONSENT]', err instanceof Error ? err.message : 'Unknown error');
      await ctx.reply('Amal bajarilmadi. /orders orqali holatni tekshiring. Pul yubormang.');
    }
  });

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
