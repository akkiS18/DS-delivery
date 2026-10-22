import type { Prisma } from '@prisma/client';
import { workingHoursSchema, type WorkingDay } from './service.js';

/**
 * Is a restaurant open for NEW checkouts right now? Evaluated in the restaurant's own IANA time zone, never the server's or the
 * customer's. A restaurant that never configured working hours (null) is treated as always open; a configured weekly schedule is
 * enforced: open on a day means openTime <= local time < closeTime. Orders already placed are never affected by closing time.
 */
export const DEFAULT_TIMEZONE = 'Asia/Tashkent';
const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function isValidTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** ISO weekday (1 = Monday) and minutes since local midnight in [timezone] at [now]. */
export function localTime(now: Date, timezone: string): { dayOfWeek: number; minutes: number } {
  const tz = isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return { dayOfWeek: WEEKDAY[get('weekday')] ?? 1, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const toMinutes = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

export type OpenState =
  | { open: true }
  | { open: false; reason: 'HOURS'; opensNext: { dayOffset: number; dayOfWeek: number; time: string } | null };

export function openState(row: { workingHours: Prisma.JsonValue | null; timezone: string }, now = new Date()): OpenState {
  if (row.workingHours === null || row.workingHours === undefined) return { open: true };
  const parsed = workingHoursSchema.safeParse({ days: row.workingHours });
  if (!parsed.success) return { open: true }; // unreadable schedule never silently locks customers out; operations API only ever writes valid ones
  const days = new Map<number, WorkingDay>(parsed.data.days.map(d => [d.dayOfWeek, d]));
  const { dayOfWeek, minutes } = localTime(now, row.timezone);
  const today = days.get(dayOfWeek);
  if (today?.isOpen && toMinutes(today.openTime) <= minutes && minutes < toMinutes(today.closeTime)) return { open: true };
  for (let offset = 0; offset < 8; offset++) {
    const dow = ((dayOfWeek - 1 + offset) % 7) + 1;
    const d = days.get(dow);
    if (!d?.isOpen) continue;
    if (offset === 0 && toMinutes(d.openTime) <= minutes) continue; // today's slot already ended
    return { open: false, reason: 'HOURS', opensNext: { dayOffset: offset, dayOfWeek: dow, time: d.openTime } };
  }
  return { open: false, reason: 'HOURS', opensNext: null };
}
