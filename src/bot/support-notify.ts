import { Markup, type Telegraf, type Context } from 'telegraf';
import { db } from '../lib/db.js';
import { supportAdminIds, ticketForAdmin, statusLabel, type AdminTicket } from '../modules/support/service.js';
import { MAX_DELIVERY_ATTEMPTS, SEND_LEASE_MS, retryDelayMs } from '../modules/support/conversation.js';

/** In-memory retry backoff for the Stage 3B sends (admin cards, resolved notices). Lost on restart, which only means one early retry. */
const backoff = new Map<string, { fails: number; next: number }>();
const ready = (key: string) => (backoff.get(key)?.next ?? 0) <= Date.now();
const failed = (key: string) => {
  const fails = (backoff.get(key)?.fails ?? 0) + 1;
  backoff.set(key, { fails, next: Date.now() + retryDelayMs(fails) });
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Per-admin message: the resolve button is shown only to the admin who owns the ticket. */
export function renderAdminTicket(t: AdminTicket, viewerTelegramId: string) {
  const lines = [
    `🎫 <b>Murojaat #${t.number}</b> — ${statusLabel(t.status)}`,
    `Buyurtma: #${t.order.code} (${escapeHtml(t.order.restaurant.name)}, ${escapeHtml(t.order.status)})`,
    `Mijoz: ${escapeHtml(t.customer.displayName ?? 'noma’lum')}, ${escapeHtml(t.customer.phone ?? 'telefon yo‘q')}`,
    '',
    escapeHtml(t.message),
  ];
  const keys = [];
  if (t.status === 'OPEN') {
    keys.push([Markup.button.callback('🙋 Men oldim', `sup:claim:${t.id}`)]);
  } else if (t.status === 'IN_PROGRESS') {
    lines.push('', `👤 Ishlayapti: <b>${escapeHtml(t.assignedAdminName ?? '')}</b>`);
    if (t.assignedAdminTelegramId === viewerTelegramId) {
      keys.push([Markup.button.callback('✅ Hal qilindi', `sup:resolve:${t.id}`),
        Markup.button.callback('💬 Javob yozish', `sup:reply:${t.id}`)]);
      for (const target of supportAdminIds().filter(a => a !== viewerTelegramId)) {
        keys.push([Markup.button.callback('🔁 Boshqa adminga o‘tkazish', `sup:reassign:${t.id}:${target}`)]);
      }
    } else {
      keys.push([Markup.button.callback('🔁 Menga o‘tkazish', `sup:reassign:${t.id}:${viewerTelegramId}`)]);
    }
  } else {
    lines.push('', `👤 Hal qildi: <b>${escapeHtml(t.assignedAdminName ?? '')}</b>`);
    keys.push([Markup.button.callback('♻️ Qayta ochish', `sup:reopen:${t.id}`)]);
  }
  return { text: lines.join('\n'), reply_markup: Markup.inlineKeyboard(keys).reply_markup };
}

/** Edits every admin's copy of the ticket so both always see the current owner. Best effort. */
export async function refreshAdminMessages<C extends Context>(bot: Telegraf<C>, ticketId: string): Promise<void> {
  const rows = await db.supportTicketNotification.findMany({ where: { ticketId } });
  for (const row of rows) {
    try {
      const t = await ticketForAdmin(row.adminTelegramId, ticketId);
      if (!t) continue;
      const view = renderAdminTicket(t, row.adminTelegramId);
      await bot.telegram.editMessageText(row.adminTelegramId, row.messageId, undefined, view.text,
        { parse_mode: 'HTML', reply_markup: view.reply_markup });
    } catch (err) {
      if (err instanceof Error && /message is not modified/i.test(err.message)) continue;
      console.error('[SUPPORT EDIT]', err instanceof Error ? err.message : 'Unknown error');
    }
  }
}

/** Sends missing admin notifications and pending resolved notices. Retried from persisted state. */
export async function deliverSupportNotifications<C extends Context>(bot: Telegraf<C>): Promise<void> {
  const admins = supportAdminIds();
  if (admins.length) {
    const active = await db.supportTicket.findMany({
      where: { status: { in: ['OPEN', 'IN_PROGRESS'] } }, orderBy: { createdAt: 'asc' }, take: 20,
      select: { id: true, notifications: { select: { adminTelegramId: true } } },
    });
    for (const ticket of active) {
      for (const admin of admins) {
        const key = `admin:${ticket.id}:${admin}`;
        if (ticket.notifications.some(n => n.adminTelegramId === admin) || !ready(key)) continue;
        try {
          const t = await ticketForAdmin(admin, ticket.id);
          if (!t) continue;
          const view = renderAdminTicket(t, admin);
          const sent = await bot.telegram.sendMessage(admin, view.text,
            { parse_mode: 'HTML', reply_markup: view.reply_markup });
          await db.supportTicketNotification.createMany({
            data: [{ ticketId: ticket.id, adminTelegramId: admin, messageId: sent.message_id }],
            skipDuplicates: true,
          });
          backoff.delete(key);
        } catch (err) {
          failed(key);
          console.error('[SUPPORT ADMIN NOTIFY]', err instanceof Error ? err.message : 'Unknown error');
        }
      }
    }
  }
  const resolved = await db.supportTicket.findMany({
    where: { status: 'RESOLVED', customerNotifiedAt: null }, orderBy: { resolvedAt: 'asc' }, take: 20,
    select: { id: true, number: true, customer: { select: { telegramUserId: true } }, order: { select: { code: true } } },
  });
  for (const t of resolved) {
    const key = `resolved:${t.id}`;
    if (!ready(key)) continue;
    try {
      // Claim the marker first: a crash after this point loses one notice rather than sending twice.
      const claimed = await db.supportTicket.updateMany({
        where: { id: t.id, customerNotifiedAt: null }, data: { customerNotifiedAt: new Date() },
      });
      if (claimed.count !== 1) continue;
      if (!t.customer.telegramUserId) continue; // unlinked Android guest: nobody to message (the marker stays claimed)
      try {
        await bot.telegram.sendMessage(t.customer.telegramUserId,
          `✅ Murojaatingiz #${t.number} (buyurtma #${t.order.code}) hal qilindi. Rahmat!`);
        backoff.delete(key);
      } catch (err) {
        await db.supportTicket.updateMany({ where: { id: t.id }, data: { customerNotifiedAt: null } });
        throw err;
      }
    } catch (err) {
      failed(key);
      console.error('[SUPPORT CUSTOMER NOTIFY]', err instanceof Error ? err.message : 'Unknown error');
    }
  }
  await deliverSupportMessages(bot);
}

function telegramCode(err: unknown): number | undefined {
  return (err as { response?: { error_code?: number } }).response?.error_code;
}

/** Delivers stored conversation messages. A message is leased (nextAttemptAt pushed out) before sending so
 *  overlapping workers do not both send it; failures back off exponentially and end in failedAt (dead letter).
 *  `onlyTicketIds` restricts the run (used by tests so they never touch real rows). */
export async function deliverSupportMessages<C extends Context>(bot: Telegraf<C>, onlyTicketIds?: string[]): Promise<void> {
  const due = await db.supportTicketMessage.findMany({
    where: { deliveredAt: null, failedAt: null, nextAttemptAt: { lte: new Date() },
      ...(onlyTicketIds ? { ticketId: { in: onlyTicketIds } } : {}) },
    orderBy: { createdAt: 'asc' }, take: 20,
    select: { id: true, senderType: true, senderTelegramId: true, text: true, deliveryAttempts: true,
      ticket: { select: { id: true, number: true, status: true, assignedAdminTelegramId: true,
        customer: { select: { telegramUserId: true } } } } },
  });
  for (const m of due) {
    const lease = await db.supportTicketMessage.updateMany({
      where: { id: m.id, deliveredAt: null, failedAt: null, nextAttemptAt: { lte: new Date() } },
      data: { nextAttemptAt: new Date(Date.now() + SEND_LEASE_MS) },
    });
    if (lease.count !== 1) continue;
    const t = m.ticket;
    const toCustomer = m.senderType === 'ADMIN';
    // Customer follow-ups go to the owner; an unclaimed ticket's follow-ups go to every admin.
    const targets = toCustomer ? (t.customer.telegramUserId ? [t.customer.telegramUserId] : [])
      : t.status === 'IN_PROGRESS' && t.assignedAdminTelegramId ? [t.assignedAdminTelegramId] : supportAdminIds();
    let delivered = 0;
    let lastErr: unknown = targets.length ? undefined : new Error('no recipients');
    for (const to of targets) {
      try {
        const body = toCustomer
          ? `💬 <b>Murojaat #${t.number}</b> — administrator javobi:

${escapeHtml(m.text)}`
          : `💬 <b>Murojaat #${t.number}</b> — mijoz yozdi:

${escapeHtml(m.text)}`;
        const button = toCustomer ? (t.status !== 'RESOLVED' ? Markup.button.callback('✍️ Javob yozish', `sup:cw:${t.id}`) : null)
          : to === t.assignedAdminTelegramId ? Markup.button.callback('💬 Javob yozish', `sup:reply:${t.id}`) : null;
        await bot.telegram.sendMessage(to, body, { parse_mode: 'HTML',
          ...(button ? { reply_markup: Markup.inlineKeyboard([[button]]).reply_markup } : {}) });
        delivered++;
      } catch (err) { lastErr = err; }
    }
    if (delivered > 0) { // at least one recipient has it; partial multi-admin failures are not re-sent
      await db.supportTicketMessage.update({
        where: { id: m.id }, data: { deliveredAt: new Date(), deliveryAttempts: m.deliveryAttempts + 1, lastError: null },
      });
      continue;
    }
    const attempts = m.deliveryAttempts + 1;
    const code = telegramCode(lastErr);
    const permanent = code === 403 || code === 400 || attempts >= MAX_DELIVERY_ATTEMPTS;
    const reason = (lastErr instanceof Error ? lastErr.message : 'Unknown error').slice(0, 200);
    console.error('[SUPPORT MESSAGE]', reason);
    await db.supportTicketMessage.update({
      where: { id: m.id },
      data: { deliveryAttempts: attempts, lastError: reason,
        ...(permanent ? { failedAt: new Date() } : { nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)) }) },
    });
    if (permanent && toCustomer) { // tell the writing admin; best effort
      await bot.telegram.sendMessage(m.senderTelegramId,
        `⚠️ Murojaat #${t.number}: javobingiz mijozga yetkazilmadi.`).catch(() => undefined);
    }
  }
}

export function startSupportNotifier<C extends Context>(bot: Telegraf<C>): () => void {
  const seconds = Number(process.env.SUPPORT_WORKER_INTERVAL_SECONDS ?? 5);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 300) {
    throw new Error('SUPPORT_WORKER_INTERVAL_SECONDS 1–300 oralig‘ida bo‘lsin');
  }
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await deliverSupportNotifications(bot); }
    catch (err) { console.error('[SUPPORT WORKER]', err instanceof Error ? err.message : 'Unknown error'); }
    finally { busy = false; }
  }, seconds * 1000);
  return () => clearInterval(timer);
}
