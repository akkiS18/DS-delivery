import { Markup, type Context, type Telegraf } from 'telegraf';
import { db } from '../lib/db.js';
import type { PaymentEngineV3 } from '../modules/payment/engine.js';
import { isSupportAdmin, supportAdminIds } from '../modules/support/service.js';
import {
  adminConfirmRefund, cancelUnpaidOrder, customerAnswerRefund, decideRefund, markRefundSent, requestCancellation,
  type StepResult,
} from '../modules/refunds/service.js';
import { CUSTOMER_REASONS, REJECT_REASONS, RESTAURANT_REASONS } from '../modules/refunds/workflow.js';
import { RESTAURANT_TELEGRAM_DISABLED_MESSAGE, restaurantTelegramEnabled } from '../lib/features.js';

const fmt = new Intl.NumberFormat('uz-UZ');
const som = (tiyin: bigint): string => `${fmt.format(Number(tiyin / 100n))} so‘m`;
const REASON_LABEL: Record<string, string> = {
  CHANGED_MIND: 'Fikrim o‘zgardi', TOO_SLOW: 'Juda kech bo‘lyapti', WRONG_ORDER: 'Noto‘g‘ri buyurtma', OTHER: 'Boshqa sabab',
  OUT_OF_STOCK: 'Mahsulot tugagan', CANNOT_FULFIL: 'Bajara olmaymiz', CLOSED: 'Restoran yopiq',
  MONEY_NOT_RECEIVED: 'Pul kelmagan', ALREADY_PREPARED: 'Allaqachon tayyorlangan', POLICY: 'Qoida bo‘yicha',
};

/** Armed text input (in-memory, 10 min): the bank reference (restaurant) or the confirmation note (admin). */
const pending = new Map<string, { kind: 'ref' | 'note'; refundId: string; expires: number }>();
const TTL = 10 * 60 * 1000;

const stepNote = (r: StepResult): string => r.result === 'DONE' ? '✅ Bajarildi.'
  : r.result === 'NOT_FOUND' ? '⛔ Topilmadi.' : `ℹ️ Amal avval bajarilgan yoki holat o‘zgargan (${r.status}).`;

export function registerRefundHandlers<C extends Context>(bot: Telegraf<C>, engine: PaymentEngineV3): void {
  const actor = (ctx: Context): string | null => (ctx.from && ctx.chat?.type === 'private' ? String(ctx.from.id) : null);
  const guard = async (ctx: Context, fn: (id: string) => Promise<void>) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const id = actor(ctx);
    if (!id) return;
    try { await fn(id); } catch (err) {
      console.error('[REFUND]', err instanceof Error ? err.message : 'Unknown error');
      await ctx.reply(`Amal bajarilmadi: ${err instanceof Error && /^[A-Z_]+$/.test(err.message) ? err.message : 'xatolik'}. /orders yoki /refunds orqali holatni tekshiring.`);
    }
  };

  // ---------------- customer: cancellation of an accepted order ----------------
  bot.action(/^order:cx:([a-zA-Z0-9_-]+)$/, ctx => guard(ctx, async id => {
    const order = await db.order.findFirst({ where: { id: ctx.match[1]!, customer: { telegramUserId: id } }, select: { id: true, number: true, status: true } });
    if (!order) { await ctx.reply('Buyurtma topilmadi.'); return; }
    if (order.status === 'PAYMENT_PENDING') {
      await ctx.reply(`#${order.number}: to‘lov hali kelmagan. Bekor qilasizmi? Agar pul yuborgan bo‘lsangiz, bekor qilmang va administratorga murojaat qiling.`,
        Markup.inlineKeyboard([[Markup.button.callback('❌ Ha, bekor qilish', `order:cxu:${order.id}`)]]));
    } else if (['PAYMENT_MATCHED_UNVERIFIED', 'PAYMENT_CONFIRMED', 'PREPARING'].includes(order.status)) {
      await ctx.reply(`#${order.number}: to‘lov qabul qilingan bo‘lishi mumkin. Bekor qilish so‘rovi restoranga yuboriladi; pulni restoran o‘z hisobidan qaytaradi va qaytarishni sizdan tasdiqlashni so‘raydi. Restoran so‘rovni rad etishi mumkin. Sababni tanlang:`,
        Markup.inlineKeyboard(CUSTOMER_REASONS.map(c => [Markup.button.callback(REASON_LABEL[c]!, `order:cxr:${c}:${order.id}`)])));
    } else await ctx.reply('Bu holatda buyurtmani bot orqali bekor qilib bo‘lmaydi. /support orqali murojaat qiling.');
  }));

  bot.action(/^order:cxu:([a-zA-Z0-9_-]+)$/, ctx => guard(ctx, async id => {
    const r = await cancelUnpaidOrder(engine, { telegramUserId: id, orderId: ctx.match[1]! });
    await ctx.reply(r.result === 'CANCELLED' ? '❌ Buyurtma bekor qilindi. Agar pul yuborgan bo‘lsangiz, /support orqali murojaat qiling.'
      : r.result === 'USE_REFUND_REQUEST' ? 'To‘lov qabul qilingan: /orders orqali “bekor qilish” tugmasini qayta bosing.'
      : r.result === 'NOT_FOUND' ? 'Buyurtma topilmadi.' : `Bu holatda bekor qilib bo‘lmaydi (${r.status}).`);
  }));

  bot.action(/^order:cxr:([A-Z_]+):([a-zA-Z0-9_-]+)$/, ctx => guard(ctx, async id => {
    const r = await requestCancellation({ actorType: 'CUSTOMER', actorTelegramId: id, orderId: ctx.match[2]!, reasonCode: ctx.match[1]! });
    await ctx.reply(r.result === 'REQUESTED' ? `📨 So‘rov #${r.number} restoranga yuborildi. Qaror kelguncha buyurtma to‘xtatiladi. Pul qaytarilishi restoran qaroriga bog‘liq.`
      : r.result === 'ALREADY_REQUESTED' ? `ℹ️ #${r.number} so‘rov allaqachon mavjud.`
      : r.result === 'NOT_FOUND' ? 'Buyurtma topilmadi.'
      : r.result === 'USE_UNPAID_CANCEL' || r.result === 'USE_WAITING_CANCEL' ? '/orders orqali buyurtmani oching va “Bekor qilish” tugmasini bosing.'
      : 'Bu holatda bekor qilib bo‘lmaydi. /support orqali murojaat qiling.');
  }));

  // ---------------- restaurant staff (legacy Telegram panel; off unless RESTAURANT_TELEGRAM_ENABLED=true) ----------------
  // The restaurant app uses the same refund services through /api/v1/restaurant/orders/:id/cancel and /refund/*.
  const staffOn = restaurantTelegramEnabled();
  const staffAction: typeof bot.action = ((re: RegExp, fn: never) => (staffOn ? bot.action(re, fn) : bot)) as never;
  if (!staffOn) {
    bot.action(/^refund:(cx|cxr|ok|no|r[0-3]|sent):/, async ctx => {
      await ctx.answerCbQuery().catch(() => undefined);
      await ctx.reply(RESTAURANT_TELEGRAM_DISABLED_MESSAGE); // no data is changed
    });
    bot.command('refunds', async ctx => { await ctx.reply(RESTAURANT_TELEGRAM_DISABLED_MESSAGE); });
  }
  staffAction(/^refund:cx:([a-zA-Z0-9_-]+)$/, ctx => guard(ctx, async () => {
    await ctx.reply('Buyurtmani bekor qilish sababi. Mijozga to‘langan pul qaytarilishi kerak bo‘ladi:',
      Markup.inlineKeyboard(RESTAURANT_REASONS.map(c => [Markup.button.callback(REASON_LABEL[c]!, `refund:cxr:${c}:${ctx.match[1]}`)])));
  }));
  staffAction(/^refund:cxr:([A-Z_]+):([a-zA-Z0-9_-]+)$/, ctx => guard(ctx, async id => {
    const r = await requestCancellation({ actorType: 'RESTAURANT_STAFF', actorTelegramId: id, orderId: ctx.match[2]!, reasonCode: ctx.match[1]! });
    if (r.result === 'APPROVED') {
      await ctx.reply(`✅ Buyurtma bekor qilindi. Qaytarish #${r.number} ochildi. Pulni o‘z hisobingizdan qaytaring va bank ma’lumotnoma raqamini kiriting.`,
        Markup.inlineKeyboard([[Markup.button.callback('💸 Qaytarildi — raqamni kiritish', `refund:sent:${r.refundId}`)]]));
    } else await ctx.reply(r.result === 'ALREADY_REQUESTED' ? `ℹ️ #${r.number} qaytarish so‘rovi allaqachon mavjud.` : r.result === 'NOT_FOUND' ? '⛔ Ruxsat yo‘q yoki buyurtma topilmadi.' : 'Bu holatda bekor qilib bo‘lmaydi.');
  }));

  staffAction(/^refund:ok:([a-zA-Z0-9_-]+)$/, ctx => guard(ctx, async id => {
    const r = await decideRefund({ actorTelegramId: id, refundId: ctx.match[1]!, decision: 'APPROVE' });
    await ctx.reply(stepNote(r), r.result === 'DONE'
      ? Markup.inlineKeyboard([[Markup.button.callback('💸 Qaytarildi — raqamni kiritish', `refund:sent:${ctx.match[1]}`)]]) : undefined);
  }));
  staffAction(/^refund:no:([a-zA-Z0-9_-]+)$/, ctx => guard(ctx, async () => {
    await ctx.reply('Rad etish sababi:', Markup.inlineKeyboard(REJECT_REASONS.map((c, i) => [Markup.button.callback(REASON_LABEL[c]!, `refund:r${i}:${ctx.match[1]}`)])));
  }));
  staffAction(/^refund:r([0-3]):([a-zA-Z0-9_-]+)$/, ctx => guard(ctx, async id => {
    const r = await decideRefund({ actorTelegramId: id, refundId: ctx.match[2]!, decision: 'REJECT', rejectReason: REJECT_REASONS[Number(ctx.match[1])] });
    await ctx.reply(stepNote(r));
  }));
  staffAction(/^refund:sent:([a-zA-Z0-9_-]+)$/, ctx => guard(ctx, async id => {
    pending.set(id, { kind: 'ref', refundId: ctx.match[1]!, expires: Date.now() + TTL });
    await ctx.reply('Bank o‘tkazmasi ma’lumotnoma (reference) raqamini yozing. Faqat tugma bosish yetarli emas; raqam saqlanadi va mijoz/administrator tomonidan tasdiqlanadi. Bekor qilish: /cancel');
  }));

  // ---------------- customer answer & admin confirmation ----------------
  bot.action(/^refund:(got|miss):([a-zA-Z0-9_-]+)$/, ctx => guard(ctx, async id => {
    const r = await customerAnswerRefund({ telegramUserId: id, refundId: ctx.match[2]!, received: ctx.match[1] === 'got' });
    await ctx.reply(r.result === 'DONE' ? (ctx.match[1] === 'got' ? '✅ Rahmat, qaytarish tasdiqlandi.' : '⚠️ Qayd etildi. Restoran va administrator xabardor qilinadi.') : stepNote(r));
  }));
  bot.action(/^refund:adm:([a-zA-Z0-9_-]+)$/, ctx => guard(ctx, async id => {
    if (!isSupportAdmin(id)) { await ctx.reply('🚫 Ruxsat yo‘q.'); return; }
    pending.set(id, { kind: 'note', refundId: ctx.match[1]!, expires: Date.now() + TTL });
    await ctx.reply('Tasdiqlash izohini yozing (kamida 10 belgi): qanday mustaqil tekshirdingiz (masalan, restoran hisobi ko‘chirmasi, mijoz bilan aloqa). Bekor qilish: /cancel');
  }));

  bot.command('cancel', async (ctx, next) => {
    const id = actor(ctx);
    if (id && pending.delete(id)) { await ctx.reply('Bekor qilindi.'); return; }
    return next();
  });

  // Registered before the generic text handlers; passes through unless this user armed an input.
  bot.on('text', async (ctx, next) => {
    const id = actor(ctx);
    const wait = id ? pending.get(id) : undefined;
    if (!id || !wait) return next();
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) { pending.delete(id); return next(); }
    if (wait.expires < Date.now()) { pending.delete(id); await ctx.reply('Vaqt tugadi. Tugmani qayta bosing.'); return; }
    try {
      const r = wait.kind === 'ref'
        ? await markRefundSent({ actorTelegramId: id, refundId: wait.refundId, bankReference: text })
        : await adminConfirmRefund({ adminTelegramId: id, refundId: wait.refundId, note: text });
      pending.delete(id);
      await ctx.reply(wait.kind === 'ref' && r.result === 'DONE' ? '📨 Qayd etildi. Mijozdan qabul qilinganini tasdiqlash so‘raladi — to‘liq tasdiqlanmaguncha qaytarish “yakunlangan” hisoblanmaydi.' : stepNote(r));
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'BANK_REFERENCE_NOTOGRI' || code === 'ADMIN_IZOH_NOTOGRI') { await ctx.reply('Qiymat yaroqsiz, qayta yozing (yoki /cancel).'); return; }
      pending.delete(id);
      console.error('[REFUND INPUT]', code || 'Unknown error');
      await ctx.reply(`Amal bajarilmadi: ${/^[A-Z_]+$/.test(code) ? code : 'xatolik'}.`);
    }
  });

  if (staffOn) bot.command('refunds', async ctx => {
    const id = actor(ctx);
    if (!id) return;
    const rows = await db.refundRequest.findMany({
      where: { status: { in: ['REQUESTED', 'APPROVED', 'DISPUTED'] }, order: { restaurant: { staffTelegramUserId: id } } },
      orderBy: { requestedAt: 'asc' }, take: 10, include: { order: { select: { number: true } } },
    });
    if (!rows.length) { await ctx.reply('Ochiq qaytarish so‘rovlari yo‘q.'); return; }
    for (const r of rows) {
      const keys = r.status === 'REQUESTED'
        ? [[Markup.button.callback('✅ Qabul qilish', `refund:ok:${r.id}`), Markup.button.callback('🚫 Rad etish', `refund:no:${r.id}`)]]
        : [[Markup.button.callback('💸 Qaytarildi — raqamni kiritish', `refund:sent:${r.id}`)]];
      await ctx.reply(`#${r.number} • buyurtma #${r.order.number} • ${som(r.paidAmountTiyin)} • ${r.status}`, Markup.inlineKeyboard(keys));
    }
  });
}

// ---------------------------------------------------------------- notifications (DB-driven, at-least-once)
const backoff = new Map<string, { fails: number; next: number }>();
const due = (k: string) => (backoff.get(k)?.next ?? 0) <= Date.now();
const failed = (k: string) => { const f = (backoff.get(k)?.fails ?? 0) + 1; backoff.set(k, { fails: f, next: Date.now() + Math.min(5_000 * 2 ** (f - 1), 3_600_000) }); };

export async function deliverRefundNotices<C extends Context>(bot: Telegraf<C>): Promise<void> {
  const send = async (key: string, to: string | null | undefined, text: string, markup: ReturnType<typeof Markup.inlineKeyboard> | undefined, mark: () => Promise<unknown>, customerNotice = false) => {
    // A customer without a Telegram link (Android guest) has no chat: the notice is settled, not retried forever (it would clog the batch).
    if (!to && customerNotice) { await mark(); return; }
    if (!to || !due(key)) return;
    try { await bot.telegram.sendMessage(to, text, markup); await mark(); backoff.delete(key); }
    catch (err) { failed(key); console.error('[REFUND NOTICE]', err instanceof Error ? err.message : 'Unknown error'); }
  };
  let admins: string[] = [];
  try { admins = supportAdminIds(); } catch { admins = []; }
  const rows = await db.refundRequest.findMany({
    where: { OR: [
      ...(restaurantTelegramEnabled() ? [{ status: 'REQUESTED', staffNotifiedAt: null }] : []), { status: { in: ['REQUESTED', 'APPROVED'] }, adminNotifiedAt: null },
      { status: { in: ['APPROVED', 'REJECTED'] }, customerDecisionNotifiedAt: null },
      { status: 'SENT', customerSentNotifiedAt: null }, { status: 'DISPUTED', disputeNotifiedAt: null },
    ] },
    orderBy: { requestedAt: 'asc' }, take: 30,
    include: { order: { select: { number: true, customer: { select: { telegramUserId: true } }, restaurant: { select: { name: true, staffTelegramUserId: true } } } } },
  });
  for (const r of rows) {
    const head = `#${r.number} • buyurtma #${r.order.number}`;
    const amount = som(r.approvedAmountTiyin ?? r.paidAmountTiyin);
    if (restaurantTelegramEnabled() && r.status === 'REQUESTED' && !r.staffNotifiedAt) {
      await send(`staff:${r.id}`, r.order.restaurant.staffTelegramUserId,
        `💸 Bekor qilish / qaytarish so‘rovi ${head}\nSumma: ${som(r.paidAmountTiyin)}\nSabab: ${REASON_LABEL[r.reasonCode] ?? r.reasonCode}\nHolat bo‘yicha oldingi: ${r.orderStatusBefore}\n⚠️ Pul kelganini o‘z bank hisobingizdan mustaqil tekshiring. Qabul qilsangiz buyurtma bekor bo‘ladi va pulni o‘zingiz qaytarasiz.`,
        Markup.inlineKeyboard([[Markup.button.callback('✅ Qabul qilish', `refund:ok:${r.id}`), Markup.button.callback('🚫 Rad etish', `refund:no:${r.id}`)]]),
        () => db.refundRequest.updateMany({ where: { id: r.id, staffNotifiedAt: null }, data: { staffNotifiedAt: new Date() } }));
    }
    if (['REQUESTED', 'APPROVED'].includes(r.status) && !r.adminNotifiedAt && admins.length && due(`admin:${r.id}`)) {
      const key = `admin:${r.id}`;
      try {
        for (const a of admins) await bot.telegram.sendMessage(a, `ℹ️ ${r.order.restaurant.name}: qaytarish ${head}, ${som(r.paidAmountTiyin)}, ${r.status} (${r.kind}). Pulni restoran qaytaradi; platforma pul ushlamaydi.`);
        await db.refundRequest.updateMany({ where: { id: r.id, adminNotifiedAt: null }, data: { adminNotifiedAt: new Date() } });
        backoff.delete(key);
      } catch (err) { failed(key); console.error('[REFUND ADMIN NOTICE]', err instanceof Error ? err.message : 'Unknown error'); }
    }
    if (['APPROVED', 'REJECTED'].includes(r.status) && !r.customerDecisionNotifiedAt) {
      await send(`cdec:${r.id}`, r.order.customer.telegramUserId, r.status === 'APPROVED'
        ? `✅ ${head}: buyurtma bekor qilindi. Qaytariladigan summa: ${amount}. Pulni restoran o‘z hisobidan qaytaradi; qaytarilgach sizdan tasdiq so‘raladi. Muddat va’da qilinmagan.`
        : `🚫 ${head}: restoran bekor qilish so‘rovini rad etdi (${REASON_LABEL[r.rejectReason ?? ''] ?? r.rejectReason}). Buyurtma davom etadi. Savol bo‘lsa /support.`,
        undefined, () => db.refundRequest.updateMany({ where: { id: r.id, customerDecisionNotifiedAt: null }, data: { customerDecisionNotifiedAt: new Date() } }), true);
    }
    if (r.status === 'SENT' && !r.customerSentNotifiedAt) {
      await send(`csent:${r.id}`, r.order.customer.telegramUserId,
        `💸 ${head}: ${r.order.restaurant.name} ${amount} qaytarganini bildirdi (ma’lumotnoma: ${r.bankReference}). Pul hisobingizga keldimi?`,
        Markup.inlineKeyboard([[Markup.button.callback('✅ Ha, keldi', `refund:got:${r.id}`), Markup.button.callback('❌ Kelmadi', `refund:miss:${r.id}`)]]),
        () => db.refundRequest.updateMany({ where: { id: r.id, customerSentNotifiedAt: null }, data: { customerSentNotifiedAt: new Date() } }), true);
    }
    if (r.status === 'DISPUTED' && !r.disputeNotifiedAt && (admins.length || r.order.restaurant.staffTelegramUserId) && due(`disp:${r.id}`)) {
      const key = `disp:${r.id}`;
      try {
        for (const a of admins) {
          await bot.telegram.sendMessage(a, `⚠️ Qaytarish ${head}: mijoz pul KELMADI dedi (ma’lumotnoma: ${r.bankReference}). Mustaqil tekshirgach, izoh bilan tasdiqlang.`,
            Markup.inlineKeyboard([[Markup.button.callback('📝 Izoh bilan tasdiqlash', `refund:adm:${r.id}`)]]));
        }
        if (restaurantTelegramEnabled() && r.order.restaurant.staffTelegramUserId) {
          await bot.telegram.sendMessage(r.order.restaurant.staffTelegramUserId, `⚠️ ${head}: mijoz qaytarilgan pulni olmaganini bildirdi. Tekshirib, yangi ma’lumotnoma bilan qayta yuboring.`,
            Markup.inlineKeyboard([[Markup.button.callback('💸 Qayta qayd etish', `refund:sent:${r.id}`)]]));
        }
        await db.refundRequest.updateMany({ where: { id: r.id, disputeNotifiedAt: null }, data: { disputeNotifiedAt: new Date() } });
        backoff.delete(key);
      } catch (err) { failed(key); console.error('[REFUND DISPUTE NOTICE]', err instanceof Error ? err.message : 'Unknown error'); }
    }
  }
}
