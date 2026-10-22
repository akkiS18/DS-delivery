import { Markup, type Context, type Telegraf } from 'telegraf';
import { isSupportAdmin } from '../modules/support/service.js';
import { commissionStatements, settleRestaurant, type RestaurantStatement } from '../modules/commission/settlement.js';

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const som = (n: number): string => `${n.toLocaleString('en-US')} so‘m`;

/** Armed note input (in memory, 10 min). */
const pending = new Map<string, { restaurantId: string; count: number; amountSom: number; expires: number }>();
const TTL = 10 * 60_000;
const ERR: Record<string, string> = { ADMIN_RUXSAT_YOQ: 'Ruxsat yo‘q.', ADMIN_IZOH_NOTOGRI: 'Izoh 10–300 belgi bo‘lsin.' };

export function renderStatements(list: RestaurantStatement[]): { text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> | null } {
  if (!list.length) return { text: '✅ To‘lanmagan komissiya yo‘q.', keyboard: null };
  const lines = ['💼 <b>Komissiya hisobi</b> (hafta: dushanba 00:00 – dushanba 00:00, Toshkent)'];
  const buttons = [];
  for (const s of list) {
    lines.push('', `🏪 <b>${escapeHtml(s.name)}</b>`,
      `Hozir to‘lanishi kerak: <b>${s.due.count} ta • ${som(s.due.amountSom)}</b>`);
    if (s.held.count) lines.push(`Ushlab turilgan (ochiq murojaat): ${s.held.count} ta • ${som(s.held.amountSom)}`);
    if (s.current.count) lines.push(`Joriy hafta (hafta yopilgach): ${s.current.count} ta • ${som(s.current.amountSom)}`);
    if (s.due.count) buttons.push([Markup.button.callback(`✅ ${s.name.slice(0, 24)}: ${som(s.due.amountSom)} to‘landi`, `com:ask:${s.restaurantId}`)]);
  }
  return { text: lines.join('\n'), keyboard: buttons.length ? Markup.inlineKeyboard(buttons) : null };
}

/**
 * /commission (support administrators only): what each restaurant owes the platform for closed weeks, and a recorded confirmation that the
 * payment was seen in the bank. It never moves money; the ledger itself is not modified (a settlement is a separate append-only record).
 */
export function registerCommissionAdminHandlers<C extends Context>(bot: Telegraf<C>): void {
  const admin = (ctx: Context): string | null => {
    if (!ctx.from || ctx.chat?.type !== 'private') return null;
    try { return isSupportAdmin(String(ctx.from.id)) ? String(ctx.from.id) : null; } catch { return null; }
  };

  bot.command('commission', async ctx => {
    if (!admin(ctx)) return; // silent for everybody else
    const v = renderStatements(await commissionStatements());
    await ctx.reply(v.text, { parse_mode: 'HTML', ...(v.keyboard ? { reply_markup: v.keyboard.reply_markup } : {}) });
  });

  bot.action(/^com:ask:([a-zA-Z0-9_-]{1,40})$/, async ctx => {
    await ctx.answerCbQuery().catch(() => undefined);
    if (!admin(ctx)) return;
    const s = (await commissionStatements()).find(x => x.restaurantId === ctx.match[1]);
    if (!s || !s.due.count) { await ctx.reply('Bu restoran uchun to‘lanishi kerak komissiya yo‘q.'); return; }
    await ctx.reply(
      `${s.name}: ${s.due.count} ta buyurtma, ${som(s.due.amountSom)}.\nBank hisobida aynan shu summa restorandan kelganini tekshirdingizmi?`,
      Markup.inlineKeyboard([[Markup.button.callback('✅ Ha, bankda ko‘rdim', `com:go:${s.restaurantId}:${s.due.count}:${s.due.amountSom}`)], [Markup.button.callback('⬅️ Yo‘q', 'com:no')]]));
  });

  bot.action('com:no', async ctx => { await ctx.answerCbQuery().catch(() => undefined); await ctx.editMessageReplyMarkup(undefined).catch(() => undefined); });

  bot.action(/^com:go:([a-zA-Z0-9_-]{1,40}):(\d{1,6}):(\d{1,10})$/, async ctx => {
    await ctx.answerCbQuery().catch(() => undefined);
    const id = admin(ctx);
    if (!id) return;
    pending.set(id, { restaurantId: ctx.match[1]!, count: Number(ctx.match[2]), amountSom: Number(ctx.match[3]), expires: Date.now() + TTL });
    await ctx.reply('Izoh yozing (10+ belgi): bank amali sanasi/vaqti va qaysi hisobdan kelgani. Bekor qilish: /cancel');
  });

  bot.command('cancel', async (ctx, next) => {
    const id = admin(ctx);
    if (id && pending.delete(id)) { await ctx.reply('Bekor qilindi.'); return; }
    return next();
  });

  bot.on('text', async (ctx, next) => {
    const id = admin(ctx);
    const wait = id ? pending.get(id) : undefined;
    if (!id || !wait) return next();
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) { pending.delete(id); return next(); }
    if (wait.expires < Date.now()) { pending.delete(id); await ctx.reply('Vaqt tugadi. Qaytadan boshlang: /commission'); return; }
    try {
      const r = await settleRestaurant({ restaurantId: wait.restaurantId, adminId: id, expectedCount: wait.count, expectedSom: wait.amountSom, note: text });
      pending.delete(id);
      if (r.result === 'SETTLED') await ctx.reply(`✅ Hisob #${r.settlementNumber} qayd etildi: ${r.count} ta buyurtma, ${som(r.amountSom)}.`);
      else if (r.result === 'CHANGED') await ctx.reply(`ℹ️ Ma’lumot o‘zgargan (hozir ${r.count} ta, ${som(r.amountSom)}). Hech narsa yozilmadi. /commission orqali qayta tekshiring.`);
      else await ctx.reply('ℹ️ To‘lanishi kerak komissiya qolmagan.');
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'ADMIN_IZOH_NOTOGRI') { await ctx.reply(`${ERR[code]} Qayta yozing (yoki /cancel).`); return; }
      pending.delete(id);
      await ctx.reply(`⚠️ Bajarilmadi: ${ERR[code] ?? 'xatolik'}`);
    }
  });
}
