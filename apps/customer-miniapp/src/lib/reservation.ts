import { t, T } from '../i18n';
import type { ReservationStatus, ReservationView } from './types';

/** Uzbekistan has no daylight saving: every restaurant's clock is UTC+5. */
const OFFSET = '+05:00';
const TZ = 'Asia/Tashkent';

/** The server refuses anything sooner than this (MIN_LEAD_MINUTES) or later than MAX_AHEAD_DAYS; the form uses the same bounds so most mistakes never reach it. */
export const MIN_LEAD_MINUTES = 60;
export const MAX_AHEAD_DAYS = 30;
export const MAX_PARTY = 30;

const pad = (n: number): string => String(n).padStart(2, '0');

/** A Date as the "YYYY-MM-DDTHH:mm" text a datetime-local input uses, read on the Tashkent clock. */
export function toLocalInput(d: Date): string {
  const t = new Date(d.getTime() + 5 * 3_600_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

/** The datetime-local text -> the ISO time with the offset the server asks for; null if the text is not a full date and time. */
export function localInputToIso(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const iso = `${v}:00${OFFSET}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** The earliest and latest times the form lets the customer pick, from the server's clock. */
export function bookingBounds(serverNowMs: number): { min: string; max: string } {
  return { min: toLocalInput(new Date(serverNowMs + MIN_LEAD_MINUTES * 60_000)), max: toLocalInput(new Date(serverNowMs + MAX_AHEAD_DAYS * 86_400_000)) };
}

/** null = the time is fine; otherwise what to tell the customer. */
export function checkWhen(v: string, serverNowMs: number): string | null {
  const iso = localInputToIso(v);
  if (!iso) return t('Sana va vaqtni tanlang.');
  const at = Date.parse(iso);
  if (at < serverNowMs + MIN_LEAD_MINUTES * 60_000) return t('Bron kamida {n} daqiqa oldin qilinadi.', { n: MIN_LEAD_MINUTES });
  if (at > serverNowMs + MAX_AHEAD_DAYS * 86_400_000) return t('Bron {n} kundan keyingi vaqtga qilinmaydi.', { n: MAX_AHEAD_DAYS });
  return null;
}

/** "28.10 19:30" on the Tashkent clock. */
export function whenText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const get = (t: string): string => p.find(x => x.type === t)?.value ?? '';
  return `${get('day')}.${get('month')} ${get('hour')}:${get('minute')}`;
}

const MONTHS_LC = [T('yanvar'), T('fevral'), T('mart'), T('aprel'), T('may'), T('iyun'), T('iyul'), T('avgust'), T('sentyabr'), T('oktyabr'), T('noyabr'), T('dekabr')];
const WEEKDAYS_LC = [T('yakshanba'), T('dushanba'), T('seshanba'), T('chorshanba'), T('payshanba'), T('juma'), T('shanba')]; // Date#getUTCDay order

/** The three ticket cells for a start time, on the Tashkent clock: "12-noyabr", "chorshanba", "19:00". Empty strings for a broken date. */
export function ticketWhen(iso: string): { day: string; weekday: string; time: string } {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return { day: '', weekday: '', time: '' };
  const d = new Date(ms + 5 * 3_600_000); // UTC+5, no daylight saving
  return {
    day: t('{day}-{month}', { day: d.getUTCDate(), month: t(MONTHS_LC[d.getUTCMonth()] ?? '') }),
    weekday: t(WEEKDAYS_LC[d.getUTCDay()] ?? ''),
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

/** Shown through t(STATUS_LABEL[status]). */
export const STATUS_LABEL: Record<ReservationStatus, string> = {
  PENDING_PAYMENT: T('To‘lov kutilmoqda'),
  PAID: T('Joy band qilindi'),
  EXPIRED: T('To‘lov muddati tugadi'),
  CANCELLED: T('Bekor qilindi'),
};

/** A reservation the customer still has to act on or wait for: keeps being polled. */
export const isOpenReservation = (r: Pick<ReservationView, 'status'>): boolean => r.status === 'PENDING_PAYMENT';

/** Upcoming first (soonest on top), the rest by newest. A finished or cancelled booking never counts as upcoming. */
export function splitReservations(list: ReservationView[], nowMs: number): { upcoming: ReservationView[]; past: ReservationView[] } {
  const live = (r: ReservationView): boolean => (r.status === 'PAID' || r.status === 'PENDING_PAYMENT') && Date.parse(r.startsAt) >= nowMs - 2 * 3_600_000;
  return {
    upcoming: list.filter(live).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
    past: list.filter(r => !live(r)).sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt)),
  };
}

/** What the backend's refusal means for the customer. Nothing was charged for any of these. */
export function describeReservationError(code: string | undefined, status = 0): string {
  switch (code) {
    case 'BRON_YOPIQ': return t('Bu restoran hozir joy bron qilmayapti.');
    case 'BRON_VAQTI_JUDA_YAQIN': return t('Bron kamida {n} daqiqa oldin qilinadi. Keyinroq vaqt tanlang.', { n: MIN_LEAD_MINUTES });
    case 'BRON_VAQTI_JUDA_UZOQ': return t('Bron {n} kundan keyingi vaqtga qilinmaydi.', { n: MAX_AHEAD_DAYS });
    case 'RESTORAN_SHU_VAQTDA_YOPIQ': return t('Restoran bu vaqtda ishlamaydi. Ish vaqtidagi vaqtni tanlang.');
    case 'BRON_ALLAQACHON_BOR': return t('Bu vaqtga sizda bron bor.');
    case 'KOP_TOLANMAGAN_BRON': return t('To‘lanmagan bronlaringiz bor. Avval ularni to‘lang yoki muddati tugashini kuting.');
    case 'BRON_SUMMASI_OZGARDI': return t('Bron to‘lovi o‘zgargan. Sahifani yangilab, qayta urinib ko‘ring.');
    case 'KARTA_YOQ':
    case 'RESTORAN_TOLOV_QABUL_QILMAYDI': return t('Restoran hozircha to‘lov qabul qila olmaydi. Keyinroq urinib ko‘ring; pul olinmadi.');
    case 'TOLOV_YOPIQ': return t('To‘lov qabul qilish hozircha yopiq. Keyinroq urinib ko‘ring; pul olinmadi.');
    case 'PHONE_REQUIRED': return t('Telefon raqamini kiriting.');
    default:
      if (status === 429) return t('Biroz kuting va qayta urinib ko‘ring.');
      if (status === 0) return t('Internet bilan aloqa yo‘q. Qayta urinib ko‘ring.');
      return t('Bronni yaratib bo‘lmadi. Qayta urinib ko‘ring; pul olinmadi.');
  }
}
