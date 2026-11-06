import { Markup, type Context, type Telegraf } from 'telegraf';
import { isSupportAdmin } from '../modules/support/service.js';
import { listRestaurantsForAdmin, setRestaurantActive, type AdminRestaurantRow } from '../modules/restaurant/admin.js';

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function renderRestaurants(rows: AdminRestaurantRow[]): { text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> | null } {
  if (!rows.length) return { text: 'Restoranlar yo‘q.', keyboard: null };
  const lines = ['🏪 <b>Restoranlar</b>'];
  const buttons = [];
  for (const r of rows) {
    const flags = [
      r.isActive ? '✅ faol' : '⛔ to‘xtatilgan',
      r.isPaused ? '⏸ pauza' : null,
      r.hasPassword ? null : '⚠️ parol yo‘q',
      r.staffLinked ? null : 'Telegram xodimi ulanmagan',
      `kartalar: ${r.enabledCards} faol${r.pendingCards ? `, ${r.pendingCards} kutmoqda` : ''}`,
    ].filter(Boolean).join(' • ');
    lines.push(`• <b>${escapeHtml(r.name)}</b> <code>${escapeHtml(r.slug)}</code>\n  ${flags}`);
    buttons.push([Markup.button.callback(`${r.isActive ? '⛔ To‘xtatish' : '▶️ Yoqish'}: ${r.name.slice(0, 22)}`, `rst:ask:${r.id}:${r.isActive ? 0 : 1}`)]);
  }
  return { text: lines.join('\n'), keyboard: Markup.inlineKeyboard(buttons) };
}

/** /restaurants (support administrators only): who is on the platform, suspend or resume. Two taps, audited. */
export function registerRestaurantAdminHandlers<C extends Context>(bot: Telegraf<C>): void {
  const admin = (ctx: Context): string | null => {
    if (!ctx.from || ctx.chat?.type !== 'private') return null;
    try { return isSupportAdmin(String(ctx.from.id)) ? String(ctx.from.id) : null; } catch { return null; }
  };

  // /admin: the administrator's command list (everybody else gets no answer, so the commands stay undiscoverable).
  bot.command('admin', async ctx => {
    if (!admin(ctx)) return;
    await ctx.reply([
      '🛠 <b>Admin buyruqlari</b>',
      '/money — mos kelmagan pul va uzoq tasdiqlanmagan to‘lovlar',
      '/cards — restoran kartalari va yangi karta tasdig‘i',
      '/pool — platforma kartalari (guruh) va aylanma',
      '/platformcard — platforma kartasini qo‘shish',
      '/restocard — restoranga karta qo‘shish (restoranlar o‘zi qo‘sha olmasa)',
      '/manualpay — restoran pulni o‘zi tasdiqlaydi (Shirin rejimi): /manualpay kod on|off',
      '/cardname — platforma kartasi egasining ko‘rinadigan nomini o‘zgartirish',
      '/cardoff, /cardon — platforma kartasini o‘chirish / qayta yoqish',
      '/collect — restoran pulini platforma kartalariga o‘tkazish / qaytarish',
      '/commission — haftalik komissiya hisobi',
      '/financepin — restoranning moliya bo‘limi kodini berish: /financepin restoran-kodi',
      '/waive — bitta buyurtma komissiyasini olib tashlash: /waive KOD sabab',
      '/paidout — platforma kartasidan restoranga o‘tkazganingizni belgilash: /paidout restoran-kodi',
      '/restaurants — restoranni to‘xtatish / yoqish',
      '/newrestaurant — yangi restoran qo‘shish (rasm bilan: rasm izohiga yozing)',
      '/restaurantphoto — restoran rasmini qo‘yish yoki almashtirish',
      '/ratings — restoran baholari va reyting bo‘yicha tartiblash',
      '/resetpassword — restoran parolini yangilash',
      '/linkstaff — restoran xodimining Telegramini ulash',
      '/demo — restoran ilovasiga SINOV buyurtma yuborish (tushuntirish uchun; tarixga yozilmaydi)',
      '/payments — real to‘lovni yoqish / yopish',
      '/fee — xizmat haqi rejimi (tekis / foiz / pog‘onali)',
      '/cash — naqd to‘lov variantini yoqish / yopish',
      '/taxi — taksi qachon chaqirilishini ko‘rish (admin rejimi)',
      '/deleterestaurant — restoranni o‘chirish (tarixi bo‘lsa arxivlanadi)',
      '/newtaxi — yangi taksi kompaniyasi va uning ilova logini',
      '/taxiapp — taksi ilovasi uchun yangi parol',
      '/deletetaxi — taksi kompaniyasini o‘chirish (tarixi bo‘lsa arxivlanadi)',
      '/tickets — mijoz murojaatlari',
      '/logoutall — DS Admin ilovasidagi barcha qurilmalarni yopish',
      'Taksi muammolari: /taxiadmin (taksi botida; taksi boti o‘chirilgan bo‘lsa shu botda)',
    ].join('\n'), { parse_mode: 'HTML' });
  });

  bot.command('restaurants', async ctx => {
    if (!admin(ctx)) return; // silent for everybody else
    const v = renderRestaurants(await listRestaurantsForAdmin());
    await ctx.reply(v.text, { parse_mode: 'HTML', ...(v.keyboard ? { reply_markup: v.keyboard.reply_markup } : {}) });
  });

  bot.action(/^rst:(ask|go):([a-zA-Z0-9_-]{1,40}):([01])$/, async ctx => {
    await ctx.answerCbQuery().catch(() => undefined);
    const adminId = admin(ctx);
    if (!adminId) return;
    const [, step, id, flag] = ctx.match as unknown as [string, 'ask' | 'go', string, '0' | '1'];
    const active = flag === '1';
    if (step === 'ask') {
      const name = (await listRestaurantsForAdmin()).find(r => r.id === id)?.name ?? 'Restoran';
      await ctx.reply(
        active ? `${name}: qayta yoqilsinmi? Restoran yana buyurtma qabul qila oladi.`
          : `${name}: to‘xtatilsinmi? Yangi buyurtmalar qabul qilinmaydi va restoran ilovadan chiqarib yuboriladi. Mavjud buyurtmalar o‘zgarmaydi.`,
        Markup.inlineKeyboard([[Markup.button.callback(active ? '▶️ Ha, yoqish' : '⛔ Ha, to‘xtatish', `rst:go:${id}:${flag}`)]]));
      return;
    }
    try {
      const r = await setRestaurantActive({ restaurantId: id, active, adminId });
      await ctx.reply(r.result === 'CHANGED' ? (active ? '✅ Restoran yoqildi.' : `⛔ Restoran to‘xtatildi (${r.signedOut ?? 0} ta seans yopildi).`)
        : r.result === 'UNCHANGED' ? 'ℹ️ Holat allaqachon shunday.' : 'Restoran topilmadi.');
    } catch { await ctx.reply('⚠️ Bajarilmadi.'); }
  });
}
