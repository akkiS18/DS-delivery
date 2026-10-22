import { Markup, type Context, type Telegraf } from 'telegraf';
import { isSupportAdmin, supportAdminIds } from '../modules/support/service.js';
import { cardForAdmin, cardsForAdmin, decideCard, groupCard, markAnnounced, unannouncedPending, type CardStatus } from '../modules/restaurant-cards/service.js';

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const STATUS: Record<CardStatus, string> = { PENDING: '⏳ tasdiq kutmoqda', ACTIVE: '✅ faol', DISABLED: '⏸ o‘chirilgan', REJECTED: '❌ rad etilgan' };

type Sender = { telegram: { sendMessage(chatId: string, text: string, extra?: object): Promise<unknown> } };

/** The administrator's view of one pending card: the FULL number (restaurants only ever see a masked one) to compare by phone. */
export async function renderPendingCard(cardId: string): Promise<{ text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> } | null> {
  const c = await cardForAdmin(cardId);
  if (!c || c.status !== 'PENDING' || !c.number) return null;
  const text = [
    '💳 <b>Yangi to‘lov kartasi tasdig‘i</b>',
    `Restoran: <b>${escapeHtml(c.restaurant?.name ?? '—')}</b>${c.restaurant?.pickupPhone ? ` (${escapeHtml(c.restaurant.pickupPhone)})` : ''}`,
    `Karta: <code>${groupCard(c.number)}</code>`,
    '',
    '⚠️ Mijozlarning puli shu kartaga tushadi. Restoran egasiga qo‘ng‘iroq qilib, karta aynan restoranniki ekanini tasdiqlang. Ishonchingiz komil bo‘lmasa rad eting.',
  ].join('\n');
  return { text, keyboard: Markup.inlineKeyboard([[Markup.button.callback('✅ Tasdiqlash', `card:ask:${c.id}`), Markup.button.callback('❌ Rad etish', `card:no:${c.id}`)]]) };
}

/** Sends new pending cards to every support admin; a card is marked announced once at least one admin received it. */
export async function announcePendingCards(bot: Sender, log: (line: string) => void = console.error): Promise<number> {
  let admins: string[] = [];
  try { admins = supportAdminIds(); } catch { admins = []; }
  const rows = await unannouncedPending();
  if (!rows.length) return 0;
  if (!admins.length) { log('[CARD ADMIN] pending cards exist but no SUPPORT_ADMIN_*_TELEGRAM_ID is configured'); return 0; }
  let sent = 0;
  for (const { id } of rows) {
    const view = await renderPendingCard(id);
    if (!view) { await markAnnounced(id); continue; }
    let ok = 0;
    for (const admin of admins) {
      try { await bot.telegram.sendMessage(admin, view.text, { parse_mode: 'HTML', reply_markup: view.keyboard.reply_markup }); ok++; }
      catch (err) { log(`[CARD ADMIN] send failed: ${err instanceof Error ? err.message.slice(0, 100) : 'error'}`); }
    }
    if (ok > 0) { await markAnnounced(id); sent++; }
  }
  return sent;
}

/** Background loop (every 10 s). Messages are DB-backed: a restart only delays them. */
export function startCardApprovalNotifier(bot: Sender, intervalMs = 10_000): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await announcePendingCards(bot); } catch (err) { console.error('[CARD ADMIN]', err instanceof Error ? err.message : 'error'); }
    finally { busy = false; }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  void tick();
  return () => clearInterval(timer);
}

export function registerCardAdminHandlers<C extends Context>(bot: Telegraf<C>): void {
  const admin = (ctx: Context): string | null => {
    if (!ctx.from || ctx.chat?.type !== 'private') return null;
    try { return isSupportAdmin(String(ctx.from.id)) ? String(ctx.from.id) : null; } catch { return null; }
  };

  // /cards: overview of every real card and a fresh copy of each pending one (in case an announcement was missed).
  bot.command('cards', async ctx => {
    if (!admin(ctx)) return; // silent for everybody else
    const rows = await cardsForAdmin(30);
    if (!rows.length) { await ctx.reply('Kartalar yo‘q.'); return; }
    await ctx.reply(['💳 <b>Restoran kartalari</b>', ...rows.map(r => `${escapeHtml(r.restaurant)} • ***${r.last4} • ${STATUS[r.status]}${r.hasNumber ? '' : ' • (eski: raqam sozlamada)'}`)].join('\n'), { parse_mode: 'HTML' });
    for (const r of rows.filter(x => x.status === 'PENDING')) {
      const v = await renderPendingCard(r.id);
      if (v) await ctx.reply(v.text, { parse_mode: 'HTML', reply_markup: v.keyboard.reply_markup });
    }
  });

  const finish = async (ctx: Context, adminId: string, cardId: string, decision: 'APPROVE' | 'REJECT') => {
    const r = await decideCard({ cardId, adminId, decision });
    const edit = (text: string) => ctx.editMessageText(text).catch(() => ctx.reply(text));
    if (r.result === 'APPROVED') await edit(`✅ Karta ***${r.card.last4} tasdiqlandi. Endi mijozlarga beriladi.`);
    else if (r.result === 'REJECTED') await edit(`❌ Karta ***${r.card.last4} rad etildi.`);
    else if (r.result === 'ALREADY_DECIDED') await edit(`Bu karta allaqachon hal qilingan (${r.status ? STATUS[r.status] : '—'}).`);
    else await edit('Karta topilmadi.');
  };

  bot.action(/^card:(ask|yes|no|back):([a-zA-Z0-9_-]{1,40})$/, async ctx => {
    await ctx.answerCbQuery().catch(() => undefined);
    const adminId = admin(ctx);
    if (!adminId) return;
    const [, action, id] = ctx.match as unknown as [string, 'ask' | 'yes' | 'no' | 'back', string];
    if (action === 'ask') {
      // Approval is a deliberate two-step action: a stray tap must not send customers' money to a card.
      await ctx.editMessageReplyMarkup(Markup.inlineKeyboard([[Markup.button.callback('✅ Ha, aniq tasdiqlayman', `card:yes:${id}`), Markup.button.callback('⬅️ Orqaga', `card:back:${id}`)]]).reply_markup).catch(() => undefined);
    } else if (action === 'back') {
      const v = await renderPendingCard(id);
      if (v) await ctx.editMessageReplyMarkup(v.keyboard.reply_markup).catch(() => undefined);
    } else await finish(ctx, adminId, id, action === 'yes' ? 'APPROVE' : 'REJECT');
  });
}
