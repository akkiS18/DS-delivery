import { db } from '../../lib/db.js';
import { commissionStatements } from '../commission/settlement.js';
import { listUnhandledReviews } from '../payment/review.js';

/**
 * DS Admin home screen: today's numbers. READ-ONLY (no money, no state is changed) and derived from the database on every call.
 * "Today" is the Asia/Tashkent calendar day (UTC+5, no DST). Only REAL orders count: created through the apps/bot and not test payments
 * (the same rule as the "Diqqat" list).
 */
export const DELIVERED = ['COMPLETED', 'DELIVERY_ASSUMED'] as const;
export const CANCELLED = ['CUSTOMER_CANCELLED', 'RESTAURANT_REJECTED', 'RESTAURANT_EXPIRED', 'PAYMENT_EXPIRED', 'CANCELLED', 'FAILED'] as const;
/** Statuses after the payment was accepted and before any cancellation: the order's money counts as today's revenue. */
export const PAID = ['PAYMENT_CONFIRMED', 'ACCEPTED', 'PREPARING', 'READY', 'TAXI_REQUESTED', 'DRIVER_ASSIGNED', 'DELIVERY_ASSUMED', 'COMPLETED'] as const;

const TASHKENT_MS = 5 * 3_600_000;
export const tashkentDayStart = (now: Date): Date => new Date(Math.floor((now.getTime() + TASHKENT_MS) / 86_400_000) * 86_400_000 - TASHKENT_MS);
const tashkentDay = (now: Date): string => new Date(now.getTime() + TASHKENT_MS).toISOString().slice(0, 10);

export interface TodaySummary {
  day: string;
  orders: { total: number; delivered: number; cancelled: number; inProgress: number };
  /** Sum of order totals (food + platform line, without the taxi fare) of today's paid, not cancelled orders. */
  revenueSom: number;
  /** The part of [revenueSom] that customers pay in cash to the courier. */
  cashSom: number;
  /** What restaurants owe now (closed weeks, nothing holding it): the same number as the Komissiya screen. */
  commissionDue: { restaurants: number; amountSom: number };
  openTickets: number;
  moneyReviews: number;
  generatedAt: string;
}

export async function todaySummary(now = new Date()): Promise<TodaySummary> {
  const real = { createdViaBot: true, paymentIsTest: false, createdAt: { gte: tashkentDayStart(now) } } as const;
  const [byStatus, revenue, cash, statements, openTickets, reviews] = await Promise.all([
    db.order.groupBy({ by: ['status'], where: real, _count: { _all: true } }),
    db.order.aggregate({ where: { ...real, status: { in: [...PAID] } }, _sum: { totalSom: true } }),
    db.order.aggregate({ where: { ...real, status: { in: [...PAID] }, payment: { is: { method: 'CASH' } } }, _sum: { totalSom: true } }),
    commissionStatements(now),
    db.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    listUnhandledReviews(1000),
  ]);
  const count = (set: readonly string[]) => byStatus.filter(r => set.includes(r.status)).reduce((n, r) => n + r._count._all, 0);
  const total = byStatus.reduce((n, r) => n + r._count._all, 0);
  const delivered = count(DELIVERED);
  const cancelled = count(CANCELLED);
  const owing = statements.filter(s => s.due.amountSom > 0);
  return {
    day: tashkentDay(now),
    orders: { total, delivered, cancelled, inProgress: total - delivered - cancelled },
    revenueSom: revenue._sum.totalSom ?? 0,
    cashSom: cash._sum.totalSom ?? 0,
    commissionDue: { restaurants: owing.length, amountSom: owing.reduce((n, s) => n + s.due.amountSom, 0) },
    openTickets,
    moneyReviews: reviews.length,
    generatedAt: now.toISOString(),
  };
}
