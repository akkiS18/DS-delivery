import { T, t } from '../i18n';
import { clock } from './format';
import type { CustomerStage } from './types';

const TZ = 'Asia/Tashkent';
const MONTHS = [T('Yanvar'), T('Fevral'), T('Mart'), T('Aprel'), T('May'), T('Iyun'), T('Iyul'), T('Avgust'), T('Sentyabr'), T('Oktyabr'), T('Noyabr'), T('Dekabr')];
const DAY = 86_400_000;

/** "2026-11-11" in the restaurant's time zone: orders are grouped by the day the customer lived, not by UTC. */
const dayKey = (ms: number): string => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

export type HistoryFilter = 'ALL' | 'DELIVERED' | 'CANCELLED';

/** Delivered / "Bekor qilingan" (cancelled and expired both count as not delivered). */
export const matchesFilter = (stage: CustomerStage, f: HistoryFilter): boolean =>
  f === 'ALL' ? true : f === 'DELIVERED' ? stage === 'DELIVERED' : stage === 'CANCELLED' || stage === 'EXPIRED';

/** "Bugun, 19:10" / "Kecha, 19:10" / "08.11, 13:40". */
export function dayText(iso: string, nowMs: number): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const k = dayKey(ms);
  const time = clock(iso);
  if (k === dayKey(nowMs)) return `${t('Bugun')}, ${time}`;
  if (k === dayKey(nowMs - DAY)) return `${t('Kecha')}, ${time}`;
  const [, m, d] = k.split('-');
  return `${d}.${m}, ${time}`;
}

/** The heading an order sits under: the last 7 days together, then one heading per month (with the year once it is not this year). */
export function periodOf(iso: string, nowMs: number): { key: string; label: string } {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms) || nowMs - ms < 7 * DAY) return { key: 'week', label: t('Shu hafta') };
  const [y, m] = dayKey(ms).split('-');
  const thisYear = dayKey(nowMs).split('-')[0];
  const name = t(MONTHS[Number(m) - 1] ?? '');
  return { key: `${y}-${m}`, label: y === thisYear ? name : `${name} ${y}` };
}

/** Newest first; consecutive orders with the same period share one group. */
export function groupByPeriod<O extends { createdAt: string }>(list: readonly O[], nowMs: number): Array<{ key: string; label: string; items: O[] }> {
  const sorted = [...list].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const out: Array<{ key: string; label: string; items: O[] }> = [];
  for (const o of sorted) {
    const p = periodOf(o.createdAt, nowMs);
    const last = out[out.length - 1];
    if (last && last.key === p.key) last.items.push(o); else out.push({ ...p, items: [o] });
  }
  return out;
}

/** Orders placed this calendar month. */
export function countThisMonth(list: ReadonlyArray<{ createdAt: string }>, nowMs: number): number {
  const month = dayKey(nowMs).slice(0, 7);
  return list.filter(o => { const ms = Date.parse(o.createdAt); return !Number.isNaN(ms) && dayKey(ms).slice(0, 7) === month; }).length;
}

/** The restaurant the customer received food from most often (ties: the more recent order wins); null without a delivered order. */
export function topRestaurant(list: ReadonlyArray<{ restaurantName: string; stage: CustomerStage; createdAt: string }>): string | null {
  const counts = new Map<string, { n: number; last: number }>();
  for (const o of list) {
    if (o.stage !== 'DELIVERED') continue;
    const c = counts.get(o.restaurantName) ?? { n: 0, last: 0 };
    counts.set(o.restaurantName, { n: c.n + 1, last: Math.max(c.last, Date.parse(o.createdAt) || 0) });
  }
  let best: string | null = null;
  let bestV = { n: 0, last: 0 };
  for (const [name, v] of counts) if (v.n > bestV.n || (v.n === bestV.n && v.last > bestV.last)) { best = name; bestV = v; }
  return best;
}
