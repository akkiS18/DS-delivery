import type { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';
import { isPaymentCleared } from '../payment/status.js';

/**
 * DS Admin app, A5a: the daily payout report. READ ONLY: the platform never moves money; this is the number the administrator transfers by hand.
 *
 * Owner decision 2026-10-30. For a restaurant whose customers pay onto PLATFORM cards (Card.restaurantId null, the pool), the platform holds the money.
 * Per Asia/Tashkent day (the day the delivery was confirmed, i.e. the order's COMPLETED event):
 *   to pay the restaurant = money collected for the orders delivered that day
 *                           - the platform's commission on those orders (the frozen CommissionEntry, flat fee or service fee)
 *                           - refunds the restaurant SENT that day for delivered orders.
 * The taxi fare is paid by the customer separately and is not part of it. Cash orders and orders paid on the restaurant's own card are not here:
 * the restaurant holds that money itself and settles the commission in the weekly statement (commission/settlement.ts, which skips the orders below).
 */
const TASHKENT_OFFSET_MS = 5 * 3600_000;
const DAY_MS = 86_400_000;
export const MAX_DAYS = 31;

/** A real card payment that landed on a platform card. */
export const PLATFORM_COLLECTED: Prisma.PaymentWhereInput = { method: 'CARD', isTest: false, card: { is: { restaurantId: null, isTest: false } } };

/** In progress: paid and verified, but not delivered yet (so not payable yet). */
const IN_PROGRESS = ['PAYMENT_CONFIRMED', 'ACCEPTED', 'PREPARING', 'READY', 'TAXI_REQUESTED', 'DRIVER_ASSIGNED', 'DELIVERY_ASSUMED'] as const;

/** "2026-10-30": the Tashkent calendar date of an instant. */
export const dateKey = (d: Date): string => new Date(d.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);
/** The instant a Tashkent calendar day starts. */
export const dayStart = (key: string): Date => new Date(Date.parse(`${key}T00:00:00Z`) - TASHKENT_OFFSET_MS);
export const isDateKey = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const at = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(at) && dateKey(new Date(at + 12 * 3600_000 - TASHKENT_OFFSET_MS)) === s; // rejects 2026-13-45 and 2026-02-30
};

export interface RestaurantDay {
  restaurantId: string; name: string;
  orders: number; collectedSom: number; commissionSom: number; refundsSom: number;
  /** collected - commission - refunds. Can be negative when refunds of earlier days outweigh the day. */
  payableSom: number;
  /** Delivered orders of this day that have an unresolved support ticket: still counted, but worth a look before paying. */
  withOpenTicket: number;
}
export interface PayoutDay { date: string; restaurants: RestaurantDay[]; totalPayableSom: number }
export interface InProgress { restaurantId: string; name: string; orders: number; amountSom: number }
export interface PayoutReport { days: PayoutDay[]; inProgress: InProgress[]; generatedAt: string }

const som = (tiyin: bigint): number => Number(tiyin / 100n);

export async function payoutReport(days = 7, now = new Date()): Promise<PayoutReport> {
  const count = Math.min(Math.max(Math.trunc(days) || 1, 1), MAX_DAYS);
  const today = dayStart(dateKey(now));
  const from = new Date(today.getTime() - (count - 1) * DAY_MS);
  const to = new Date(today.getTime() + DAY_MS);

  const [events, refunds, active] = await Promise.all([
    db.orderEvent.findMany({
      where: { toStatus: 'COMPLETED', createdAt: { gte: from, lt: to }, order: { status: 'COMPLETED', paymentIsTest: false, payment: { is: PLATFORM_COLLECTED } } },
      orderBy: { createdAt: 'asc' },
      select: {
        orderId: true, createdAt: true,
        order: {
          select: {
            restaurantId: true, restaurant: { select: { name: true } }, commission: { select: { amountSom: true } },
            payment: { select: { status: true, amountTiyin: true } },
            supportTickets: { where: { status: { in: ['OPEN', 'IN_PROGRESS'] } }, select: { id: true }, take: 1 },
          },
        },
      },
    }),
    db.refundRequest.findMany({
      where: {
        status: { in: ['SENT', 'DISPUTED', 'CONFIRMED'] }, sentAt: { gte: from, lt: to },
        order: { status: 'COMPLETED', paymentIsTest: false, payment: { is: PLATFORM_COLLECTED } },
      },
      select: { sentAt: true, approvedAmountTiyin: true, paidAmountTiyin: true, order: { select: { restaurantId: true, restaurant: { select: { name: true } } } } },
    }),
    db.order.findMany({
      where: { status: { in: [...IN_PROGRESS] }, paymentIsTest: false, payment: { is: { ...PLATFORM_COLLECTED, status: 'CONFIRMED_MANUAL' } } },
      select: { restaurantId: true, restaurant: { select: { name: true } }, payment: { select: { amountTiyin: true } } },
    }),
  ]);

  const byDay = new Map<string, Map<string, RestaurantDay>>();
  const slot = (key: string, restaurantId: string, name: string): RestaurantDay => {
    const day = byDay.get(key) ?? new Map<string, RestaurantDay>();
    byDay.set(key, day);
    const row = day.get(restaurantId) ?? { restaurantId, name, orders: 0, collectedSom: 0, commissionSom: 0, refundsSom: 0, payableSom: 0, withOpenTicket: 0 };
    day.set(restaurantId, row);
    return row;
  };

  // An order has one COMPLETED event; if a repeat ever existed, the earliest one is the delivery.
  const seen = new Set<string>();
  for (const e of events) {
    if (seen.has(e.orderId)) continue;
    seen.add(e.orderId);
    if (!e.order.payment || !isPaymentCleared(e.order.payment.status)) continue; // money not verified by the restaurant: nothing to pay out
    const r = slot(dateKey(e.createdAt), e.order.restaurantId, e.order.restaurant.name);
    r.orders += 1;
    r.collectedSom += som(e.order.payment.amountTiyin);
    r.commissionSom += e.order.commission?.amountSom ?? 0;
    if (e.order.supportTickets.length) r.withOpenTicket += 1;
  }
  for (const f of refunds) {
    if (!f.sentAt) continue;
    slot(dateKey(f.sentAt), f.order.restaurantId, f.order.restaurant.name).refundsSom += som(f.approvedAmountTiyin ?? f.paidAmountTiyin);
  }

  const outDays: PayoutDay[] = [];
  for (let i = 0; i < count; i++) {
    const key = dateKey(new Date(today.getTime() - i * DAY_MS));
    const restaurants = [...(byDay.get(key)?.values() ?? [])]
      .map(r => ({ ...r, payableSom: r.collectedSom - r.commissionSom - r.refundsSom }))
      .sort((a, b) => a.name.localeCompare(b.name));
    outDays.push({ date: key, restaurants, totalPayableSom: restaurants.reduce((s, r) => s + r.payableSom, 0) });
  }

  const pending = new Map<string, InProgress>();
  for (const o of active) {
    const p = pending.get(o.restaurantId) ?? { restaurantId: o.restaurantId, name: o.restaurant.name, orders: 0, amountSom: 0 };
    p.orders += 1;
    p.amountSom += o.payment ? som(o.payment.amountTiyin) : 0;
    pending.set(o.restaurantId, p);
  }
  return { days: outDays, inProgress: [...pending.values()].sort((a, b) => a.name.localeCompare(b.name)), generatedAt: now.toISOString() };
}

export interface DayDetail {
  date: string; restaurantId: string; name: string;
  orders: Array<{ code: string; at: string; collectedSom: number; commissionSom: number; openTicket: boolean }>;
  refunds: Array<{ number: number; orderCode: string; at: string; amountSom: number; status: string }>;
}

/** The lines behind one restaurant's day, so the administrator can check the total against the orders. null = nothing that day. */
export async function payoutDayDetail(date: string, restaurantId: string): Promise<DayDetail | null> {
  const from = dayStart(date);
  const to = new Date(from.getTime() + DAY_MS);
  const [events, refunds] = await Promise.all([
    db.orderEvent.findMany({
      where: { toStatus: 'COMPLETED', createdAt: { gte: from, lt: to }, order: { restaurantId, status: 'COMPLETED', paymentIsTest: false, payment: { is: PLATFORM_COLLECTED } } },
      orderBy: { createdAt: 'asc' },
      select: {
        orderId: true, createdAt: true,
        order: {
          select: {
            code: true, restaurant: { select: { name: true } }, commission: { select: { amountSom: true } },
            payment: { select: { status: true, amountTiyin: true } },
            supportTickets: { where: { status: { in: ['OPEN', 'IN_PROGRESS'] } }, select: { id: true }, take: 1 },
          },
        },
      },
    }),
    db.refundRequest.findMany({
      where: {
        status: { in: ['SENT', 'DISPUTED', 'CONFIRMED'] }, sentAt: { gte: from, lt: to },
        order: { restaurantId, status: 'COMPLETED', paymentIsTest: false, payment: { is: PLATFORM_COLLECTED } },
      },
      orderBy: { sentAt: 'asc' },
      select: { number: true, status: true, sentAt: true, approvedAmountTiyin: true, paidAmountTiyin: true, order: { select: { code: true, restaurant: { select: { name: true } } } } },
    }),
  ]);
  const seen = new Set<string>();
  const orders: DayDetail['orders'] = [];
  for (const e of events) {
    if (seen.has(e.orderId) || !e.order.payment || !isPaymentCleared(e.order.payment.status)) continue;
    seen.add(e.orderId);
    orders.push({
      code: e.order.code, at: e.createdAt.toISOString(), collectedSom: som(e.order.payment.amountTiyin),
      commissionSom: e.order.commission?.amountSom ?? 0, openTicket: e.order.supportTickets.length > 0,
    });
  }
  const refundLines: DayDetail['refunds'] = refunds
    .filter(f => f.sentAt !== null)
    .map(f => ({ number: f.number, orderCode: f.order.code, at: f.sentAt!.toISOString(), amountSom: som(f.approvedAmountTiyin ?? f.paidAmountTiyin), status: f.status }));
  if (!orders.length && !refundLines.length) return null;
  const name = events[0]?.order.restaurant.name ?? refunds[0]!.order.restaurant.name;
  return { date, restaurantId, name, orders, refunds: refundLines };
}
