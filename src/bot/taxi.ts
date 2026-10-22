import { Markup, type Context, type Telegraf } from 'telegraf';
import { db } from '../lib/db.js';
import { completeDelivery, respondToTaxi, taxiCompanyForOperator, taxiDispatchDetails } from '../modules/taxi/service.js';
import { looksLikeInviteCode, redeemOperatorInvite } from '../modules/taxi/linking.js';

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: '🕓 Rejalashtirilgan', SENDING: '📨 Yuborilmoqda', REQUESTED: '🆕 Yangi so‘rov — javob kutilmoqda',
  ACCEPTED: '✅ Qabul qilingan — haydovchi yuborilishi kutilmoqda', ASSIGNED: '🚕 Taksi yuborilgan — yetkazish kutilmoqda',
  DELIVERED: '🏁 Yetkazildi', DECLINED: '🚫 Rad etilgan', CANCELLATION_PENDING: '⏳ Javob kechikdi — aniqlashtiring',
  NEEDS_HELP: '⚠️ Aniqlashtirish kerak', CANCELLED: '❌ Bekor qilingan',
};
const ACTIVE = ['REQUESTED', 'ACCEPTED', 'CANCELLATION_PENDING', 'NEEDS_HELP', 'ASSIGNED'] as const;
const ERRORS: Record<string, string> = {
  TAKSI_OPERATOR_RUXSAT_YOQ: 'Ruxsat yo‘q.',
  TAKSI_SOROVI_TOPILMADI: 'So‘rov topilmadi.',
  TAKSI_SOROVI_ESKIRGAN: 'Bu tugma eskirgan.',
  TAKSI_HALI_YUBORILMAGAN: 'Avval „Taksi yuborildi“ni bosing — haydovchi yuborilmagan so‘rov yetkazildi deb belgilanmaydi.',
  BUYURTMA_HALI_TAYYOR_EMAS: 'Taom hali tayyor emas. Restoran „Tayyor“ni belgilagandan keyin tasdiqlang.',
  BUYURTMA_BEKOR_QILINGAN: 'Buyurtma bekor qilingan, yetkazishni tasdiqlab bo‘lmaydi.',
  QAYTARISH_JARAYONIDA: 'Bu buyurtma bo‘yicha pulni qaytarish jarayoni bor, yetkazishni tasdiqlab bo‘lmaydi.',
  TOLOV_TASDIQLANMAGAN: 'Buyurtma to‘lovi restoran tomonidan tasdiqlanmagan.',
  BUYURTMA_YETKAZISH_UCHUN_FAOL_EMAS: 'Buyurtma yetkazish uchun faol emas.',
};
const explain = (err: unknown) => (err instanceof Error ? ERRORS[err.message] ?? err.message : 'noma’lum xato');

function actionsFor(status: string, id: string) {
  const b = Markup.button.callback;
  if (status === 'REQUESTED') return [[b('✅ Qabul qilish', `taxi:acc:${id}`)], [b('🚫 Rad etish', `taxi:none:${id}`)]];
  if (status === 'ACCEPTED') return [[b('🚕 Taksi yuborildi', `taxi:sent:${id}`)], [b('🚫 Taksi yo‘q', `taxi:none:${id}`)]];
  if (status === 'CANCELLATION_PENDING' || status === 'NEEDS_HELP') {
    return [[b('🚕 Haydovchi yuborilgan', `taxi:sent:${id}`)], [b('🚫 Taksi yo‘q / yuborilmadi', `taxi:none:${id}`)]];
  }
  if (status === 'ASSIGNED') return [[b('🏁 Yetkazildi', `taxi:dlv:${id}`)], [b('🔄 Yangilash', `taxi:view:${id}`)]];
  return [[b('🔄 Yangilash', `taxi:view:${id}`)]];
}

/** Handlers for taxi operators: /taxi and the taxi:* buttons. Registered on the dedicated taxi bot (TAXI_BOT_TOKEN), or
 *  on the customer bot when no dedicated bot is configured. Every action is authorized by the operator's Telegram id
 *  against the dispatch's own company, so one bot serves any number of companies without crossing them. */
export function registerTaxiHandlers<C extends Context>(bot: Telegraf<C>): void {
  bot.command('taxi', async ctx => {
    if (!ctx.from || ctx.chat?.type !== 'private') return;
    const company = await taxiCompanyForOperator(String(ctx.from.id));
    if (!company) {
      await ctx.reply('🚫 Taksi operatori sifatida ulanmagansiz. Administrator bergan ulanish kodini yuboring: /link KOD');
      return;
    }
    const rows = await db.taxiDispatch.findMany({
      where: { taxiCompanyId: company.id, status: { in: [...ACTIVE] } },
      orderBy: [{ createdAt: 'desc' }], take: 12,
      include: { order: { select: { number: true } } },
    });
    if (!rows.length) {
      await ctx.reply(`🚕 ${company.name}: hozir faol taksi so‘rovlari yo‘q.`);
      return;
    }
    await ctx.reply(`🚕 ${company.name} — so‘rovlar:`, Markup.inlineKeyboard(rows.map(d => [
      Markup.button.callback(`#${d.order.number} • ${STATUS_LABEL[d.status] ?? d.status}`, `taxi:view:${d.id}`),
    ])));
  });

  bot.action(/^taxi:(view|acc|sent|none|dlv|dlvok):([a-zA-Z0-9_-]+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (!ctx.from || ctx.chat?.type !== 'private') return;
    const actor = String(ctx.from.id);
    const verb = ctx.match[1]!;
    const dispatchId = ctx.match[2]!;
    const row = await taxiDispatchDetails(actor, dispatchId);
    if (!row) { await ctx.reply('⛔ Ruxsat yo‘q yoki so‘rov topilmadi.'); return; }
    const n = row.order.number;
    if (verb === 'view') {
      await ctx.reply(`🚕 #${n}\nKompaniya: ${row.taxiCompany.name}\nHolat: ${STATUS_LABEL[row.status] ?? row.status}\n` +
        `Restoran: ${row.order.restaurant.name}\nOlib ketish: ${row.order.restaurant.pickupAddress ?? 'TEST: manzil hali sozlanmagan'}\n` +
        (row.order.restaurant.pickupPhone ? `Restoran telefoni: ${row.order.restaurant.pickupPhone}\n` : '') +
        `Yetkazish: ${row.order.addressText}\nMijoz telefoni: ${row.order.phoneSnapshot ?? 'mavjud emas'}\n` +
        `Taom: ${row.order.status === 'READY' ? 'TAYYOR' : row.order.status === 'PREPARING' ? 'tayyorlanmoqda' : row.order.status}` +
        (row.order.prepMinutes ? ` (tayyorlash ${row.order.prepMinutes} daq.)` : ''),
        Markup.inlineKeyboard(actionsFor(row.status, row.id)));
      return;
    }
    if (verb === 'dlv') {
      if (row.status !== 'ASSIGNED') {
        await ctx.reply(row.status === 'DELIVERED' ? `✅ #${n}: allaqachon yetkazilgan deb tasdiqlangan.` : `⚠️ #${n}: ${ERRORS.TAKSI_HALI_YUBORILMAGAN}`);
        return;
      }
      await ctx.reply(`⚠️ #${n}: buyurtma mijozga haqiqatan topshirildimi?\nTasdiqlasangiz buyurtma yakunlangan hisoblanadi va qaytarib bo‘lmaydi.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Ha, yetkazildi', `taxi:dlvok:${row.id}`)],
          [Markup.button.callback('↩️ Yo‘q, ortga', `taxi:view:${row.id}`)],
        ]));
      return;
    }
    try {
      if (verb === 'dlvok') {
        const r = await completeDelivery({ actorTelegramId: actor, dispatchId });
        await ctx.reply(r.changed ? `🏁 #${n}: yetkazish tasdiqlandi. Rahmat!` : `✅ #${n}: bu yetkazish avval tasdiqlangan.`);
        return;
      }
      const result = await respondToTaxi({ actorTelegramId: actor, dispatchId,
        action: verb === 'acc' ? 'ACCEPT' : verb === 'sent' ? 'SENT' : 'NO_TAXI' });
      if (!result.changed) {
        await ctx.reply('Bu tugma eskirgan yoki amal allaqachon bajarilgan. /taxi orqali yangilang.');
      } else if (result.finalStatus === 'ACCEPTED') {
        await ctx.reply(`✅ #${n}: buyurtma qabul qilindi. Haydovchi yuborilgach „Taksi yuborildi“ni bosing.`,
          Markup.inlineKeyboard(actionsFor('ACCEPTED', row.id)));
      } else if (result.finalStatus === 'ASSIGNED') {
        await ctx.reply(`✅ #${n}: haydovchi yuborilgani qayd etildi. Buyurtma topshirilgach „Yetkazildi“ni bosing.`,
          Markup.inlineKeyboard(actionsFor('ASSIGNED', row.id)));
      } else if (result.fallbackCompany) {
        await ctx.reply(`✅ #${n}: taksi yo‘q deb qayd etildi. Mijoz roziligi asosida ${result.fallbackCompany} operatoriga murojaat qilinadi.`);
      } else {
        await ctx.reply(`✅ #${n}: taksi yo‘q deb qayd etildi. Boshqa operator avtomatik chaqirilmaydi.`);
      }
    } catch (err) {
      await ctx.reply(`⚠️ Amal bajarilmadi: ${explain(err)} /taxi orqali yangilang.`);
    }
  });
}

/** Secure operator registration for the dedicated taxi bot: a one-time code issued by an administrator
 *  (`npm run taxi:invite`) links this Telegram account to ONE existing company. */
export function registerTaxiLinkHandlers(bot: Telegraf<Context>): void {
  const linkWith = async (ctx: Context, code: string) => {
    if (!ctx.from) return;
    const r = await redeemOperatorInvite(String(ctx.from.id), code);
    if (r.result === 'LINKED') await ctx.reply(`✅ Ulandi: ${r.companyName}.\nEndi buyurtma so‘rovlari shu yerga keladi. Faol so‘rovlar: /taxi`);
    else if (r.result === 'ALREADY_LINKED_ELSEWHERE') await ctx.reply('⛔ Bu Telegram akkaunt boshqa taksi kompaniyasiga ulangan.');
    else if (r.result === 'RATE_LIMITED') await ctx.reply('⏳ Juda ko‘p noto‘g‘ri urinish. 15 daqiqadan keyin qayta urinib ko‘ring.');
    else await ctx.reply('⛔ Kod noto‘g‘ri, muddati o‘tgan yoki ishlatilgan. Administratordan yangi kod so‘rang.');
  };
  const help = 'Bu DS Delivery taksi operatorlari uchun bot.\nUlanish: administrator bergan kodni yuboring — /link XXXXX-XXXXX\nFaol so‘rovlar: /taxi';

  bot.start(async ctx => {
    if (!ctx.from) return;
    const payload = ctx.payload?.trim();
    if (payload) { await linkWith(ctx, payload); return; }
    const company = await taxiCompanyForOperator(String(ctx.from.id));
    await ctx.reply(company ? `🚕 ${company.name} operatori sifatida ulangansiz.\nFaol so‘rovlar: /taxi` : help);
  });
  bot.command('link', async ctx => {
    const code = ctx.message.text.split(/\s+/).slice(1).join(' ');
    if (!code) { await ctx.reply(help); return; }
    await linkWith(ctx, code);
  });
  bot.command('myid', async ctx => { if (ctx.from) await ctx.reply(`Telegram ID: ${ctx.from.id}`); });
  bot.command('help', async ctx => { await ctx.reply(help); });
  // A bare code (typed or pasted) from an unlinked account is also accepted. Anything else is ignored.
  bot.on('text', async ctx => {
    if (ctx.message.text.startsWith('/') || !ctx.from) return;
    if (looksLikeInviteCode(ctx.message.text.trim())) { await linkWith(ctx, ctx.message.text.trim()); return; }
    if (!(await taxiCompanyForOperator(String(ctx.from.id)))) await ctx.reply(help);
  });
}
