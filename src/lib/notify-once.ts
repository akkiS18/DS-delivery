import { db } from './db.js';

/**
 * Durable "one logical notification per recipient chat and event".
 *
 * Why this exists (order #645): the same Telegram account was both the customer and the restaurant staff, and the taxi
 * outcome notifier sent the SAME event text to both roles, so one chat received it twice although the order changed state
 * exactly once. Any key that names the event and the destination CHAT (not the role) removes that, and because the key is
 * a unique database row it also holds across concurrent workers, retries and restarts.
 *
 * Protocol per key: insert (unique) -> claim with a short lease (compare-and-swap) -> send -> mark sent.
 *  - SENT / ALREADY_SENT : delivered; the caller may set its own "notified" marker.
 *  - IN_FLIGHT           : another worker holds the lease; do nothing, try again next cycle.
 *  - FAILED              : Telegram call failed; the lease is released so the next cycle retries.
 *  - GAVE_UP             : too many failures (e.g. the user blocked the bot); caller should stop retrying.
 * Telegram cannot guarantee exactly-once end to end: a crash between a successful send and the `sentAt` write can repeat a
 * message once after the lease expires. That window is the strongest guarantee available without Telegram support.
 */
export const LEASE_MS = 60_000;
export const MAX_ATTEMPTS = 8;

export type NotifyOutcome = 'SENT' | 'ALREADY_SENT' | 'IN_FLIGHT' | 'FAILED' | 'GAVE_UP';
export interface Sender { telegram: { sendMessage: (chatId: string, text: string, extra?: never) => Promise<{ message_id: number }> } }

export const notificationKey = (kind: string, ...parts: Array<string | number>): string => [kind, ...parts].join(':');
export const isDelivered = (o: NotifyOutcome): boolean => o === 'SENT' || o === 'ALREADY_SENT' || o === 'GAVE_UP';

export async function sendOnce(
  bot: Sender,
  input: { key: string; kind: string; chatId: string; text: string; orderId?: string; extra?: unknown },
  now = new Date(),
): Promise<NotifyOutcome> {
  await db.notificationLog.createMany({
    data: [{ dedupeKey: input.key, kind: input.kind, chatId: input.chatId, orderId: input.orderId ?? null }],
    skipDuplicates: true,
  });
  const claimed = await db.notificationLog.updateMany({
    where: {
      dedupeKey: input.key, sentAt: null, attempts: { lt: MAX_ATTEMPTS },
      OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - LEASE_MS) } }],
    },
    data: { claimedAt: now, attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) {
    const row = await db.notificationLog.findUniqueOrThrow({ where: { dedupeKey: input.key }, select: { sentAt: true, attempts: true } });
    if (row.sentAt) return 'ALREADY_SENT';
    return row.attempts >= MAX_ATTEMPTS ? 'GAVE_UP' : 'IN_FLIGHT';
  }
  try {
    const message = await bot.telegram.sendMessage(input.chatId, input.text, input.extra as never);
    await db.notificationLog.updateMany({
      where: { dedupeKey: input.key, sentAt: null },
      data: { sentAt: new Date(), telegramMessageId: message.message_id, claimedAt: null, lastError: null },
    });
    return 'SENT';
  } catch (err) {
    await db.notificationLog.updateMany({
      where: { dedupeKey: input.key, sentAt: null },
      data: { claimedAt: null, lastError: (err instanceof Error ? err.message : 'unknown').slice(0, 300) },
    });
    return 'FAILED';
  }
}
