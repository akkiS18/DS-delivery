import type { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';
import { isSupportAdmin } from '../support/service.js';
import { publicRating, rankingScore, ratingConfig } from './score.js';

/**
 * A customer rates the FOOD / restaurant of one delivered order (not the taxi). Rules (owner decisions 2026-10-26):
 * the app asks nothing at "Ha, oldim"; the card in the orders list offers the stars; 24 hours after the delivery to give or change the rating;
 * 1-3 stars may carry quick reasons and a short note that only the restaurant and the platform admins see; one rating per order.
 */
export const RATE_WINDOW_MS = 24 * 60 * 60_000;
export const NOTE_MAX = 200;
export const RATING_REASONS = ['COLD', 'TASTELESS', 'WRONG_ITEM', 'PACKAGING', 'LATE_COOKING', 'OTHER'] as const;
export type RatingReason = (typeof RATING_REASONS)[number];
export const REASON_LABEL: Record<RatingReason, string> = {
  COLD: 'Sovuq edi', TASTELESS: 'Mazasiz', WRONG_ITEM: 'Noto‘g‘ri taom', PACKAGING: 'Qadoq', LATE_COOKING: 'Kech tayyorlandi', OTHER: 'Boshqa',
};
export const RANKING_KEY = 'rating_ranking_enabled';

type Tx = Prisma.TransactionClient | typeof db;

/** When the delivery counts from: the operator-confirmed time, else the customer's own "received", else (a completed order without either) its last update. */
export function ratingWindow(input: { stage: string; deliveredAt: Date | null; receivedAt: Date | null; completedAt: Date }, now: Date): { canRate: boolean; until: Date | null } {
  if (input.stage !== 'DELIVERED') return { canRate: false, until: null };
  const from = input.deliveredAt ?? input.receivedAt ?? input.completedAt;
  const until = new Date(from.getTime() + RATE_WINDOW_MS);
  return { canRate: now.getTime() <= until.getTime(), until };
}

export type RateResult = { result: 'SAVED'; created: boolean } | { result: 'NOT_FOUND' } | { result: 'NOT_ALLOWED' } | { result: 'CLOSED' };

export interface RateInput {
  customerId: string; orderId: string; stars: number; reasons?: readonly string[]; note?: string | null | undefined;
}

/** Saves (or changes) the rating. `window` is decided by the caller from the same order row; the order must belong to the customer
 *  (a foreign and an unknown id look the same) and must be delivered. */
export async function rateOrder(input: RateInput, window: { canRate: boolean }, tx: Tx = db): Promise<RateResult> {
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) throw new Error('BAHO_NOTOGRI');
  const order = await tx.order.findFirst({ where: { id: input.orderId, customerId: input.customerId }, select: { id: true, restaurantId: true, status: true } });
  if (!order) return { result: 'NOT_FOUND' };
  if (order.status !== 'COMPLETED') return { result: 'NOT_ALLOWED' };
  if (!window.canRate) return { result: 'CLOSED' };
  const low = input.stars <= 3;
  const reasons = low ? [...new Set((input.reasons ?? []).filter((r): r is RatingReason => (RATING_REASONS as readonly string[]).includes(r)))] : [];
  const note = input.note?.trim() ? input.note.trim().slice(0, NOTE_MAX) : null;
  const before = await tx.orderRating.findUnique({ where: { orderId: order.id }, select: { id: true } });
  await tx.orderRating.upsert({
    where: { orderId: order.id },
    create: { orderId: order.id, restaurantId: order.restaurantId, customerId: input.customerId, stars: input.stars, reasons, note },
    update: { stars: input.stars, reasons, note },
  });
  return { result: 'SAVED', created: before === null };
}

/** Public numbers for a list of restaurants: { avg, count } only once enough people rated. One query. */
export async function publicRatings(restaurantIds: readonly string[], tx: Tx = db): Promise<Map<string, { avg: number; count: number }>> {
  const out = new Map<string, { avg: number; count: number }>();
  if (!restaurantIds.length) return out;
  const cfg = ratingConfig();
  const rows = await tx.orderRating.groupBy({ by: ['restaurantId'], where: { restaurantId: { in: [...restaurantIds] } }, _sum: { stars: true }, _count: { _all: true } });
  for (const r of rows) {
    const p = publicRating(r._sum.stars ?? 0, r._count._all, cfg);
    if (p) out.set(r.restaurantId, p);
  }
  return out;
}

export async function rankingEnabled(tx: Tx = db): Promise<boolean> {
  return (await tx.platformSetting.findUnique({ where: { key: RANKING_KEY }, select: { value: true } }))?.value === 'true';
}

export async function setRankingEnabled(input: { adminId: string; enabled: boolean }): Promise<'CHANGED' | 'UNCHANGED'> {
  if (!isSupportAdmin(input.adminId)) throw new Error('ADMIN_RUXSAT_YOQ');
  return db.$transaction(async tx => {
    const before = await rankingEnabled(tx);
    if (before === input.enabled) return 'UNCHANGED' as const;
    await tx.platformSetting.upsert({ where: { key: RANKING_KEY }, create: { key: RANKING_KEY, value: String(input.enabled), updatedBy: input.adminId }, update: { value: String(input.enabled), updatedBy: input.adminId } });
    await tx.adminAuditEvent.create({ data: { actorId: input.adminId, action: 'RATING_RANKING_CHANGED', targetType: 'PlatformSetting', targetId: RANKING_KEY, details: { previous: before, enabled: input.enabled } } });
    return 'CHANGED' as const;
  });
}

/** Ranking scores for the given restaurants (recent ratings only: older than ~6 half-lives weigh under 2%). */
export async function rankingScores(restaurantIds: readonly string[], now = new Date(), tx: Tx = db): Promise<Map<string, number>> {
  const cfg = ratingConfig();
  const since = new Date(now.getTime() - cfg.halfLifeDays * 6 * 86_400_000);
  const rows = restaurantIds.length
    ? await tx.orderRating.findMany({ where: { restaurantId: { in: [...restaurantIds] }, createdAt: { gte: since } }, select: { restaurantId: true, stars: true, createdAt: true }, take: 20000 })
    : [];
  const by = new Map<string, Array<{ stars: number; createdAt: Date }>>();
  for (const r of rows) {
    const list = by.get(r.restaurantId) ?? [];
    list.push(r);
    by.set(r.restaurantId, list);
  }
  return new Map(restaurantIds.map(id => [id, rankingScore(by.get(id) ?? [], now, cfg)]));
}

export interface RestaurantRatingReport {
  count: number; avg: number | null; last30: { count: number; avg: number | null };
  stars: Record<1 | 2 | 3 | 4 | 5, number>; reasons: Record<RatingReason, number>;
  recent: Array<{ stars: number; reasons: string[]; note: string | null; at: string }>;
}

/** What the restaurant itself sees: its numbers, the reason tags, and the latest low ratings with their notes. No customer identity. */
export async function restaurantReport(restaurantId: string, now = new Date(), tx: Tx = db): Promise<RestaurantRatingReport> {
  const rows = await tx.orderRating.findMany({
    where: { restaurantId }, orderBy: { createdAt: 'desc' }, take: 1000, select: { stars: true, reasons: true, note: true, createdAt: true },
  });
  const mean = (xs: number[]): number | null => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const month = rows.filter(r => now.getTime() - r.createdAt.getTime() <= 30 * 86_400_000);
  const stars = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const reasons = Object.fromEntries(RATING_REASONS.map(r => [r, 0])) as Record<RatingReason, number>;
  for (const r of rows) {
    stars[r.stars as 1 | 2 | 3 | 4 | 5]++;
    for (const t of r.reasons) if (t in reasons) reasons[t as RatingReason]++;
  }
  return {
    count: rows.length, avg: mean(rows.map(r => r.stars)), last30: { count: month.length, avg: mean(month.map(r => r.stars)) }, stars, reasons,
    recent: rows.filter(r => r.stars <= 3 || r.note).slice(0, 20).map(r => ({ stars: r.stars, reasons: r.reasons, note: r.note, at: r.createdAt.toISOString() })),
  };
}

export interface PlatformRatingsOverview {
  rankingOn: boolean;
  restaurants: Array<{ name: string; slug: string; count: number; avg: number | null; last30: { count: number; avg: number | null }; score: number }>;
  lowRecent: Array<{ restaurant: string; stars: number; reasons: string[]; note: string | null; at: string }>;
}

/** For the platform admins (Telegram /ratings): every restaurant that has ratings, with the ranking score, and the newest low ratings. */
export async function platformRatingsOverview(admin: { adminId: string }, now = new Date()): Promise<PlatformRatingsOverview> {
  if (!isSupportAdmin(admin.adminId)) throw new Error('ADMIN_RUXSAT_YOQ');
  const rows = await db.orderRating.findMany({
    orderBy: { createdAt: 'desc' }, take: 5000,
    select: { stars: true, reasons: true, note: true, createdAt: true, restaurant: { select: { id: true, name: true, slug: true } } },
  });
  const cfg = ratingConfig();
  const by = new Map<string, { name: string; slug: string; rows: typeof rows }>();
  for (const r of rows) {
    const e = by.get(r.restaurant.id) ?? { name: r.restaurant.name, slug: r.restaurant.slug, rows: [] };
    e.rows.push(r);
    by.set(r.restaurant.id, e);
  }
  const mean = (xs: number[]): number | null => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const restaurants = [...by.values()].map(e => {
    const month = e.rows.filter(r => now.getTime() - r.createdAt.getTime() <= 30 * 86_400_000);
    return {
      name: e.name, slug: e.slug, count: e.rows.length, avg: mean(e.rows.map(r => r.stars)), last30: { count: month.length, avg: mean(month.map(r => r.stars)) },
      score: Math.round(rankingScore(e.rows, now, cfg) * 100) / 100,
    };
  }).sort((a, b) => b.score - a.score);
  return {
    rankingOn: await rankingEnabled(), restaurants,
    lowRecent: rows.filter(r => r.stars <= 3).slice(0, 8).map(r => ({ restaurant: r.restaurant.name, stars: r.stars, reasons: r.reasons, note: r.note, at: r.createdAt.toISOString() })),
  };
}
