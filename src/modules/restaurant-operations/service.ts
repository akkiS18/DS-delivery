import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { isValidTimezone } from './hours.js';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const time = z.string().regex(HHMM);
const minutesOf = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

export const statusSchema = z.object({ isPaused: z.boolean() }).strict();
export const timezoneSchema = z.object({ timezone: z.string().min(3).max(64).refine(isValidTimezone, 'IANA time zone') }).strict();
export const prepSchema = z.object({ defaultPrepMinutes: z.number().int().min(5).max(120) }).strict();
const dayShape = z.object({ dayOfWeek: z.number().int().min(1).max(7), isOpen: z.boolean(), openTime: time, closeTime: time }).strict();
/** Exactly one entry per ISO weekday (1 = Monday .. 7 = Sunday). An open day must close after it opens. */
export const workingHoursSchema = z.object({
  days: z.array(dayShape).length(7),
}).strict().superRefine((v, ctx) => {
  const seen = new Set(v.days.map(d => d.dayOfWeek));
  if (seen.size !== 7) ctx.addIssue({ code: 'custom', message: 'each weekday exactly once' });
  v.days.forEach((d, i) => {
    if (d.isOpen && minutesOf(d.closeTime) <= minutesOf(d.openTime)) {
      ctx.addIssue({ code: 'custom', path: ['days', i, 'closeTime'], message: 'closeTime must be after openTime' });
    }
  });
});
export type WorkingDay = z.infer<typeof dayShape>;

export const DEFAULT_WORKING_DAYS: WorkingDay[] = [1, 2, 3, 4, 5, 6, 7].map(dayOfWeek => ({
  dayOfWeek, isOpen: true,
  openTime: dayOfWeek >= 6 ? '10:00' : '09:00',
  closeTime: dayOfWeek === 5 || dayOfWeek === 6 ? '23:00' : '22:00',
}));

/** Stored JSON is only ever written by workingHoursSchema; anything unreadable falls back to the defaults. */
function readDays(raw: Prisma.JsonValue | null): WorkingDay[] {
  const parsed = workingHoursSchema.safeParse({ days: raw });
  return parsed.success ? parsed.data.days.slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek) : DEFAULT_WORKING_DAYS;
}

const select = { isPaused: true, defaultPrepMinutes: true, workingHours: true, timezone: true } as const;
type Row = { isPaused: boolean; defaultPrepMinutes: number; workingHours: Prisma.JsonValue | null; timezone: string };
const view = (r: Row) => ({ isPaused: r.isPaused, defaultPrepMinutes: r.defaultPrepMinutes, workingDays: readDays(r.workingHours), timezone: r.timezone });

export async function getOperations(restaurantId: string) {
  return view(await db.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select }));
}

/** Idempotent set (not a toggle). Only Restaurant.isPaused changes: orders already accepted or in progress are not
 *  touched, while new checkouts and not-yet-accepted orders keep being refused by the existing isPaused checks. */
export async function setPaused(restaurantId: string, isPaused: boolean) {
  return view(await db.restaurant.update({ where: { id: restaurantId }, data: { isPaused }, select }));
}

export async function setWorkingHours(restaurantId: string, days: WorkingDay[]) {
  const sorted = days.slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  return view(await db.restaurant.update({ where: { id: restaurantId }, data: { workingHours: sorted }, select }));
}

export async function setTimezone(restaurantId: string, timezone: string) {
  return view(await db.restaurant.update({ where: { id: restaurantId }, data: { timezone }, select }));
}

export async function setDefaultPrep(restaurantId: string, defaultPrepMinutes: number) {
  return view(await db.restaurant.update({ where: { id: restaurantId }, data: { defaultPrepMinutes }, select }));
}
