import { Markup, type Telegraf } from 'telegraf';
import { db } from '../../lib/db.js';
import { needsCancellationAcknowledgement } from './workflow.js';

const responseSeconds = Number(process.env.TAXI_OPERATOR_RESPONSE_SECONDS ?? 180);
const pollSeconds = Number(process.env.TAXI_WORKER_INTERVAL_SECONDS ?? 5);
const alertTelegramId = process.env.TAXI_ALERT_TELEGRAM_ID?.trim();
if (![responseSeconds, pollSeconds].every(v => Number.isSafeInteger(v) && v >= 2 && v <= 3600)) {
  throw new Error('TAXI_OPERATOR_RESPONSE_SECONDS / TAXI_WORKER_INTERVAL_SECONDS noto‘g‘ri');
}
const callback = (verb: string, id: string) => `taxi:${verb}:${id}`;
const currency = new Intl.NumberFormat('uz-UZ');

type Bot = Telegraf<any>;

function requestKeyboard(dispatchId: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🚕 Taksi yuborildi', callback('sent', dispatchId))],
    [Markup.button.callback('🚫 Taksi yo‘q', callback('none', dispatchId))],
  ]);
}
function cancelKeyboard(dispatchId: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Haydovchi yuborilmadi', callback('none', dispatchId))],
    [Markup.button.callback('🚕 Haydovchi allaqachon yuborilgan', callback('sent', dispatchId))],
  ]);
}

async function reportAlert(bot: Bot, text: string): Promise<void> {
  console.error(`[TAXI ALERT] ${text}`);
  if (!alertTelegramId || !/^\d{1,20}$/.test(alertTelegramId)) return;
  try { await bot.telegram.sendMessage(alertTelegramId, `⚠️ DS Delivery taxi: ${text}`); }
  catch (err) { console.error('[TAXI ADMIN ALERT] ', err instanceof Error ? err.message : err); }
}

async function dispatchDue(bot: Bot, onlyOrderId?: string): Promise<void> {
  const now = new Date();
  // Recover an interrupted send. Telegram may receive duplicate messages, but callback IDs are idempotent.
  await db.taxiDispatch.updateMany({
    where: { status: 'SENDING', leaseAt: { lt: new Date(now.getTime() - 60_000) }, ...(onlyOrderId ? { orderId: onlyOrderId } : {}) },
    data: { status: 'SCHEDULED', leaseAt: null, dueAt: now },
  });
  const due = await db.taxiDispatch.findMany({
    where: { status: 'SCHEDULED', dueAt: { lte: now }, ...(onlyOrderId ? { orderId: onlyOrderId } : {}) },
    orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
    take: 20,
    include: {
      taxiCompany: true,
      order: { include: {
        restaurant: { select: { name: true, pickupAddress: true, pickupPhone: true } },
        payment: { select: { isTest: true, status: true } },
      } },
    },
  });
  for (const item of due) {
    const claimed = await db.taxiDispatch.updateMany({
      where: { id: item.id, status: 'SCHEDULED' },
      data: { status: 'SENDING', leaseAt: new Date() },
    });
    if (!claimed.count) continue;
    const operator = item.taxiCompany.operatorTelegramUserId;
    const validOrder = item.order.createdViaBot && ['PREPARING', 'READY'].includes(item.order.status)
      && item.order.payment?.status === 'CONFIRMED_MANUAL';
    const pickupSet = Boolean(item.order.restaurant.pickupAddress?.trim());
    if (!validOrder || !item.taxiCompany.isActive || !operator || (!item.order.payment?.isTest && !pickupSet)) {
      await db.taxiDispatch.updateMany({ where: { id: item.id, status: 'SENDING' }, data: { status: 'NEEDS_HELP', leaseAt: null } });
      await reportAlert(bot, `#${item.order.number}: taksi jo‘natilmadi (operator biriktirilmagan, restoran pickup manzili yo‘q yoki buyurtma faol emas).`);
      continue;
    }
    const pickup = item.order.restaurant.pickupAddress?.trim() || 'TEST: olib ketish manzili kiritilmagan';
    const loc = item.order.deliveryLat !== null && item.order.deliveryLng !== null
      ? `\nGPS: ${item.order.deliveryLat}, ${item.order.deliveryLng}` : '';
    const message = [
      item.order.payment?.isTest ? '🧪 MOCK SINOV — haqiqiy haydovchi yubormang!' : '🚕 DS Delivery: yangi yetkazish so‘rovi',
      `Buyurtma: #${item.order.number}`,
      `Taksi xizmati: ${item.taxiCompany.name}`,
      `Restoran: ${item.order.restaurant.name}`,
      `Olib ketish: ${pickup}`,
      ...(item.order.restaurant.pickupPhone ? [`Restoran telefoni: ${item.order.restaurant.pickupPhone}`] : []),
      `Yetkazish manzili: ${item.order.addressText}${loc}`,
      `Mijoz telefoni: ${item.order.phoneSnapshot ?? 'kiritilmagan'}`,
      `Ovqat: ${item.order.status === 'READY' ? 'TAYYOR' : 'Tayyorlanmoqda'}`,
      `Ovqat qiymati: ${currency.format(item.order.totalSom)} so‘m (taksi haqi emas)`,
      'Yetkazish narxini sizning taksi xizmatingiz belgilaydi.',
      `Javob muddati: ${responseSeconds} soniya. Javob bo‘lmasa avtomatik boshqa taksi chaqirilmaydi.`,
    ].join('\n');
    try {
      const response = await bot.telegram.sendMessage(operator, message, requestKeyboard(item.id));
      await db.taxiDispatch.updateMany({
        where: { id: item.id, status: 'SENDING' },
        data: { status: 'REQUESTED', sentAt: new Date(), expiresAt: new Date(Date.now() + responseSeconds * 1000),
          telegramMessageId: response.message_id, leaseAt: null, sendTries: { increment: 1 } },
      });
    } catch (err) {
      const attempt = item.sendTries + 1;
      await db.taxiDispatch.updateMany({
        where: { id: item.id, status: 'SENDING' },
        data: attempt < 3 ? {
          status: 'SCHEDULED', dueAt: new Date(Date.now() + 30_000), leaseAt: null,
          sendTries: { increment: 1 },
        } : { status: 'NEEDS_HELP', leaseAt: null, sendTries: { increment: 1 } },
      });
      console.error(`[TAXI REQUEST] #${item.order.number}:`, err instanceof Error ? err.message : err);
      if (attempt >= 3) await reportAlert(bot, `#${item.order.number}: Telegram operatoriga 3 marta yuborib bo‘lmadi.`);
    }
  }
}

async function enforceTimeout(bot: Bot, onlyOrderId?: string): Promise<void> {
  const now = new Date();
  const pending = await db.taxiDispatch.findMany({
    where: { status: 'REQUESTED', expiresAt: { lte: now }, ...(onlyOrderId ? { orderId: onlyOrderId } : {}) },
    take: 30, include: { order: { select: { number: true } } },
  });
  for (const dispatch of pending) {
    if (!needsCancellationAcknowledgement(dispatch.status, dispatch.expiresAt, now)) continue;
    const changed = await db.taxiDispatch.updateMany({
      where: { id: dispatch.id, status: 'REQUESTED' }, data: { status: 'CANCELLATION_PENDING' },
    });
    if (changed.count) await reportAlert(bot, `#${dispatch.order.number}: operator javob bermadi. Haydovchi yuborilmaganini tasdiqlamaguncha boshqa taksiga o'tilmaydi.`);
  }
  const needsConfirm = await db.taxiDispatch.findMany({
    where: {
      status: 'CANCELLATION_PENDING', cancelNoticeTries: { lt: 3 },
      ...(onlyOrderId ? { orderId: onlyOrderId } : {}),
      OR: [{ cancelNoticeAt: null }, { cancelNoticeAt: { lt: new Date(Date.now() - 90_000) } }],
    }, take: 20,
    include: { taxiCompany: { select: { operatorTelegramUserId: true } }, order: { select: { number: true } } },
  });
  for (const dispatch of needsConfirm) {
    const operator = dispatch.taxiCompany.operatorTelegramUserId;
    if (!operator) continue;
    const claim = await db.taxiDispatch.updateMany({
      where: { id: dispatch.id, status: 'CANCELLATION_PENDING', cancelNoticeTries: dispatch.cancelNoticeTries },
      data: { cancelNoticeAt: new Date(), cancelNoticeTries: { increment: 1 } },
    });
    if (!claim.count) continue;
    try {
      await bot.telegram.sendMessage(operator,
        `⚠️ #${dispatch.order.number}: javob muddati tugadi. Bir xil buyurtmaga ikkita taksi yuborilmasligi uchun aniqlashtiring:\n` +
        'Haydovchi yuborilgan bo‘lsa, buni tasdiqlang. Yuborilmagan bo‘lsa, rad eting; shundagina boshqa taksiga so‘rov ketishi mumkin.',
        cancelKeyboard(dispatch.id));
    } catch (err) {
      console.error('[TAXI TIMEOUT NOTIFICATION]', err instanceof Error ? err.message : err);
    }
  }
}

async function notifyOutcomes(bot: Bot, onlyOrderId?: string): Promise<void> {
  const recent = await db.taxiDispatch.findMany({
    where: { status: { in: ['ASSIGNED', 'DECLINED', 'NEEDS_HELP', 'CANCELLATION_PENDING'] }, ...(onlyOrderId ? { orderId: onlyOrderId } : {}) },
    orderBy: { updatedAt: 'desc' }, take: 80,
    include: { taxiCompany: { select: { name: true } }, order: {
      include: { customer: { select: { telegramUserId: true } }, restaurant: { select: { staffTelegramUserId: true } },
        taxiDispatches: { select: { id: true, attemptNo: true } } },
    } },
  });
  for (const d of recent) {
    const newer = d.order.taxiDispatches.some(x => x.attemptNo > d.attemptNo);
    const label = d.status === 'ASSIGNED'
      ? `🚕 #${d.order.number}: ${d.taxiCompany.name} operatori haydovchi yuborilganini bildirdi. Yetkazish narxi taksi tarifiga ko‘ra.`
      : d.status === 'DECLINED' && newer
      ? `🔄 #${d.order.number}: ${d.taxiCompany.name}da bo‘sh taksi yo‘q. Roziligingiz asosida boshqa kompaniyadan qidiryapmiz.`
      : d.status === 'DECLINED'
      ? `⚠️ #${d.order.number}: taksi topilmadi. DS Delivery bilan bog‘lanib, yetkazishni aniqlashtiring. Buyurtma yetkazildi deb hisoblanmaydi.`
      : d.status === 'NEEDS_HELP'
      ? `⚠️ #${d.order.number}: taksi operatori bilan bog‘lanishda muammo. Yetkazish uchun administrator yordami kerak.`
      : `⏳ #${d.order.number}: taksi operatoridan javob kechikmoqda. Ikkinchi haydovchi yuborilmasligi uchun tekshirilyapti.`;
    for (const [key, chatId] of [
      ['customerNotifiedAt', d.order.customer.telegramUserId],
      ['staffNotifiedAt', d.order.restaurant.staffTelegramUserId],
    ] as const) {
      if (d[key] || !chatId) continue;
      try {
        await bot.telegram.sendMessage(chatId, label);
        await db.taxiDispatch.updateMany({ where: { id: d.id, status: d.status, [key]: null }, data: { [key]: new Date() } });
      } catch (err) {
        console.error(`[TAXI NOTICE] ${d.order.number} ${key}:`, err instanceof Error ? err.message : err);
      }
    }
  }
}

/** DB-backed scheduler. One process for local MVP; CAS prevents duplicate assignment.
 *  Telegram notification is at-least-once; the callback is idempotent.
 */
/** Exposed for an isolated DB smoke test; orderId limits side effects to one test order. */
export async function runTaxiDispatchCycle(bot: Bot, onlyOrderId?: string): Promise<void> {
  await dispatchDue(bot, onlyOrderId);
  await enforceTimeout(bot, onlyOrderId);
  await notifyOutcomes(bot, onlyOrderId);
}

export function startTaxiDispatcher(bot: Bot): () => void {
  let busy = false;
  let stopped = false;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      await runTaxiDispatchCycle(bot);
    } catch (err) {
      console.error('[TAXI DISPATCH WORKER]', err instanceof Error ? err.message : err);
    } finally { busy = false; }
  };
  const timer = setInterval(() => void tick(), pollSeconds * 1000);
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}
