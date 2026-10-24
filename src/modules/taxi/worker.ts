import { Markup, type Telegraf } from 'telegraf';
import { db } from '../../lib/db.js';
import { isDelivered, notificationKey, sendOnce } from '../../lib/notify-once.js';
import { restaurantTelegramEnabled, taxiTelegramEnabled } from '../../lib/features.js';
import { needsCancellationAcknowledgement } from './workflow.js';
import { escalateSilentDispatch } from './recovery.js';
import { supportAdminIds } from '../support/service.js';

const responseSeconds = Number(process.env.TAXI_OPERATOR_RESPONSE_SECONDS ?? 180);
const pollSeconds = Number(process.env.TAXI_WORKER_INTERVAL_SECONDS ?? 5);
const alertTelegramId = process.env.TAXI_ALERT_TELEGRAM_ID?.trim();
if (![responseSeconds, pollSeconds].every(v => Number.isSafeInteger(v) && v >= 2 && v <= 3600)) {
  throw new Error('TAXI_OPERATOR_RESPONSE_SECONDS / TAXI_WORKER_INTERVAL_SECONDS noto‘g‘ri');
}
// Development guard: when set, a request is only ever sent to these Telegram ids (your own test account).
const operatorAllowlist = (process.env.TAXI_OPERATOR_ALLOWLIST ?? '').split(',').map(v => v.trim()).filter(Boolean);
const silenceEscalationSeconds = Number(process.env.TAXI_SILENCE_ESCALATION_SECONDS ?? 300);
// Opt-in only: re-dispatching after silence can double-book if the operator did send a car. Audited when used.
const autoFallbackOnSilence = process.env.TAXI_AUTO_FALLBACK_ON_SILENCE === 'true';
/** The DS Taxi app counts as online when it polled within this window (the app polls every few seconds while its service runs). */
const APP_ONLINE_SECONDS = 90;
const callback = (verb: string, id: string) => `taxi:${verb}:${id}`;
const currency = new Intl.NumberFormat('uz-UZ');

type Bot = Telegraf<any>;

function requestKeyboard(dispatchId: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Qabul qilish', callback('acc', dispatchId))],
    [Markup.button.callback('🚫 Rad etish', callback('none', dispatchId))],
  ]);
}
function cancelKeyboard(dispatchId: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Haydovchi yuborilmadi', callback('none', dispatchId))],
    [Markup.button.callback('🚕 Haydovchi allaqachon yuborilgan', callback('sent', dispatchId))],
  ]);
}

/** Platform administrators who can recover a stuck dispatch: the support admins plus the optional TAXI_ALERT_TELEGRAM_ID. */
function adminRecipients(): string[] {
  let admins: string[] = [];
  try { admins = supportAdminIds(); } catch { admins = []; }
  if (alertTelegramId && /^\d{1,20}$/.test(alertTelegramId)) admins.push(alertTelegramId);
  return [...new Set(admins)];
}

/** One alert per (dispatch state, administrator); delivered through the taxi bot with a button into the recovery screen. */
async function reportAlert(bot: Bot, text: string, key: string, orderId: string, dispatchId: string): Promise<boolean> {
  console.error(`[TAXI ALERT] ${text}`);
  const recipients = adminRecipients();
  if (!recipients.length) return false;
  let delivered = false;
  for (const chatId of recipients) {
    const outcome = await sendOnce(bot, {
      key: notificationKey('taxi-alert', key, chatId), kind: 'taxi-alert', chatId, orderId, text: `⚠️ DS Delivery taksi: ${text}`,
      extra: Markup.inlineKeyboard([[Markup.button.callback('🛠 Ko‘rish va hal qilish', `tadm:view:${dispatchId}`)]]),
    });
    if (outcome === 'FAILED') console.error('[TAXI ADMIN ALERT] delivery failed, will retry');
    if (isDelivered(outcome)) delivered = true;
  }
  return delivered;
}

async function dispatchDue(bot: Bot, onlyOrderId?: string): Promise<void> {
  // `bot` here is the operator-facing bot (dedicated taxi bot when configured).
  const now = new Date();
  // An interrupted send may already have reached the operator. Never resend it automatically.
  await db.taxiDispatch.updateMany({
    where: { status: 'SENDING', leaseAt: { lt: new Date(now.getTime() - 60_000) }, ...(onlyOrderId ? { orderId: onlyOrderId } : {}) },
    data: { status: 'NEEDS_HELP', leaseAt: null, customerNotifiedAt: null, staffNotifiedAt: null, adminNotifiedAt: null },
  });
  const due = await db.taxiDispatch.findMany({
    where: { status: 'SCHEDULED', dueAt: { lte: now }, ...(onlyOrderId ? { orderId: onlyOrderId } : {}) },
    orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
    take: 20,
    include: {
      taxiCompany: { include: { credential: { select: { id: true } } } },
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
    // Two ways to reach a company: its DS Taxi app login (the request simply appears in the app) and, while the Telegram taxi panel is on, a message
    // to the linked operator (limited by TAXI_OPERATOR_ALLOWLIST in development). At least one must work or the request goes to the administrators.
    const viaApp = Boolean(item.taxiCompany.credential);
    const viaTelegram = taxiTelegramEnabled() && Boolean(operator) && (!operatorAllowlist.length || operatorAllowlist.includes(operator!));
    const validOrder = item.order.createdViaBot && ['PREPARING', 'READY'].includes(item.order.status)
      && item.order.payment?.status === 'CONFIRMED_MANUAL';
    const pickupSet = Boolean(item.order.restaurant.pickupAddress?.trim());
    if (!viaApp && operator && taxiTelegramEnabled() && !viaTelegram) {
      console.error(`[TAXI] #${item.order.number}: operator is not in TAXI_OPERATOR_ALLOWLIST, nothing was sent`);
      await db.taxiDispatch.updateMany({ where: { id: item.id, status: 'SENDING' }, data: { status: 'NEEDS_HELP', leaseAt: null } });
      continue;
    }
    if (!validOrder || !item.taxiCompany.isActive || !(viaApp || viaTelegram) || (!item.order.payment?.isTest && !pickupSet)) {
      await db.taxiDispatch.updateMany({ where: { id: item.id, status: 'SENDING' }, data: { status: 'NEEDS_HELP', leaseAt: null } });
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
      ...(item.order.prepMinutes ? [`Tayyorlash vaqti: ${item.order.prepMinutes} daqiqa`] : []),
      `Ovqat qiymati: ${currency.format(item.order.totalSom)} so‘m (taksi haqi emas)`,
      'Yetkazish narxini sizning taksi xizmatingiz belgilaydi.',
      'Avval buyurtmani qabul qiling yoki rad eting; haydovchi yuborilgach „Taksi yuborildi“ni bosing.',
      `Javob muddati: ${responseSeconds} soniya. Javob bo‘lmasa avtomatik boshqa taksi chaqirilmaydi.`,
    ].join('\n');
    let telegramMessageId: number | null = null;
    let telegramFailed = false;
    if (viaTelegram) {
      try {
        telegramMessageId = (await bot.telegram.sendMessage(operator!, message, requestKeyboard(item.id))).message_id;
      } catch (err) {
        telegramFailed = true;
        console.error(`[TAXI REQUEST] #${item.order.number}:`, err instanceof Error ? err.message : err);
      }
    }
    if (telegramFailed && !viaApp) {
      // Even a transport timeout can follow a successful Telegram delivery.
      // Require the original operator to confirm SENT / NO_TAXI through /taxi.
      await db.taxiDispatch.updateMany({
        where: { id: item.id, status: 'SENDING' },
        data: { status: 'NEEDS_HELP', leaseAt: null, sendTries: { increment: 1 },
          customerNotifiedAt: null, staffNotifiedAt: null, adminNotifiedAt: null },
      });
      continue;
    }
    // With the app channel the request is simply "REQUESTED": the app shows it and rings until the operator answers.
    await db.taxiDispatch.updateMany({
      where: { id: item.id, status: 'SENDING' },
      data: { status: 'REQUESTED', sentAt: new Date(), expiresAt: new Date(Date.now() + responseSeconds * 1000),
        telegramMessageId, leaseAt: null, sendTries: { increment: 1 } },
    });
    if (viaApp && telegramMessageId === null) {
      // Nobody is looking at the app right now: do not wait for the response timeout, tell the administrators at once.
      const online = await db.taxiSession.count({
        where: { taxiCompanyId: item.taxiCompanyId, revokedAt: null, expiresAt: { gt: now }, lastSeenAt: { gt: new Date(Date.now() - APP_ONLINE_SECONDS * 1000) } },
      });
      if (online === 0) {
        await reportAlert(bot, `#${item.order.number} (${item.taxiCompany.name}): taksi operatorining ilovasi hozir ulanmagan, so‘rovni ko‘rmayapti. Operatorga telefon qiling.`,
          `${item.id}:APP_OFFLINE`, item.orderId, item.id);
      }
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
    await db.taxiDispatch.updateMany({
      where: { id: dispatch.id, status: 'REQUESTED' }, data: { status: 'CANCELLATION_PENDING', customerNotifiedAt: null, staffNotifiedAt: null, adminNotifiedAt: null },
    });
    // notifyOutcomes retries the admin alert from persisted state.
  }
  const stuck = await db.taxiDispatch.findMany({
    where: { status: 'ACCEPTED', expiresAt: { lte: now }, ...(onlyOrderId ? { orderId: onlyOrderId } : {}) }, take: 30, select: { id: true },
  });
  for (const dispatch of stuck) {
    await db.taxiDispatch.updateMany({
      where: { id: dispatch.id, status: 'ACCEPTED' },
      data: { status: 'NEEDS_HELP', customerNotifiedAt: null, staffNotifiedAt: null, adminNotifiedAt: null },
    });
  }
  // The operator was asked to clarify (up to 3 reminders) and still said nothing. A driver may or may not exist, so the system does
  // not re-send on its own unless explicitly allowed; it escalates to the administrators (NEEDS_HELP -> /taxiadmin).
  const silent = await db.taxiDispatch.findMany({
    where: { status: 'CANCELLATION_PENDING', cancelNoticeTries: { gte: 3 }, cancelNoticeAt: { lt: new Date(now.getTime() - silenceEscalationSeconds * 1000) },
      ...(onlyOrderId ? { orderId: onlyOrderId } : {}) },
    take: 20, select: { id: true },
  });
  for (const d of silent) {
    try { await escalateSilentDispatch(d.id, autoFallbackOnSilence); }
    catch (err) { console.error('[TAXI SILENCE]', err instanceof Error ? err.message : err); }
  }
  const needsConfirm = await db.taxiDispatch.findMany({
    where: {
      status: 'CANCELLATION_PENDING', cancelNoticeTries: { lt: 3 },
      ...(onlyOrderId ? { orderId: onlyOrderId } : {}),
      OR: [{ cancelNoticeAt: null }, { cancelNoticeAt: { lt: new Date(Date.now() - 90_000) } }],
    }, take: 20,
    include: { taxiCompany: { select: { operatorTelegramUserId: true, credential: { select: { id: true } } } }, order: { select: { number: true } } },
  });
  for (const dispatch of needsConfirm) {
    const operator = dispatch.taxiCompany.operatorTelegramUserId;
    if (!operator && !dispatch.taxiCompany.credential) continue;
    const claim = await db.taxiDispatch.updateMany({
      where: { id: dispatch.id, status: 'CANCELLATION_PENDING', cancelNoticeTries: dispatch.cancelNoticeTries },
      data: { cancelNoticeAt: new Date(), cancelNoticeTries: { increment: 1 } },
    });
    if (!claim.count) continue;
    // In the app the question stays on screen (and keeps ringing); the reminders are only counted so the escalation to the administrators still runs.
    if (!operator || !taxiTelegramEnabled()) continue;
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

async function notifyOutcomes(bot: Bot, onlyOrderId?: string, operatorBot: Bot = bot): Promise<void> {
  const recent = await db.taxiDispatch.findMany({
    where: { OR: [{ customerNotifiedAt: null }, { staffNotifiedAt: null }, ...(adminRecipients().length ? [{ adminNotifiedAt: null, status: { in: ['NEEDS_HELP', 'CANCELLATION_PENDING', 'DECLINED'] as import('@prisma/client').TaxiDispatchStatus[] } }] : [])], status: { in: ['ACCEPTED', 'ASSIGNED', 'DELIVERED', 'DECLINED', 'NEEDS_HELP', 'CANCELLATION_PENDING'] }, ...(onlyOrderId ? { orderId: onlyOrderId } : {}) },
    orderBy: { updatedAt: 'asc' }, take: 80,
    include: { taxiCompany: { select: { name: true } }, order: {
      include: { customer: { select: { telegramUserId: true } }, restaurant: { select: { staffTelegramUserId: true } },
        taxiDispatches: { select: { id: true, attemptNo: true } } },
    } },
  });
  for (const d of recent) {
    if (!d.adminNotifiedAt && ['NEEDS_HELP', 'CANCELLATION_PENDING', 'DECLINED'].includes(d.status)) {
      if (await reportAlert(operatorBot, `#${d.order.number} (${d.taxiCompany.name}): ${d.status}. Haydovchi yuborilgan-yuborilmaganini aniqlab, qayta yuboring yoki boshqa kompaniyaga o‘tkazing: /taxiadmin`, `${d.id}:${d.status}`, d.orderId, d.id)) {
        await db.taxiDispatch.updateMany({ where: { id: d.id, status: d.status, adminNotifiedAt: null }, data: { adminNotifiedAt: new Date() } });
      }
    }
    const newer = d.order.taxiDispatches.some(x => x.attemptNo > d.attemptNo);
    // The customer hears the four things that matter (paid, cooking, on the way, delivered) plus problems; "operator accepted" is internal.
    const label: string | null = d.status === 'ACCEPTED'
      ? null
      : d.status === 'DELIVERED'
      ? `✅ #${d.order.number}: buyurtma yetkazildi. Yoqimli ishtaha!`
      : d.status === 'ASSIGNED'
      ? `🚕 #${d.order.number}: buyurtmangiz yo‘lda.`
      : d.status === 'DECLINED' && newer
      ? `🔄 #${d.order.number}: ${d.taxiCompany.name}da bo‘sh taksi yo‘q. Roziligingiz asosida boshqa kompaniyadan qidiryapmiz.`
      : d.status === 'DECLINED'
      ? `⚠️ #${d.order.number}: taksi topilmadi. DS Delivery bilan bog‘lanib, yetkazishni aniqlashtiring. Buyurtma yetkazildi deb hisoblanmaydi.`
      : d.status === 'NEEDS_HELP'
      ? `⚠️ #${d.order.number}: taksi operatori bilan bog‘lanishda muammo. Yetkazish uchun administrator yordami kerak.`
      : `⏳ #${d.order.number}: taksi operatoridan javob kechikmoqda. Ikkinchi haydovchi yuborilmasligi uchun tekshirilyapti.`;
    // One logical notice per (dispatch state, destination CHAT). The key names the chat, not the role, so a person who is both
    // customer and restaurant staff gets it once, and concurrent workers/retries/restarts cannot repeat it (NotificationLog).
    // Restaurant staff are no longer notified through Telegram unless the legacy panel is explicitly re-enabled.
    for (const [key, chatId] of [
      ['customerNotifiedAt', d.order.customer.telegramUserId],
      ['staffNotifiedAt', restaurantTelegramEnabled() ? d.order.restaurant.staffTelegramUserId : null],
    ] as const) {
      if (d[key]) continue;
      if (!chatId || label === null) {
        await db.taxiDispatch.updateMany({ where: { id: d.id, status: d.status, [key]: null }, data: { [key]: new Date() } });
        continue;
      }
      const outcome = await sendOnce(bot, { key: notificationKey('taxi-outcome', d.id, d.status, chatId), kind: 'taxi-outcome', chatId, orderId: d.orderId, text: label });
      if (isDelivered(outcome)) {
        await db.taxiDispatch.updateMany({ where: { id: d.id, status: d.status, [key]: null }, data: { [key]: new Date() } });
      } else if (outcome === 'FAILED') {
        console.error(`[TAXI NOTICE] ${d.order.number} ${key}: delivery failed, will retry`);
      }
    }
  }
}

/** DB-backed scheduler. One process for local MVP; CAS prevents duplicate assignment.
 *  Telegram notification is at-least-once; the callback is idempotent.
 */
/** Exposed for an isolated DB smoke test; orderId limits side effects to one test order. */
export async function runTaxiDispatchCycle(bot: Bot, onlyOrderId?: string, operatorBot: Bot = bot): Promise<void> {
  await dispatchDue(operatorBot, onlyOrderId);
  await enforceTimeout(operatorBot, onlyOrderId);
  await notifyOutcomes(bot, onlyOrderId, operatorBot);
}

/** `bot` notifies customers/staff; `operatorBot` (default: the same bot) talks to taxi operators. */
export function startTaxiDispatcher(bot: Bot, operatorBot: Bot = bot): () => void {
  let busy = false;
  let stopped = false;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      await runTaxiDispatchCycle(bot, undefined, operatorBot);
    } catch (err) {
      console.error('[TAXI DISPATCH WORKER]', err instanceof Error ? err.message : err);
    } finally { busy = false; }
  };
  const timer = setInterval(() => void tick(), pollSeconds * 1000);
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}
