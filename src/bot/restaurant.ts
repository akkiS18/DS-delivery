import { Markup, type Context, type Telegraf } from 'telegraf';
import { db } from '../lib/db.js';
import { findAssignedRestaurant, staffOrderDetails, takeStaffAction } from '../modules/restaurant/service.js';
import { PREP_CHOICES } from '../modules/restaurant/workflow.js';

const format = new Intl.NumberFormat('uz-UZ');
const som = (value: number): string => `${format.format(value)} so‘m`;
const labels: Record<string, string> = {
  PAYMENT_MATCHED_UNVERIFIED: '🔎 Kirim xabari mos, BANK TASDIG‘I EMAS',
  PAYMENT_CONFIRMED: '✅ Restoran bank kirimini tekshirdi',
  PREPARING: '👨‍🍳 Tayyorlanmoqda',
  READY: '🍽 Taom tayyor',
};

function orderButtons(status: string, orderId: string, isTest: boolean) {
  if (status === 'PAYMENT_MATCHED_UNVERIFIED') {
    return Markup.inlineKeyboard([
      [Markup.button.callback(isTest ? '🧪 MOCK kirimni tasdiqlash' : '💳 Bankdagi kirimni tekshirdim', `staff:verifyask:${orderId}`)],
      [Markup.button.callback('🔄 Buyurtmani yangilash', `staff:view:${orderId}`)],
    ]);
  }
  if (status === 'PAYMENT_CONFIRMED') {
    return Markup.inlineKeyboard([
      PREP_CHOICES.slice(0, 3).map(n => Markup.button.callback(`${n} daq`, `staff:prep${n}:${orderId}`)),
      PREP_CHOICES.slice(3).map(n => Markup.button.callback(`${n} daq`, `staff:prep${n}:${orderId}`)),
      [Markup.button.callback('🔄 Yangilash', `staff:view:${orderId}`)],
    ]);
  }
  if (status === 'PREPARING') {
    return Markup.inlineKeyboard([
      [Markup.button.callback('✅ Taom tayyor', `staff:ready:${orderId}`)],
      [Markup.button.callback('🔄 Yangilash', `staff:view:${orderId}`)],
    ]);
  }
  return Markup.inlineKeyboard([[Markup.button.callback('🔄 Yangilash', `staff:view:${orderId}`)]]);
}

export async function staffOrderPresentation(telegramUserId: string, orderId: string) {
  const order = await staffOrderDetails(telegramUserId, orderId);
  if (!order) return null;
  const text = [
    `🍽 Restoran buyurtmasi #${order.number}`,
    `Holat: ${labels[order.status] ?? order.status}`,
    `To‘lov: ${order.payment?.status ?? 'YO‘Q'}`,
    `Karta: ***${order.payment?.card?.last4 ?? '????'}`,
    order.payment?.isTest ? '🧪 FAQAT MOCK SINOV, real pul emas' : '⚠️ Kirimni bank hisobidan mustaqil tekshiring',
    '',
    ...order.items.map(x => `• ${x.name}: ${x.quantity} ta — ${som(x.subtotalSom)}`),
    `Jami: ${som(order.totalSom)}`,
    `Telefon: ${order.phoneSnapshot ?? 'kiritilmagan'}`,
    `Manzil: ${order.addressText}`,
    `Taksi: ${order.taxiCompany?.name ?? 'belgilanmagan'}`,
    ...(order.prepMinutes ? [`Tayyorlash vaqti: ${order.prepMinutes} daqiqa`] : []),
  ].join('\n');
  return { text, markup: orderButtons(order.status, order.id, Boolean(order.payment?.isTest)) };
}

export function registerRestaurantHandlers<C extends Context>(bot: Telegraf<C>): void {
  bot.command('myid', async ctx => {
    if (ctx.chat?.type !== 'private' || !ctx.from) return;
    await ctx.reply(`Telegram ID: ${ctx.from.id}\nRestoran akkauntini bog‘lash uchun shu ID'ni lokal admin komandada ishlating.`);
  });

  bot.command('staff', async ctx => {
    if (ctx.chat?.type !== 'private' || !ctx.from) return;
    const restaurant = await findAssignedRestaurant(String(ctx.from.id));
    if (!restaurant) {
      await ctx.reply('Siz hech bir restoranning vakolatli mas’uli sifatida biriktirilmagansiz. /myid orqali Telegram ID’ingizni ko‘ring.');
      return;
    }
    const orders = await db.order.findMany({
      where: {
        restaurantId: restaurant.id,
        createdViaBot: true,
        status: { in: ['PAYMENT_MATCHED_UNVERIFIED', 'PAYMENT_CONFIRMED', 'PREPARING', 'READY'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: 12,
      select: { id: true, number: true, totalSom: true, status: true },
    });
    if (!orders.length) {
      await ctx.reply(`🏪 ${restaurant.name}\nHozircha qayta ishlanadigan buyurtmalar yo‘q.`);
      return;
    }
    await ctx.reply(`🏪 ${restaurant.name}\nBuyurtmalar:`, Markup.inlineKeyboard(orders.map(x => [
      Markup.button.callback(`#${x.number} • ${som(x.totalSom)} • ${x.status}`, `staff:view:${x.id}`),
    ])));
  });

  bot.action(/^staff:(view|verifyask|verify|prep(?:10|15|20|30|45|60)|ready):([a-zA-Z0-9_-]+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (ctx.chat?.type !== 'private' || !ctx.from) return;
    const userId = String(ctx.from.id);
    const action = ctx.match[1]!;
    const orderId = ctx.match[2]!;
    if (!(await staffOrderDetails(userId, orderId))) {
      await ctx.reply('⛔ Ruxsat yo‘q yoki buyurtma boshqa restoranga tegishli.');
      return;
    }
    if (action === 'verifyask') {
      const order = await staffOrderDetails(userId, orderId);
      if (order?.status !== 'PAYMENT_MATCHED_UNVERIFIED') {
        await ctx.reply('Bu to‘lov allaqachon boshqa holatga o‘tgan. /staff orqali tekshiring.');
        return;
      }
      const mock = Boolean(order.payment?.isTest);
      await ctx.reply(mock
        ? `🧪 SINOV #${order.number}: MOCK kirimni tasdiqlaysizmi? Haqiqiy pul emas.`
        : `⚠️ #${order.number}: e-maildagi moslik YETARLI EMAS. Restoranning haqiqiy bank hisobiga ${som(order.totalSom)} kelganini alohida tekshirgan bo‘lsangizgina tasdiqlang.`,
        Markup.inlineKeyboard([
          [Markup.button.callback(mock ? '✅ MOCK tasdiqlash' : '✅ Bank kirimi tekshirildi', `staff:verify:${order.id}`)],
          [Markup.button.callback('↩️ Ortga', `staff:view:${order.id}`)],
        ]));
      return;
    }
    if (action === 'verify' || action.startsWith('prep') || action === 'ready') {
      try {
        const result = await takeStaffAction({
          actorTelegramId: userId,
          orderId,
          action: action === 'verify' ? 'VERIFY_PAYMENT' : action === 'ready' ? 'MARK_READY' : 'START_PREPARING',
          ...(action.startsWith('prep') ? { prepMinutes: Number(action.slice(4)) } : {}),
        });
        if (!result.changed) await ctx.reply('Amal avval bajarilgan yoki buyurtma holati o‘zgargan.');
      } catch (error) {
        await ctx.reply(`Amal bajarilmadi: ${error instanceof Error ? error.message : 'Noma’lum xato'}. /staff bilan holatni yangilang.`);
      }
    }
    const presentation = await staffOrderPresentation(userId, orderId);
    if (presentation) await ctx.reply(presentation.text, presentation.markup);
  });
}
