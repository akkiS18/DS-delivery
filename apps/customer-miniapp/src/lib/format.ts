import { t, T } from '../i18n';
import type { OpensNext } from './types';

/** 45000 -> "45 000 so‘m" / "45 000 сум". Grouped by hand (a plain space), so every webview prints it the same way. */
export const som = (n: number): string => `${String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ${t('so‘m')}`;

const TZ = 'Asia/Tashkent';
export const clock = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
};

const DAYS = ['', T('Dushanba'), T('Seshanba'), T('Chorshanba'), T('Payshanba'), T('Juma'), T('Shanba'), T('Yakshanba')];
export function opensText(next: OpensNext | null): string {
  if (!next) return t('Hozir yopiq');
  const when = next.dayOffset === 0 ? t('Bugun') : next.dayOffset === 1 ? t('Ertaga') : t(DAYS[next.dayOfWeek] ?? '');
  return t('{when} {time} da ochiladi', { when, time: next.time });
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
