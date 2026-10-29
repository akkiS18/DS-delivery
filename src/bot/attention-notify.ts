import type { Context, Telegraf } from 'telegraf';
import { notificationKey, sendOnce, type Sender } from '../lib/notify-once.js';
import { TELEGRAM_COPY_KINDS, computeAttention, type AttentionItem } from '../modules/admin-attention/service.js';
import { supportAdminIds } from '../modules/support/service.js';

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MAX_SENDS_PER_CYCLE = 10;

export function renderAttention(i: AttentionItem): string {
  const lines = [`🚨 <b>${escapeHtml(i.title)}</b>`];
  if (i.restaurant) lines.push(`🍽 ${escapeHtml(i.restaurant.name)}`);
  lines.push(escapeHtml(i.detail));
  if (i.restaurant?.phone) lines.push(`📞 ${escapeHtml(i.restaurant.phone)}`);
  return lines.join('\n');
}

/** Telegram copy of the "Diqqat" items that have no Telegram alert of their own. One message per item and administrator
 *  (the key holds the item's start time, so a later new problem of the same kind is announced again). A quiet-hours item
 *  below CRITICAL is delivered silently. Kill switch: ADMIN_ATTENTION_TELEGRAM=false. */
export async function deliverAttention(bot: Sender, now = new Date(), only?: (item: AttentionItem) => boolean): Promise<number> {
  const admins = supportAdminIds();
  if (!admins.length) return 0;
  const snap = await computeAttention(now);
  let sent = 0;
  for (const item of snap.items) {
    if (!TELEGRAM_COPY_KINDS.includes(item.kind) || item.acked || (only && !only(item))) continue;
    for (const admin of admins) {
      if (sent >= MAX_SENDS_PER_CYCLE) return sent;
      const key = notificationKey('attn', item.key, item.since ? Date.parse(item.since) : 0, admin);
      const silent = snap.quietActive && item.severity !== 'CRITICAL';
      const outcome = await sendOnce(bot, { key, kind: 'ADMIN_ATTENTION', chatId: admin, text: renderAttention(item),
        extra: { parse_mode: 'HTML', ...(silent ? { disable_notification: true } : {}) } }, now);
      if (outcome === 'SENT') sent++;
    }
  }
  return sent;
}

export function startAttentionNotifier<C extends Context>(bot: Telegraf<C>): () => void {
  if (process.env.ADMIN_ATTENTION_TELEGRAM?.trim().toLowerCase() === 'false') return () => undefined;
  const seconds = Number(process.env.ADMIN_ATTENTION_INTERVAL_SECONDS ?? 15);
  if (!Number.isSafeInteger(seconds) || seconds < 5 || seconds > 300) throw new Error('ADMIN_ATTENTION_INTERVAL_SECONDS 5–300 oralig‘ida bo‘lsin');
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await deliverAttention(bot as unknown as Sender); }
    catch (err) { console.error('[ADMIN ATTENTION]', err instanceof Error ? err.message : 'Unknown error'); }
    finally { busy = false; }
  }, seconds * 1000);
  return () => clearInterval(timer);
}
