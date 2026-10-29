import type { Context, Telegraf } from 'telegraf';
import { isSupportAdmin } from '../modules/support/service.js';
import { logoutAll } from '../modules/admin-auth/service.js';

/** DS Admin app: /logoutall signs the administrator out of the app on every phone (lost or stolen device). Support admins only. */
export function registerAdminAppHandlers<C extends Context>(bot: Telegraf<C>): void {
  bot.command('logoutall', async ctx => {
    if (!ctx.from || ctx.chat?.type !== 'private') return;
    const id = String(ctx.from.id);
    let ok = false;
    try { ok = isSupportAdmin(id); } catch { ok = false; }
    if (!ok) return;
    const closed = await logoutAll(id);
    await ctx.reply(closed ? `✅ DS Admin ilovasidagi ${closed} ta qurilma yopildi. Qayta kirish uchun yangi kod kerak bo‘ladi.` : 'DS Admin ilovasida ochiq qurilma yo‘q edi.');
  });
}
