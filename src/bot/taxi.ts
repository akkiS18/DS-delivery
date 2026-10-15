import { Markup, type Context, type Telegraf } from 'telegraf';
import { db } from '../lib/db.js';
import { respondToTaxi, taxiCompanyForOperator, taxiDispatchDetails } from '../modules/taxi/service.js';

export function registerTaxiHandlers<C extends Context>(bot: Telegraf<C>): void {
  bot.command('taxi', async ctx => {
    if (!ctx.from || ctx.chat?.type !== 'private') return;
    const operatorId = String(ctx.from.id);
    const company = await taxiCompanyForOperator(operatorId);
    if (!company) {
      await ctx.reply('🚫 Taksi operatori sifatida ro‘yxatdan o‘tmagansiz. /myid orqali Telegram ID olish mumkin.');
      return;
    }
    const rows = await db.taxiDispatch.findMany({
      where: { taxiCompanyId: company.id, status: { in: ['REQUESTED', 'CANCELLATION_PENDING', 'NEEDS_HELP', 'ASSIGNED'] } },
      orderBy: [{ createdAt: 'desc' }], take: 12,
      include: { order: { select: { number: true } } },
    });
    if (!rows.length) {
      await ctx.reply(`🚕 ${company.name}: hozir faol taksi so‘rovlari yo‘q.`);
      return;
    }
    await ctx.reply(`🚕 ${company.name} — so‘rovlar:`, Markup.inlineKeyboard(rows.map(d => [
      Markup.button.callback(`#${d.order.number} • ${d.status}`, `taxi:view:${d.id}`),
    ])));
  });

  bot.action(/^taxi:(view|sent|none):([a-zA-Z0-9_-]+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (!ctx.from || ctx.chat?.type !== 'private') return;
    const actor = String(ctx.from.id);
    const verb = ctx.match[1]!;
    const dispatchId = ctx.match[2]!;
    const row = await taxiDispatchDetails(actor, dispatchId);
    if (!row) { await ctx.reply('⛔ Ruxsat yo‘q yoki so‘rov topilmadi.'); return; }
    if (verb === 'view') {
      await ctx.reply(`🚕 #${row.order.number}\nKompaniya: ${row.taxiCompany.name}\n` +
        `Holat: ${row.status}\nRestoran: ${row.order.restaurant.name}\n` +
        `Olib ketish: ${row.order.restaurant.pickupAddress ?? 'TEST: manzil hali sozlanmagan'}\n` +
        `Yetkazish: ${row.order.addressText}\nTelefon: ${row.order.phoneSnapshot ?? 'mavjud emas'}\n` +
        `Taom: ${row.order.status}`,
        Markup.inlineKeyboard(
          ['REQUESTED', 'CANCELLATION_PENDING', 'NEEDS_HELP'].includes(row.status) ? [
            [Markup.button.callback('🚕 Taksi yuborildi', `taxi:sent:${row.id}`)],
            [Markup.button.callback('🚫 Taksi yo‘q / yuborilmadi', `taxi:none:${row.id}`)],
          ] : [[Markup.button.callback('🔄 Yangilash', `taxi:view:${row.id}`)]]));
      return;
    }
    try {
      const result = await respondToTaxi({ actorTelegramId: actor, dispatchId,
        action: verb === 'sent' ? 'SENT' : 'NO_TAXI' });
      if (!result.changed) {
        await ctx.reply('Bu tugma eskirgan yoki amal allaqachon bajarilgan. /taxi orqali yangilang.');
      } else if (result.finalStatus === 'ASSIGNED') {
        await ctx.reply(`✅ #${row.order.number}: haydovchi yuborilgani qayd etildi. Boshqa taksi chaqirilmaydi.`);
      } else if (result.fallbackCompany) {
        await ctx.reply(`✅ #${row.order.number}: taksi yo‘q deb qayd etildi. Mijoz roziligi asosida ${result.fallbackCompany} operatoriga murojaat qilinadi.`);
      } else {
        await ctx.reply(`✅ #${row.order.number}: taksi yo‘q deb qayd etildi. Boshqa operator avtomatik chaqirilmaydi.`);
      }
    } catch (err) {
      await ctx.reply(`⚠️ Amal bajarilmadi: ${err instanceof Error ? err.message : 'noma’lum xato'}. /taxi orqali yangilang.`);
    }
  });
}
