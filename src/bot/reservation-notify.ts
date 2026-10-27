import type { Telegraf } from 'telegraf';
import { db } from '../lib/db.js';
import { restaurantTelegramEnabled } from '../lib/features.js';
import { isDelivered, notificationKey, sendOnce } from '../lib/notify-once.js';

const money = (som: number): string => `${som.toLocaleString('en-US').replace(/,/g, ' ')} so‘m`;

/** Date and time in the restaurant's own zone, e.g. "28.10 19:30". */
export function reservationWhen(startsAt: Date, timezone: string): string {
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(startsAt);
    const get = (t: string): string => p.find(x => x.type === t)?.value ?? '';
    return `${get('day')}.${get('month')} ${get('hour')}:${get('minute')}`;
  } catch { return startsAt.toISOString().slice(0, 16).replace('T', ' '); }
}

export function renderReservationNotice(r: { code: string; startsAt: Date; partySize: number; depositSom: number; nameSnapshot: string | null; phoneSnapshot: string; note: string | null }, timezone: string): string {
  return [
    `🪑 Yangi bron #${r.code}: pul tushdi, joy band qilindi.`,
    `🕐 ${reservationWhen(r.startsAt, timezone)} • ${r.partySize} kishi`,
    `👤 ${r.nameSnapshot ?? 'Mijoz'} • ${r.phoneSnapshot}`,
    `💰 Oldindan to‘lov: ${money(r.depositSom)}`,
    ...(r.note ? [`📝 ${r.note}`] : []),
    'Muammo bo‘lsa, mijozga qo‘ng‘iroq qilib pulni qaytaring.',
  ].join('\n');
}

/**
 * "Money arrived and the table is booked" for the restaurant's linked Telegram staff, once per reservation (the restaurant app shows the same thing
 * from its own list). The marker is set when the message was delivered or when nobody is linked, so a row is never retried every cycle.
 */
export async function deliverReservationNotices(bot: Telegraf<any>, limit = 20): Promise<number> {
  const rows = await db.reservation.findMany({
    where: { status: 'PAID', restaurantNotifiedAt: null },
    orderBy: { paidAt: 'asc' }, take: limit,
    include: { restaurant: { select: { staffTelegramUserId: true, timezone: true } } },
  });
  let sent = 0;
  for (const r of rows) {
    const chat = r.restaurant.staffTelegramUserId;
    if (chat && restaurantTelegramEnabled()) {
      try {
        const outcome = await sendOnce(bot, { key: notificationKey('reservation-staff', r.id, 'PAID', chat), kind: 'reservation-staff', chatId: chat, text: renderReservationNotice(r, r.restaurant.timezone) });
        if (!isDelivered(outcome)) continue;
        sent++;
      } catch (err) {
        console.error(`[RESERVATION NOTICE] #${r.code}:`, err instanceof Error ? err.message : err);
        continue;
      }
    }
    await db.reservation.updateMany({ where: { id: r.id, restaurantNotifiedAt: null }, data: { restaurantNotifiedAt: new Date() } });
  }
  return sent;
}
