import { Markup, type Context, type Telegraf } from 'telegraf';
import { bindFromBot, botDecision, LINK_START_PREFIX } from '../modules/miniapp/telegram-link.js';

const INVALID = 'Bog‘lash havolasi yaroqsiz yoki muddati tugagan. Ilovada “Telegramga bog‘lash” tugmasini qaytadan bosing.';

/** True when `/start <payload>` is a link payload (so the normal launcher must not also run). */
export const isLinkPayload = (payload: string | undefined): payload is string => Boolean(payload?.startsWith(LINK_START_PREFIX));

/**
 * `/start lnk_<token>`. The Telegram identity is read from the real bot update (`ctx.from`), never from the token or the payload.
 * Nothing is linked here: the user must press "confirm", and then confirm once more inside the app.
 */
export async function handleLinkStart<C extends Context>(ctx: C, payload: string): Promise<void> {
  if (!ctx.from || ctx.from.is_bot) return;
  const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || null;
  const r = await bindFromBot(payload.slice(LINK_START_PREFIX.length), { id: String(ctx.from.id), name, username: ctx.from.username ?? null });
  if (r.result !== 'BOUND') { await ctx.reply(INVALID); return; }
  await ctx.reply(
    `🔗 DS Delivery ilovasidagi profilni shu Telegram akkauntga bog‘lashni xohlaysizmi?\n\n` +
    (r.existingAccount ? 'Bu akkauntda oldingi buyurtmalar bor: ilovadagi ma’lumotlar shu akkauntga qo‘shiladi.\n\n' : '') +
    'Faqat ilovani o‘zingiz ochgan bo‘lsangiz tasdiqlang. Keyin ilovaga qaytib, bog‘lashni yana bir marta tasdiqlaysiz.',
    Markup.inlineKeyboard([[Markup.button.callback('✅ Ha, bog‘lash', `lnk:y:${r.attemptId}`), Markup.button.callback('❌ Bekor qilish', `lnk:n:${r.attemptId}`)]]));
}

export function registerTelegramLinkHandlers<C extends Context>(bot: Telegraf<C>): void {
  bot.action(/^lnk:(y|n):([A-Za-z0-9_-]{1,64})$/, async ctx => {
    await ctx.answerCbQuery();
    if (!ctx.from || ctx.chat?.type !== 'private') return;
    const accept = ctx.match[1] === 'y';
    try {
      const r = await botDecision(ctx.match[2]!, String(ctx.from.id), accept);
      await ctx.reply(r === 'CONFIRMED' ? '✅ Tasdiqlandi. Endi DS Delivery ilovasiga qaytib, bog‘lashni tasdiqlang.'
        : r === 'CANCELLED' ? '❌ Bog‘lash bekor qilindi.' : INVALID);
    } catch (err) {
      console.error('[TELEGRAM LINK]', err instanceof Error ? err.message : 'Unknown error');
      await ctx.reply('Amal bajarilmadi. Ilovadan qaytadan urinib ko‘ring.');
    }
  });
}
