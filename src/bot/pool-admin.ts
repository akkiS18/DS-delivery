import type { Context, Telegraf } from 'telegraf';
import { isSupportAdmin } from '../modules/support/service.js';
import { addPlatformCard, poolOverview, renamePlatformCard, setCollectsToPlatform, setPlatformCardActive } from '../modules/payment/pool-admin.js';

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const som = (n: number): string => n.toLocaleString('en-US').replace(/,/g, ' ');
const STATUS = { PENDING: '⏳ tasdiq kutmoqda', ACTIVE: '✅ faol', DISABLED: '⏸ o‘chirilgan', REJECTED: '❌ rad etilgan' } as const;

/** Platform card pool commands (support admins only): /pool, /platformcard, /cardname, /cardoff, /cardon, /collect. */
export function registerPoolAdminHandlers<C extends Context>(bot: Telegraf<C>): void {
  const admin = (ctx: Context): string | null => {
    if (!ctx.from || ctx.chat?.type !== 'private') return null;
    try { return isSupportAdmin(String(ctx.from.id)) ? String(ctx.from.id) : null; } catch { return null; }
  };
  const argsOf = (ctx: Context): string => {
    const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
    return text.replace(/^\/\S+\s*/, '').trim();
  };

  bot.command('pool', async ctx => {
    if (!admin(ctx)) return;
    const o = await poolOverview();
    const lines = ['💳 <b>Platforma kartalari</b>', `Chegara: har bir karta uchun ${o.days} kunda ${o.capSom === 0 ? 'cheklanmagan' : som(o.capSom) + ' so‘m'}.`];
    lines.push(...(o.cards.length ? o.cards.map(c => `***${c.last4} • ${STATUS[c.status]} • ${o.days} kunlik tushum: ${som(c.turnoverSom)} so‘m`) : ['Karta yo‘q. Qo‘shish: <code>/platformcard 8600XXXXXXXXXXXX ISM FAMILIYA</code>']));
    lines.push('', o.restaurants.length ? 'Pul platformaga tushadigan restoranlar: ' + o.restaurants.map(r => `${escapeHtml(r.name)} (<code>${escapeHtml(r.slug)}</code>)`).join(', ') : 'Hozircha hech bir restoran platforma kartasiga o‘tkazilmagan.');
    lines.push('O‘tkazish: <code>/collect restoran-kodi on</code>, qaytarish: <code>/collect restoran-kodi off</code>');
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  bot.command('platformcard', async ctx => {
    const adminId = admin(ctx);
    if (!adminId) return;
    const m = argsOf(ctx).match(/^([\d\s-]{16,25})\s+(.{3,40})$/u);
    if (!m) { await ctx.reply('Format: /platformcard 8600XXXXXXXXXXXX ISM FAMILIYA'); return; }
    const r = await addPlatformCard({ adminId, number: m[1]!, holderName: m[2]! });
    if (r.ok) {
      // The command text holds the full card number: remove it from the chat history (best effort).
      await ctx.deleteMessage().catch(() => undefined);
      await ctx.reply(`✅ Karta ***${r.last4} qo‘shildi. Bir necha soniyada tasdiqlash xabari keladi (/cards).`);
    } else {
      await ctx.reply({ CARD_NUMBER_INVALID: 'Karta raqami noto‘g‘ri (16 xona, tekshiruv raqami mos kelmadi).', HOLDER_INVALID: 'Karta egasining ismi noto‘g‘ri.', CARD_TAKEN: 'Bu karta tizimda allaqachon bor.' }[r.code]);
    }
  });

  bot.command('cardname', async ctx => {
    const adminId = admin(ctx);
    if (!adminId) return;
    const m = argsOf(ctx).match(/^(\d{4})\s+(.{3,40})$/u);
    if (!m) { await ctx.reply('Format: /cardname 7572 ISM F. (karta oxirgi 4 raqami va mijozga ko‘rinadigan nom)'); return; }
    const r = await renamePlatformCard({ adminId, last4: m[1]!, holderName: m[2]! });
    await ctx.reply({
      DONE: `✅ ***${m[1]} egasi nomi o‘zgartirildi.`, UNCHANGED: 'Nom o‘zgarmadi (allaqachon shunday).', NOT_FOUND: 'Bunday platforma kartasi topilmadi (/pool).',
      HOLDER_INVALID: 'Nom noto‘g‘ri (harflar, bo‘shliq, nuqta; 3–40 belgi).', NOT_APPROVED: '', LAST_ACTIVE_CARD: '', OPEN_PAYMENTS: '',
    }[r.result] || 'Bajarilmadi.');
  });

  const cardSwitch = (name: 'cardoff' | 'cardon', active: boolean) => bot.command(name, async ctx => {
    const adminId = admin(ctx);
    if (!adminId) return;
    const m = argsOf(ctx).match(/^(\d{4})$/);
    if (!m) { await ctx.reply(`Format: /${name} 7572 (karta oxirgi 4 raqami)`); return; }
    const r = await setPlatformCardActive({ adminId, last4: m[1]!, active });
    if (r.result === 'DONE') await ctx.reply(active ? `✅ ***${m[1]} yoqildi: mijozlarga berila boshlaydi.` : `✅ ***${m[1]} o‘chirildi: mijozlarga berilmaydi (tarixi saqlanadi, /cardon bilan qaytarish mumkin).`);
    else if (r.result === 'UNCHANGED') await ctx.reply('O‘zgarmadi (allaqachon shunday).');
    else if (r.result === 'NOT_FOUND') await ctx.reply('Bunday platforma kartasi topilmadi (/pool).');
    else if (r.result === 'NOT_APPROVED') await ctx.reply('Bu karta hali tasdiqlanmagan (/cards).');
    else if (r.result === 'LAST_ACTIVE_CARD') await ctx.reply('⛔ Bu oxirgi faol platforma kartasi: o‘chirsangiz pul qabul qiladigan karta qolmaydi. Avval boshqa kartani yoqing.');
    else if (r.result === 'OPEN_PAYMENTS') await ctx.reply(`⛔ Hozir bu kartaga to‘lanayotgan ${r.count} ta to‘lov bor. Tugagach (taxminan 10 daqiqa) qayta urining.`);
  });
  cardSwitch('cardoff', false);
  cardSwitch('cardon', true);

  bot.command('collect', async ctx => {
    const adminId = admin(ctx);
    if (!adminId) return;
    const m = argsOf(ctx).match(/^([a-z0-9][a-z0-9-]{1,60})\s+(on|off)$/i);
    if (!m) { await ctx.reply('Format: /collect restoran-kodi on|off'); return; }
    const on = m[2]!.toLowerCase() === 'on';
    const r = await setCollectsToPlatform({ adminId, slug: m[1]!.toLowerCase(), on });
    if (r.result === 'NOT_FOUND') await ctx.reply('Bunday restoran topilmadi.');
    else if (r.result === 'NO_POOL_CARD') await ctx.reply('Faol, tasdiqlangan platforma kartasi yo‘q. Avval /platformcard bilan qo‘shing va tasdiqlang.');
    else if (r.result === 'OPEN_PAYMENTS') await ctx.reply(`⛔ ${r.name}: hozir to‘lanmagan ${r.count} ta karta to‘lovi bor. Ular tugagach (taxminan 10 daqiqa) qayta urining.`);
    else if (r.result === 'UNCHANGED') await ctx.reply(`${r.name}: o‘zgarmadi (allaqachon shunday).`);
    else await ctx.reply(on ? `✅ ${r.name}: endi pul platforma kartalariga tushadi.` : `✅ ${r.name}: endi pul restoranning o‘z kartalariga tushadi.`);
  });
}
