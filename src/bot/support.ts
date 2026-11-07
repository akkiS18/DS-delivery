import { Markup, type Context, type Telegraf } from 'telegraf';
import {
  claimTicket, createTicket, isSupportAdmin, listActiveTickets, listCustomerOrders, listCustomerTickets,
  resolveTicket, statusLabel, ticketByNumber, ticketForAdmin, MIN_MESSAGE, MAX_MESSAGE, type ActionResult,
} from '../modules/support/service.js';
import {
  addAdminReply, addCustomerMessage, customerActiveTicket, listCustomerActiveTickets, reassignTicket, reopenTicket,
  MAX_FOLLOWUP, type MessageResult, type TransitionResult,
} from '../modules/support/conversation.js';
import { deliverSupportNotifications, refreshAdminMessages, renderAdminTicket } from './support-notify.js';

/** Users who are about to type a message (in-memory, 10 min): a new ticket, a customer follow-up or an admin reply. */
type Pending = { kind: 'new'; orderId: string } | { kind: 'followup' | 'admin-reply'; ticketId: string };
const pending = new Map<string, Pending & { expires: number }>();
const PENDING_MS = 10 * 60 * 1000;

function displayName(ctx: Context): string {
  const f = ctx.from;
  if (!f) return 'Admin';
  return [f.first_name, f.last_name].filter(Boolean).join(' ') || (f.username ? `@${f.username}` : String(f.id));
}

function adminReply(r: ActionResult): string | null {
  switch (r.result) {
    case 'DUPLICATE': return null; // same callback delivered twice: stay silent
    case 'NOT_FOUND': return '⛔ Murojaat topilmadi.';
    case 'ALREADY_CLAIMED': return `⚠️ Bu murojaatni allaqachon ${r.assignedAdminName} oldi.`;
    case 'ALREADY_RESOLVED': return 'ℹ️ Murojaat allaqachon hal qilingan.';
    case 'NOT_YOURS': return `⛔ Bu murojaat ${r.assignedAdminName} da. Faqat o‘zi yopa oladi.`;
    case 'NOT_CLAIMED': return '⚠️ Avval “Men oldim” tugmasini bosing.';
    default: return '✅ Bajarildi.';
  }
}

function messageReply(r: MessageResult): string {
  switch (r.result) {
    case 'DUPLICATE': return '';
    case 'NOT_FOUND': return '⛔ Murojaat topilmadi.';
    case 'ALREADY_RESOLVED': return 'ℹ️ Murojaat hal qilingan. Yozish uchun avval qayta oching.';
    case 'NOT_CLAIMED': return '⚠️ Avval “Men oldim” tugmasini bosing.';
    case 'NOT_YOURS': return `⛔ Bu murojaat ${r.assignedAdminName} da.`;
    default: return '✅ Xabar yuborildi.';
  }
}
function transitionReply(r: TransitionResult): string {
  switch (r.result) {
    case 'DUPLICATE': return '';
    case 'NOT_FOUND': return '⛔ Murojaat topilmadi.';
    case 'NOT_ACTIVE': return 'ℹ️ Murojaat jarayonda emas.';
    case 'NOT_RESOLVED': return 'ℹ️ Murojaat hal qilinmagan.';
    case 'SAME_ADMIN': return 'ℹ️ Murojaat allaqachon shu adminda.';
    case 'NOT_ALLOWED': return '⛔ Murojaatni faqat egasi boshqaga o‘tkaza oladi (yoki siz o‘zingizga olishingiz mumkin).';
    case 'INVALID_TARGET': return '⛔ Noto‘g‘ri administrator.';
    case 'ALREADY_ACTIVE': return `⚠️ Bu buyurtma bo‘yicha #${r.number} murojaat hali ochiq.`;
    default: return '✅ Bajarildi.';
  }
}

export function registerSupportHandlers<C extends Context>(bot: Telegraf<C>): void {
  // ---- customer ----
  bot.command('support', async ctx => {
    if (!ctx.from || ctx.chat?.type !== 'private') return;
    const orders = await listCustomerOrders(String(ctx.from.id));
    if (!orders.length) { await ctx.reply('Murojaat uchun avval buyurtma berishingiz kerak.'); return; }
    await ctx.reply('🎫 Qaysi buyurtma bo‘yicha murojaat qilmoqchisiz?', Markup.inlineKeyboard([
      ...orders.map(o => [Markup.button.callback(`#${o.code} • ${o.status}`, `sup:order:${o.id}`)]),
    ]));
  });

  bot.command('mytickets', async ctx => {
    if (!ctx.from || ctx.chat?.type !== 'private') return;
    const rows = await listCustomerTickets(String(ctx.from.id));
    const active = await listCustomerActiveTickets(String(ctx.from.id));
    await ctx.reply(rows.length
      ? '🎫 Murojaatlaringiz:\n' + rows.map(t => `#${t.number}${t.order ? ` (buyurtma #${t.order.code})` : " (umumiy)"} — ${statusLabel(t.status)}`).join('\n')
      : 'Murojaatlaringiz yo‘q.', active.length ? Markup.inlineKeyboard(active.map(t => [
      Markup.button.callback(`✍️ #${t.number} ga yozish`, `sup:cw:${t.id}`)])) : undefined);
  });

  bot.action(/^sup:cw:([a-zA-Z0-9_-]+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (!ctx.from || ctx.chat?.type !== 'private') return;
    const userId = String(ctx.from.id);
    const t = await customerActiveTicket(userId, ctx.match[1]!); // ownership + still unresolved
    if (!t) { await ctx.reply('Murojaat topilmadi yoki hal qilingan.'); return; }
    pending.set(userId, { kind: 'followup', ticketId: t.id, expires: Date.now() + PENDING_MS });
    await ctx.reply(`✍️ #${t.number} murojaat uchun xabaringizni yozing. Bekor qilish: /cancel`);
  });

  bot.action(/^sup:order:([a-zA-Z0-9_-]+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (!ctx.from || ctx.chat?.type !== 'private') return;
    const userId = String(ctx.from.id);
    // Ownership is re-checked here so a forged callback cannot start a ticket for a foreign order.
    const own = (await listCustomerOrders(userId)).find(o => o.id === ctx.match[1]);
    if (!own) { await ctx.reply('Buyurtma topilmadi.'); return; }
    pending.set(userId, { kind: 'new', orderId: own.id, expires: Date.now() + PENDING_MS });
    await ctx.reply(`✍️ #${own.code} buyurtma bo‘yicha muammoni yozing (${MIN_MESSAGE}–${MAX_MESSAGE} belgi). Bekor qilish: /cancel`);
  });

  bot.command('cancel', async (ctx, next) => {
    if (ctx.from && pending.delete(String(ctx.from.id))) { await ctx.reply('Murojaat bekor qilindi.'); return; }
    return next();
  });

  /** Follow-up (customer, one message) or admin reply (stays armed for further replies until /cancel or timeout). */
  async function conversationText(ctx: Context, userId: string, wait: Pending & { kind: 'followup' | 'admin-reply' }, text: string) {
    if (text.length > MAX_FOLLOWUP) { await ctx.reply(`Xabar ${MAX_FOLLOWUP} belgidan oshmasin.`); return; }
    const messageId = ctx.message && 'message_id' in ctx.message ? ctx.message.message_id : 0;
    try {
      const admin = wait.kind === 'admin-reply';
      const r = admin
        ? await addAdminReply({ actorTelegramId: userId, actorName: displayName(ctx), ticketId: wait.ticketId, text, telegramMessageId: messageId })
        : await addCustomerMessage({ telegramUserId: userId, ticketId: wait.ticketId, text, telegramMessageId: messageId });
      if (admin && r.result === 'SENT') pending.set(userId, { ...wait, expires: Date.now() + PENDING_MS });
      else pending.delete(userId);
      const note = messageReply(r);
      if (note) await ctx.reply(note);
      if (r.result === 'SENT') await deliverSupportNotifications(bot).catch(() => undefined);
    } catch (err) {
      pending.delete(userId);
      console.error('[SUPPORT MESSAGE]', err instanceof Error ? err.message : 'Unknown error');
      await ctx.reply('Xabarni yuborib bo‘lmadi. Keyinroq qayta urinib ko‘ring.');
    }
  }

  /** An admin used Telegram's own "Reply" on one of the bot's ticket messages ("🎫 Murojaat #12 ..." / "💬 Murojaat #12 — mijoz yozdi"):
   *  the text goes to that ticket's customer (their app chat or their Telegram). An unclaimed ticket is claimed by the replying admin first.
   *  Returns false when the replied-to message is not a ticket message, so the normal text handling continues. */
  async function replyByQuote(ctx: Context, actor: string, replied: unknown, text: string): Promise<boolean> {
    const msg = replied as { text?: string; from?: { id: number; is_bot: boolean } };
    if (!msg.from?.is_bot || (ctx.botInfo && msg.from.id !== ctx.botInfo.id) || !msg.text) return false;
    const ref = /Murojaat #(\d{1,9})/.exec(msg.text);
    if (!ref) return false;
    if (text.length > MAX_FOLLOWUP) { await ctx.reply(`Xabar ${MAX_FOLLOWUP} belgidan oshmasin.`); return true; }
    const ticket = await ticketByNumber(Number(ref[1]));
    if (!ticket) { await ctx.reply('⛔ Murojaat topilmadi.'); return true; }
    const messageId = ctx.message && 'message_id' in ctx.message ? ctx.message.message_id : 0;
    try {
      if (ticket.status === 'OPEN') {
        const c = await claimTicket({ actorTelegramId: actor, actorName: displayName(ctx), ticketId: ticket.id, callbackQueryId: `reply:${ctx.chat?.id}:${messageId}` });
        if (c.result !== 'DONE' && c.result !== 'DUPLICATE') { const note = adminReply(c); if (note) await ctx.reply(note); return true; }
        await refreshAdminMessages(bot, ticket.id);
      }
      const r = await addAdminReply({ actorTelegramId: actor, actorName: displayName(ctx), ticketId: ticket.id, text, telegramMessageId: messageId });
      const note = messageReply(r);
      if (note) await ctx.reply(note);
      if (r.result === 'SENT') await deliverSupportNotifications(bot).catch(() => undefined);
    } catch (err) {
      console.error('[SUPPORT QUOTE REPLY]', err instanceof Error ? err.message : 'Unknown error');
      await ctx.reply('Xabarni yuborib bo‘lmadi. Keyinroq qayta urinib ko‘ring.');
    }
    return true;
  }

  // Must be registered before the generic checkout text handler; passes through when not pending.
  bot.on('text', async (ctx, next) => {
    if (!ctx.from || ctx.chat?.type !== 'private') return next();
    const userId = String(ctx.from.id);
    if (ctx.message.reply_to_message && isSupportAdmin(userId) && !ctx.message.text.startsWith('/')) {
      if (await replyByQuote(ctx, userId, ctx.message.reply_to_message, ctx.message.text.trim())) return;
    }
    const wait = pending.get(userId);
    if (!wait) return next();
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) { pending.delete(userId); return next(); }
    if (wait.expires < Date.now()) { pending.delete(userId); await ctx.reply('Vaqt tugadi. /support orqali qayta boshlang.'); return; }
    if (wait.kind !== 'new') { await conversationText(ctx, userId, wait, text); return; }
    if (text.length < MIN_MESSAGE || text.length > MAX_MESSAGE) {
      await ctx.reply(`Xabar ${MIN_MESSAGE}–${MAX_MESSAGE} belgi bo‘lishi kerak.`); return;
    }
    pending.delete(userId);
    try {
      const r = await createTicket({ telegramUserId: userId, orderId: wait.orderId, message: text });
      if (r.result === 'CREATED') {
        await ctx.reply(`✅ Murojaatingiz #${r.number} qabul qilindi. Administrator tez orada bog‘lanadi.`);
        await deliverSupportNotifications(bot).catch(() => undefined);
      } else if (r.result === 'ALREADY_OPEN') {
        await ctx.reply(`ℹ️ Bu buyurtma bo‘yicha #${r.number} murojaat hali hal qilinmagan.`);
      } else if (r.result === 'UNAVAILABLE') {
        await ctx.reply('Qo‘llab-quvvatlash hozir mavjud emas. Keyinroq urinib ko‘ring.');
      } else if (r.result === 'LIMIT') {
        await ctx.reply('Sizda juda ko‘p ochiq murojaat bor. Avval ularning javobini kuting.');
      } else {
        await ctx.reply('Buyurtma topilmadi.');
      }
    } catch (err) {
      console.error('[SUPPORT CREATE]', err instanceof Error ? err.message : 'Unknown error');
      await ctx.reply('Murojaatni yuborib bo‘lmadi. Keyinroq qayta urinib ko‘ring.');
    }
  });

  // ---- admins ----
  bot.command('tickets', async ctx => {
    if (!ctx.from || ctx.chat?.type !== 'private') return;
    if (!isSupportAdmin(String(ctx.from.id))) { await ctx.reply('🚫 Ruxsat yo‘q.'); return; }
    const rows = await listActiveTickets(String(ctx.from.id));
    if (!rows.length) { await ctx.reply('Ochiq murojaatlar yo‘q.'); return; }
    await ctx.reply('🎫 Faol murojaatlar:', Markup.inlineKeyboard(rows.map(t => [Markup.button.callback(
      `#${t.number} • ${t.order ? `buyurtma #${t.order.code}` : "umumiy"} • ${t.status === 'OPEN' ? 'ochiq' : t.assignedAdminName ?? ''}`.slice(0, 60),
      `sup:view:${t.id}`)])));
  });

  bot.action(/^sup:(view|claim|resolve):([a-zA-Z0-9_-]+)$/, async ctx => {
    if (!ctx.from || ctx.chat?.type !== 'private') { await ctx.answerCbQuery(); return; }
    const actor = String(ctx.from.id);
    if (!isSupportAdmin(actor)) { await ctx.answerCbQuery('🚫 Ruxsat yo‘q', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    const verb = ctx.match[1]!;
    const ticketId = ctx.match[2]!;
    try {
      if (verb === 'view') {
        const t = await ticketForAdmin(actor, ticketId);
        if (!t) { await ctx.reply('⛔ Murojaat topilmadi.'); return; }
        const view = renderAdminTicket(t, actor);
        await ctx.reply(view.text, { parse_mode: 'HTML', reply_markup: view.reply_markup });
        return;
      }
      const callbackQueryId = ctx.callbackQuery.id;
      const r = verb === 'claim'
        ? await claimTicket({ actorTelegramId: actor, actorName: displayName(ctx), ticketId, callbackQueryId })
        : await resolveTicket({ actorTelegramId: actor, ticketId, callbackQueryId });
      const note = adminReply(r);
      if (note && r.result !== 'DONE') await ctx.reply(note);
      if (r.result !== 'DUPLICATE' && r.result !== 'NOT_FOUND') {
        await refreshAdminMessages(bot, ticketId);
        if (r.result === 'DONE') await deliverSupportNotifications(bot).catch(() => undefined);
      }
    } catch (err) {
      console.error('[SUPPORT ACTION]', err instanceof Error ? err.message : 'Unknown error');
      await ctx.reply('⚠️ Amal bajarilmadi. /tickets orqali yangilang.');
    }
  });

  // ---- Stage 3C: reply / reopen / reassign (admins) ----
  bot.action(/^sup:reply:([a-zA-Z0-9_-]+)$/, async ctx => {
    if (!ctx.from || ctx.chat?.type !== 'private') { await ctx.answerCbQuery(); return; }
    const actor = String(ctx.from.id);
    if (!isSupportAdmin(actor)) { await ctx.answerCbQuery('🚫 Ruxsat yo‘q', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    const t = await ticketForAdmin(actor, ctx.match[1]!);
    if (!t) { await ctx.reply('⛔ Murojaat topilmadi.'); return; }
    if (t.status !== 'IN_PROGRESS' || t.assignedAdminTelegramId !== actor) {
      await ctx.reply('⛔ Faqat murojaat egasi mijozga javob yoza oladi.'); return;
    }
    pending.set(actor, { kind: 'admin-reply', ticketId: t.id, expires: Date.now() + PENDING_MS });
    await ctx.reply(`💬 #${t.number} — mijozga javobingizni yozing. Tugatish: /cancel`);
  });

  bot.action(/^sup:(reopen|reassign):([a-zA-Z0-9_-]+)(?::(\d{1,20}))?$/, async ctx => {
    if (!ctx.from || ctx.chat?.type !== 'private') { await ctx.answerCbQuery(); return; }
    const actor = String(ctx.from.id);
    if (!isSupportAdmin(actor)) { await ctx.answerCbQuery('🚫 Ruxsat yo‘q', { show_alert: true }); return; }
    await ctx.answerCbQuery();
    const ticketId = ctx.match[2]!;
    const target = ctx.match[3];
    const callbackQueryId = ctx.callbackQuery.id;
    try {
      let r: TransitionResult;
      if (ctx.match[1] === 'reopen') {
        r = await reopenTicket({ actorTelegramId: actor, ticketId, callbackQueryId });
      } else {
        if (!target) { await ctx.reply('⛔ Noto‘g‘ri amal.'); return; }
        let name = displayName(ctx);
        if (target !== actor) {
          name = `Admin ${target}`;
          try {
            const chat = await bot.telegram.getChat(target);
            if (chat.type === 'private') name = [chat.first_name, chat.last_name].filter(Boolean).join(' ') || name;
          } catch { /* keep fallback name */ }
        }
        r = await reassignTicket({ actorTelegramId: actor, ticketId, targetTelegramId: target, targetName: name, callbackQueryId });
      }
      const note = transitionReply(r);
      if (note && r.result !== 'DONE') await ctx.reply(note);
      if (r.result === 'DONE') {
        await refreshAdminMessages(bot, ticketId);
        if (target && target !== actor) {
          await bot.telegram.sendMessage(target, '🔁 Sizga murojaat o‘tkazildi. Murojaat kartasi yangilandi.').catch(() => undefined);
        }
        await deliverSupportNotifications(bot).catch(() => undefined);
      } else if (r.result !== 'DUPLICATE' && r.result !== 'NOT_FOUND') {
        await refreshAdminMessages(bot, ticketId);
      }
    } catch (err) {
      console.error('[SUPPORT ACTION]', err instanceof Error ? err.message : 'Unknown error');
      await ctx.reply('⚠️ Amal bajarilmadi. /tickets orqali yangilang.');
    }
  });
}
