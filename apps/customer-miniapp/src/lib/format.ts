import type { OpensNext } from './types';

const nf = new Intl.NumberFormat('uz-UZ');
/** 45000 -> "45 000 so‘m" (uz-UZ groups with a no-break space on some engines; normalise to a plain space). */
export const som = (n: number): string => `${nf.format(n).replace(/[  ]/g, ' ')} so‘m`;

const TZ = 'Asia/Tashkent';
export const clock = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('uz-UZ', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
};

const DAYS = ['', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];
export function opensText(next: OpensNext | null): string {
  if (!next) return 'Hozir yopiq';
  const when = next.dayOffset === 0 ? 'Bugun' : next.dayOffset === 1 ? 'Ertaga' : (DAYS[next.dayOfWeek] ?? '');
  return `${when} ${next.time} da ochiladi`;
}

export const mmss = (totalSeconds: number): string => {
  const s = Math.abs(Math.trunc(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const newKey = (): string => {
  const c: Crypto = globalThis.crypto;
  if (typeof (c as Partial<Crypto>).randomUUID === 'function') return c.randomUUID();
  // very old webviews: RFC 4122 v4 from getRandomValues
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
