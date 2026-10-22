import { Markup, type Context, type Telegraf } from 'telegraf';
import { db } from '../lib/db.js';
import { isSupportAdmin } from '../modules/support/service.js';
import { reassignableCompanies } from '../modules/taxi/assignment.js';
import { adminRecoverDispatch, dispatchHistory, RECOVERABLE, recoverableDispatches, type RecoveryAction } from '../modules/taxi/recovery.js';

const LABEL: Record<string, string> = {
  SCHEDULED: 'rejalashtirilgan', REQUESTED: 'javob kutilmoqda', ACCEPTED: 'qabul qilingan', ASSIGNED: 'haydovchi yuborilgan',
  DELIVERED: 'yetkazilgan', DECLINED: 'rad etilgan', NEEDS_HELP: 'yordam kerak', CANCELLATION_PENDING: 'javob kechikdi', CANCELLED: 'bekor qilingan (tarix)',
};
const ERR: Record<string, string> = {
  ADMIN_RUXSAT_YOQ: 'Ruxsat yo‘q.', ADMIN_IZOH_NOTOGRI: 'Izoh 10–300 belgi bo‘lsin.',
  TAKSI_KOMPANIYASI_YOQ: 'Mos faol kompaniya topilmadi (operator ulangan va faol bo‘lishi kerak).',
};

/** Armed free-text input (in memory, 10 min): the administrator's attestation note. */
const pending = new Map<string, { dispatchId: string; action: RecoveryAction; companyId?: string; expires: number }>();
const TTL = 10 * 60_000;

/**
 * Platform-administrator recovery screen inside the taxi bot (/taxiadmin). Only Telegram ids listed in SUPPORT_ADMIN_*_TELEGRAM_ID
 * can use it. Retrying or reassigning requires the administrator to state in writing that NO driver was dispatched for the
 * previous attempt; if one was, "Haydovchi yuborilgan" records it instead of creating a second booking.
 */
export function registerTaxiAdminHandlers<C extends Context>(bot: Telegraf<C>): void {
  const admin = (ctx: Context): string | null => {
    if (!ctx.from || ctx.chat?.type !== 'private') return null;
    try { return isSupportAdmin(String(ctx.from.id)) ? String(ctx.from.id) : null; } catch { return null; }
  };

  bot.command('taxiadmin', async ctx => {
    if (!admin(ctx)) return; // silent for everyone else: operators and customers do not learn that the command exists
    const rows = await recoverableDispatches();
    if (!rows.length) { await ctx.reply('✅ Hal qilinishi kerak bo‘lgan taksi buyurtmasi yo‘q.'); return; }
    await ctx.reply('🛠 Taksi muammolari:', Markup.inlineKeyboard(rows.map(r => [
      Markup.button.callback(`#${r.order.number} • ${r.taxiCompany.name} • ${LABEL[r.status] ?? r.status}`, `tadm:view:${r.id}`),
    ])));
  });

  bot.action(/^tadm:(view|pick):([a-zA-Z0-9_-]+)$/, async ctx => {
    await ctx.answerCbQuery().catch(() => undefined);
    if (!admin(ctx)) return;
    const id = ctx.match[2]!;
    const d = await db.taxiDispatch.findUnique({
      where: { id }, include: { taxiCompany: { select: { name: true } }, order: { select: { number: true, status: true, addressText: true, restaurant: { select: { name: true } } } } },
    });
    if (!d) { await ctx.reply('Topilmadi.'); return; }
    if (ctx.match[1] === 'pick') {
      const companies = await reassignableCompanies(db);
      await ctx.reply('Qaysi kompaniyaga o‘tkazamiz?', Markup.inlineKeyboard([
        ...companies.map(c => [Markup.button.callback(c.name.slice(0, 50), `tadm:to:${id}:${c.id}`)]),
        [Markup.button.callback('↩️ Ortga', `tadm:view:${id}`)],
      ]));
      return;
    }
    const history = await dispatchHistory(d.orderId);
    const open = (RECOVERABLE as readonly string[]).includes(d.status) && !history.some(h => h.attemptNo > d.attemptNo);
    await ctx.reply([
      `🚕 #${d.order.number} • ${d.order.restaurant.name}`, `Manzil: ${d.order.addressText}`, `Buyurtma: ${d.order.status}`,
      `Joriy urinish #${d.attemptNo}: ${d.taxiCompany.name} — ${LABEL[d.status] ?? d.status}`, '', 'Tarix:',
      ...history.map(h => `  ${h.attemptNo}. ${h.taxiCompany.name} — ${LABEL[h.status] ?? h.status}`),
      '', open ? '⚠️ Qayta yuborishdan oldin haydovchi YUBORILMAGANINI operator bilan aniqlang. Yuborilgan bo‘lsa, „Haydovchi yuborilgan“ni bosing.' : 'Holat o‘zgargan — qo‘lda amal kerak emas.',
    ].join('\n'), Markup.inlineKeyboard(open ? [
      [Markup.button.callback('🔁 Shu kompaniyaga qayta yuborish', `tadm:go:retry:${id}`)],
      [Markup.button.callback('🔀 Boshqa kompaniyaga o‘tkazish', `tadm:pick:${id}`)],
      [Markup.button.callback('🚕 Haydovchi allaqachon yuborilgan', `tadm:go:sent:${id}`)],
    ] : [[Markup.button.callback('🔄 Yangilash', `tadm:view:${id}`)]]));
  });

  bot.action(/^tadm:(?:go:(retry|sent)|(to)):([a-zA-Z0-9_-]+)(?::([a-zA-Z0-9_-]+))?$/, async ctx => {
    await ctx.answerCbQuery().catch(() => undefined);
    const adminId = admin(ctx);
    if (!adminId) return;
    const action: RecoveryAction = ctx.match[2] === 'to' ? 'REASSIGN' : ctx.match[1] === 'sent' ? 'DRIVER_SENT' : 'RETRY_SAME';
    pending.set(adminId, { dispatchId: ctx.match[3]!, action, ...(ctx.match[4] ? { companyId: ctx.match[4] } : {}), expires: Date.now() + TTL });
    await ctx.reply(action === 'DRIVER_SENT'
      ? 'Izoh yozing (10+ belgi): haydovchi qaysi kompaniya/operator orqali yuborilganini ko‘rsating. Bekor qilish: /cancel'
      : 'Izoh yozing (10+ belgi): operator bilan gaplashib, bu urinish uchun haydovchi YUBORILMAGANINI tasdiqlang. Bekor qilish: /cancel');
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
    if (wait.expires < Date.now()) { pending.delete(id); await ctx.reply('Vaqt tugadi. Qaytadan boshlang: /taxiadmin'); return; }
    try {
      const r = await adminRecoverDispatch({ adminTelegramId: id, dispatchId: wait.dispatchId, action: wait.action, ...(wait.companyId ? { companyId: wait.companyId } : {}), note: text });
      pending.delete(id);
      if (r.result === 'DONE') {
        await ctx.reply(r.action === 'DRIVER_SENT' ? '✅ Haydovchi yuborilgani qayd etildi. Yetkazishni shu kompaniya operatori tasdiqlaydi.'
          : `✅ Yangi so‘rov ${r.companyName} operatoriga navbatga qo‘yildi (bir necha soniyada yuboriladi). Oldingi urinish tarixda saqlandi.`);
      } else await ctx.reply('ℹ️ Holat allaqachon o‘zgargan yoki topilmadi. /taxiadmin orqali yangilang.');
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'ADMIN_IZOH_NOTOGRI') { await ctx.reply(`${ERR[code]} Qayta yozing (yoki /cancel).`); return; }
      pending.delete(id);
      await ctx.reply(`⚠️ Bajarilmadi: ${ERR[code] ?? 'xatolik'}`);
    }
  });
}
