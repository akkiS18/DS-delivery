import { Markup, type Context, type Telegraf } from 'telegraf';
import { isSupportAdmin } from '../modules/support/service.js';
import { formatSom } from '../modules/payment/uzcard.js';
import { REVIEW_ACTIONS, REVIEW_ACTION_LABEL, explainReason, type ReviewAction } from '../modules/payment/review-reasons.js';
import { handleReview, listStaleUnverified, listUnhandledReviews, type ReviewItem } from '../modules/payment/review.js';

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (d: Date): string => new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');

/** Armed note input (in memory, 10 min): the administrator's reason for closing a review item. */
const pending = new Map<string, { incomingId: string; action: ReviewAction; expires: number }>();
const TTL = 10 * 60_000;
const ERR: Record<string, string> = {
  ADMIN_RUXSAT_YOQ: 'Ruxsat yo‘q.', ADMIN_IZOH_NOTOGRI: 'Izoh 10–300 belgi bo‘lsin.', AMAL_NOTOGRI: 'Amal noto‘g‘ri.',
};

export function renderReviewItem(r: ReviewItem): { text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> } {
  const text = [
    `⚠️ <b>Mos kelmagan pul</b>`,
    `Summa: <b>${formatSom(r.amountTiyin)}</b> | karta ***${r.cardLast4}${r.restaurantName ? ` (${escapeHtml(r.restaurantName)})` : ''}`,
    `Bank amali: ${fmt(r.occurredAt)} (Toshkent)${r.emailReceivedAt ? ` | xat: ${fmt(r.emailReceivedAt)}` : ''}`,
    `Sabab: ${escapeHtml(explainReason(r.reason))} <code>${escapeHtml(r.reason ?? '')}</code>`,
    '',
    'Bank ilovasida tekshiring. Pulni avtomatik hech narsaga bog‘lamayman: qaror va izohingiz saqlanadi.',
  ].join('\n');
  const keyboard = Markup.inlineKeyboard(REVIEW_ACTIONS.map(a => [Markup.button.callback(REVIEW_ACTION_LABEL[a], `mon:${a}:${r.id}`)]));
  return { text, keyboard };
}

/**
 * /money (support administrators only): money that arrived but matched no payment, and payments waiting too long for the restaurant to confirm.
 * Closing an item records the decision and a written note; it never moves money or touches a payment.
 */
export function registerMoneyAdminHandlers<C extends Context>(bot: Telegraf<C>): void {
  const admin = (ctx: Context): string | null => {
    if (!ctx.from || ctx.chat?.type !== 'private') return null;
    try { return isSupportAdmin(String(ctx.from.id)) ? String(ctx.from.id) : null; } catch { return null; }
  };

  bot.command('money', async ctx => {
    if (!admin(ctx)) return; // silent for everybody else
    const [items, stale] = await Promise.all([listUnhandledReviews(10), listStaleUnverified(10)]);
    if (stale.length) {
      await ctx.reply(['⏳ <b>10+ daqiqa tasdiqlanmagan to‘lovlar</b> (avtomatik tasdiq ishlamadi; mijoz to‘lagan, hech kim pishirmayapti):',
        ...stale.map(s => `#${s.orderNumber ?? '?'} ${escapeHtml(s.restaurantName)} • ${formatSom(s.amountTiyin)} • ${fmt(s.matchedAt)}`)].join('\n'), { parse_mode: 'HTML' });
    }
    if (!items.length && !stale.length) { await ctx.reply('✅ Mos kelmagan yoki kutayotgan pul yo‘q.'); return; }
    for (const r of items) {
      const v = renderReviewItem(r);
      await ctx.reply(v.text, { parse_mode: 'HTML', reply_markup: v.keyboard.reply_markup });
    }
  });

  bot.action(/^mon:(NOT_OURS|REFUNDED|ORDER_RESOLVED|OTHER):([a-zA-Z0-9_-]{1,40})$/, async ctx => {
    await ctx.answerCbQuery().catch(() => undefined);
    const id = admin(ctx);
    if (!id) return;
    const action = ctx.match[1] as ReviewAction;
    pending.set(id, { incomingId: ctx.match[2]!, action, expires: Date.now() + TTL });
    await ctx.reply(`„${REVIEW_ACTION_LABEL[action]}“. Izoh yozing (10+ belgi): nima tekshirildi, buyurtma raqami yoki pul qaytarilgan hisob. Bekor qilish: /cancel`);
  });

  bot.command('cancel', async (ctx, next) => {
    const id = admin(ctx);
    if (id && pending.delete(id)) { await ctx.reply('Bekor qilindi.'); return; }
    return next();
  });

  // Free text is consumed only when this administrator armed a note; everything else falls through to the next handler.
  bot.on('text', async (ctx, next) => {
    const id = admin(ctx);
    const wait = id ? pending.get(id) : undefined;
    if (!id || !wait) return next();
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) { pending.delete(id); return next(); }
    if (wait.expires < Date.now()) { pending.delete(id); await ctx.reply('Vaqt tugadi. Qaytadan boshlang: /money'); return; }
    try {
      const r = await handleReview({ incomingId: wait.incomingId, adminId: id, action: wait.action, note: text });
      pending.delete(id);
      await ctx.reply(r.result === 'HANDLED' ? '✅ Qaror va izoh saqlandi.' : 'ℹ️ Bu element allaqachon yopilgan yoki topilmadi. /money orqali yangilang.');
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'ADMIN_IZOH_NOTOGRI') { await ctx.reply(`${ERR[code]} Qayta yozing (yoki /cancel).`); return; }
      pending.delete(id);
      await ctx.reply(`⚠️ Bajarilmadi: ${ERR[code] ?? 'xatolik'}`);
    }
  });
}
