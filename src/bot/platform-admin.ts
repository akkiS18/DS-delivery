import { Markup, type Context, type Telegraf } from 'telegraf';
import { isSupportAdmin, supportAdminIds } from '../modules/support/service.js';
import { paymentsPanel, setRealPaymentsOpen } from '../modules/platform/settings.js';
import { createRestaurantByAdmin, linkStaffByAdmin, resetRestaurantPasswordByAdmin } from '../modules/restaurant/provision.js';

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Stage 9: platform-administrator commands. /payments opens and closes real payments; /newrestaurant, /resetpassword, /linkstaff set restaurants up. */
export async function renderPayments(): Promise<{ text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> | null }> {
  const p = await paymentsPanel();
  const lines = ['💳 <b>Real to‘lov</b>'];
  if (!p.gateActive) {
    lines.push('Bu test serveri: kalit faqat production serverda ishlaydi.');
    return { text: lines.join('\n'), keyboard: null };
  }
  lines.push(p.open ? '🟢 <b>OCHIQ</b>: mijozlar haqiqiy pul to‘lashi mumkin.' : '🔴 <b>YOPIQ</b>: yangi buyurtma olinmaydi.');
  if (!p.open && p.blockers.length) {
    lines.push('', 'Yoqib bo‘lmaydi:', ...p.blockers.map(b => `• ${escapeHtml(b)}`));
    return { text: lines.join('\n'), keyboard: null };
  }
  const button = p.open ? Markup.button.callback('⛔ Yopish', 'pay:ask:0') : Markup.button.callback('▶️ Real to‘lovni yoqish', 'pay:ask:1');
  if (p.open) lines.push('Yopsangiz ham, allaqachon berilgan buyurtmalar to‘lovi davom etadi.');
  return { text: lines.join('\n'), keyboard: Markup.inlineKeyboard([[button]]) };
}

export function registerPlatformAdminHandlers<C extends Context>(bot: Telegraf<C>): void {
  const admin = (ctx: Context): string | null => {
    if (!ctx.from || ctx.chat?.type !== 'private') return null;
    try { return isSupportAdmin(String(ctx.from.id)) ? String(ctx.from.id) : null; } catch { return null; }
  };
  const argsOf = (ctx: Context): string => {
    const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
    return text.replace(/^\/\S+\s*/, '').trim();
  };

  bot.command('payments', async ctx => {
    if (!admin(ctx)) return; // silent for everybody else
    const v = await renderPayments();
    await ctx.reply(v.text, { parse_mode: 'HTML', ...(v.keyboard ? { reply_markup: v.keyboard.reply_markup } : {}) });
  });

  bot.action(/^pay:(ask|go|back):?([01])?$/, async ctx => {
    await ctx.answerCbQuery().catch(() => undefined);
    const adminId = admin(ctx);
    if (!adminId) return;
    const [, step, flag] = ctx.match as unknown as [string, 'ask' | 'go' | 'back', '0' | '1' | undefined];
    const edit = (text: string, keyboard?: ReturnType<typeof Markup.inlineKeyboard> | null) =>
      ctx.editMessageText(text, { parse_mode: 'HTML', ...(keyboard ? { reply_markup: keyboard.reply_markup } : {}) }).catch(() => ctx.reply(text, { parse_mode: 'HTML' }));
    if (step === 'back') { const v = await renderPayments(); await edit(v.text, v.keyboard); return; }
    const open = flag === '1';
    if (step === 'ask') {
      await edit(
        open ? '▶️ <b>Real to‘lovni yoqasizmi?</b>\nMijozlar shu daqiqadan haqiqiy pul to‘lay boshlaydi.' : '⛔ <b>Real to‘lovni yopasizmi?</b>\nYangi buyurtma olinmaydi.',
        Markup.inlineKeyboard([[Markup.button.callback(open ? '✅ Ha, yoqaman' : '✅ Ha, yopaman', `pay:go:${open ? 1 : 0}`), Markup.button.callback('⬅️ Orqaga', 'pay:back')]]),
      );
      return;
    }
    const r = await setRealPaymentsOpen({ adminId, open });
    if (r.result === 'BLOCKED') { await edit(['Yoqib bo‘lmadi:', ...r.blockers.map(b => `• ${escapeHtml(b)}`)].join('\n')); return; }
    await edit(r.result === 'CHANGED' ? (open ? '🟢 Real to‘lov <b>ochildi</b>.' : '🔴 Real to‘lov <b>yopildi</b>.') : 'Holat o‘zgarmadi.');
    if (r.result === 'CHANGED') {
      let others: string[] = [];
      try { others = supportAdminIds().filter(id => id !== adminId); } catch { /* none configured */ }
      for (const id of others) {
        await bot.telegram.sendMessage(id, open ? '🟢 Real to‘lov ochildi (boshqa administrator).' : '🔴 Real to‘lov yopildi (boshqa administrator).').catch(() => undefined);
      }
    }
  });

  bot.command('newrestaurant', async ctx => {
    const adminId = admin(ctx);
    if (!adminId) return;
    const [name, address, phone] = argsOf(ctx).split('|').map(s => s.trim());
    if (!name || !address) {
      await ctx.reply('Yozing:\n<code>/newrestaurant Nomi | Manzil | +998901234567</code>\n(telefon ixtiyoriy)', { parse_mode: 'HTML' });
      return;
    }
    try {
      const r = await createRestaurantByAdmin({ adminId, name, pickupAddress: address, pickupPhone: phone || undefined });
      await ctx.reply([
        `✅ <b>${escapeHtml(r.name)}</b> qo‘shildi.`,
        `Restoran kodi: <code>${escapeHtml(r.slug)}</code>`,
        `Parol: <code>${escapeHtml(r.password)}</code>`,
        '',
        'Parol faqat shu yerda ko‘rsatiladi: xodimga o‘zingiz yetkazing. Yo‘qolsa: <code>/resetpassword ' + escapeHtml(r.slug) + '</code>',
        'Restoran to‘xtatilgan holda boshlandi: xodim menyu va karta qo‘shgach “Buyurtma qabul qilish”ni yoqadi.',
        `Telegram xabarlari uchun: <code>/linkstaff ${escapeHtml(r.slug)} TELEGRAM_ID</code>`,
      ].join('\n'), { parse_mode: 'HTML' });
    } catch (err) {
      const m = err instanceof Error ? err.message : '';
      await ctx.reply(m === 'TELEFON_NOTOGRI' ? 'Telefon raqami noto‘g‘ri.' : m === 'NOM_QISQA' || m === 'MANZIL_QISQA' ? 'Nom yoki manzil juda qisqa.' : 'Qo‘shib bo‘lmadi.');
    }
  });

  bot.command('resetpassword', async ctx => {
    const adminId = admin(ctx);
    if (!adminId) return;
    const slug = argsOf(ctx).split(/\s+/)[0] ?? '';
    if (!slug) { await ctx.reply('Yozing: <code>/resetpassword restoran-kodi</code>', { parse_mode: 'HTML' }); return; }
    const r = await resetRestaurantPasswordByAdmin({ adminId, slug });
    if (!r) { await ctx.reply('Bunday restoran yo‘q.'); return; }
    await ctx.reply(`🔑 <b>${escapeHtml(r.name)}</b>\nYangi parol: <code>${escapeHtml(r.password)}</code>\nEski parol va barcha kirgan qurilmalar o‘chirildi.`, { parse_mode: 'HTML' });
  });

  bot.command('linkstaff', async ctx => {
    const adminId = admin(ctx);
    if (!adminId) return;
    const [slug, tid] = argsOf(ctx).split(/\s+/);
    if (!slug || !tid) { await ctx.reply('Yozing: <code>/linkstaff restoran-kodi TELEGRAM_ID</code>', { parse_mode: 'HTML' }); return; }
    try {
      const r = await linkStaffByAdmin({ adminId, slug, telegramId: tid });
      await ctx.reply(r.result === 'LINKED' ? `✅ ${escapeHtml(r.name)}: yangi buyurtma xabarlari shu Telegramga boradi. Xodim botda /start bosgan bo‘lsin.`
        : r.result === 'TAKEN' ? `Bu Telegram boshqa restoranga (${escapeHtml(r.otherSlug)}) bog‘langan.` : 'Bunday restoran yo‘q.', { parse_mode: 'HTML' });
    } catch { await ctx.reply('Telegram ID faqat raqamlardan iborat bo‘lsin.'); }
  });
}
