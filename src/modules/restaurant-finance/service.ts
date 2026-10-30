import type { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';
import { beforeCursor, encodeCursor } from '../../lib/cursor.js';
import {
  COMMISSION_RULE_CODE, DELIVERY_CONFIRMATION_IMPLEMENTED, REPORT_TZ_OFFSET, commissionFlatSom, isRefundUnresolved,
  parseReportRange, refundAmountTiyin, refundStage, summarizeRefunds, tiyinToSom, type RefundTotals,
} from '../commission/rules.js';
import { NOT_PLATFORM_COLLECTED, PLATFORM_COLLECTED } from '../commission/settlement.js';

export class FinanceError extends Error {
  constructor(readonly statusCode: number, code: string) { super(code); }
}

/** Every function takes the restaurantId of the authenticated session and puts it in EVERY query. Test orders are excluded. */
const CANCELLED = ['CANCELLED', 'CUSTOMER_CANCELLED', 'RESTAURANT_REJECTED', 'RESTAURANT_EXPIRED', 'PAYMENT_EXPIRED', 'FAILED'] as const;
const bucketOf = (status: string): 'completed' | 'cancelled' | 'inProgress' =>
  status === 'COMPLETED' ? 'completed' : (CANCELLED as readonly string[]).includes(status) ? 'cancelled' : 'inProgress';

export type OrderBucket = 'completed' | 'cancelled' | 'in_progress';
const STATUS_FILTER: Record<OrderBucket, Prisma.OrderWhereInput> = {
  completed: { status: 'COMPLETED' },
  cancelled: { status: { in: [...CANCELLED] } },
  in_progress: { status: { notIn: ['COMPLETED', ...CANCELLED] } },
};

function range(q: { from?: string; to?: string }) {
  try { return parseReportRange(q); } catch (e) { throw new FinanceError(400, e instanceof Error ? e.message : 'DATE_FILTER_INVALID'); }
}
const iso = (d: Date) => d.toISOString();
const refundMoney = (t: RefundTotals) => ({ count: t.count, amountTiyin: t.amountTiyin.toString(), amountSom: tiyinToSom(t.amountTiyin) });
const safeFlat = (): number | null => { try { return commissionFlatSom(); } catch { return null; } };

export interface PageQuery { limit: number; cursor?: string }

export async function financeSummary(restaurantId: string, q: { from?: string; to?: string }) {
  const { from, to } = range(q);
  const orderWhere: Prisma.OrderWhereInput = { restaurantId, paymentIsTest: false, createdAt: { gte: from, lt: to } };
  const [orderGroups, payGroups, refundRows, openRefunds, accruedPeriod, outstanding, missing, withRefund, netted] = await Promise.all([
    db.order.groupBy({ by: ['status'], where: orderWhere, _count: { _all: true }, _sum: { totalSom: true } }),
    db.payment.groupBy({ by: ['status'], where: { isTest: false, order: { is: orderWhere } }, _count: { _all: true }, _sum: { amountTiyin: true } }),
    db.refundRequest.findMany({
      where: { order: { restaurantId, paymentIsTest: false }, requestedAt: { gte: from, lt: to } },
      select: { status: true, confirmedByType: true, paidAmountTiyin: true, approvedAmountTiyin: true },
    }),
    db.refundRequest.findMany({
      where: { order: { restaurantId, paymentIsTest: false }, status: { in: ['REQUESTED', 'APPROVED', 'SENT', 'DISPUTED'] } },
      select: { status: true, confirmedByType: true, paidAmountTiyin: true, approvedAmountTiyin: true },
    }),
    db.commissionEntry.aggregate({ where: { restaurantId, accruedAt: { gte: from, lt: to } }, _count: { _all: true }, _sum: { amountSom: true } }),
    // What the restaurant itself still owes: orders paid onto the platform's card are netted by the platform in the daily payout, never billed to the restaurant.
    db.commissionEntry.aggregate({ where: { restaurantId, ...NOT_PLATFORM_COLLECTED }, _count: { _all: true }, _sum: { amountSom: true } }),
    db.order.count({ where: { restaurantId, paymentIsTest: false, status: 'COMPLETED', commission: null, payment: { is: { status: { in: ['CONFIRMED_MANUAL', 'CASH_ACCEPTED'] }, isTest: false } } } }),
    db.commissionEntry.count({ where: { restaurantId, order: { refundRequests: { some: { status: { not: 'REJECTED' } } } } } }),
    db.commissionEntry.aggregate({ where: { restaurantId, ...PLATFORM_COLLECTED }, _count: { _all: true }, _sum: { amountSom: true } }),
  ]);

  const orders = { completed: { count: 0, totalSom: 0 }, cancelled: { count: 0, totalSom: 0 }, inProgress: { count: 0, totalSom: 0 } };
  for (const g of orderGroups) {
    const b = orders[bucketOf(g.status)];
    b.count += g._count._all; b.totalSom += g._sum.totalSom ?? 0;
  }
  const pay = (statuses: string[]) => {
    let count = 0; let tiyin = 0n;
    for (const g of payGroups) if (statuses.includes(g.status)) { count += g._count._all; tiyin += g._sum.amountTiyin ?? 0n; }
    return { count, som: tiyinToSom(tiyin) };
  };
  const periodRefunds = summarizeRefunds(refundRows);
  const openNow = summarizeRefunds(openRefunds);

  return {
    currency: 'UZS',
    period: { from: iso(from), to: iso(to), dateOnlyTimezone: REPORT_TZ_OFFSET },
    deliveryConfirmation: DELIVERY_CONFIRMATION_IMPLEMENTED ? 'IMPLEMENTED' : 'NOT_IMPLEMENTED',
    orders, // created in the period; only `completed` (genuinely delivered) can ever earn commission
    payments: {
      // Only a payment the restaurant itself verified counts as money received. Matched-by-mail and awaiting payments never do.
      verifiedReceived: pay(['CONFIRMED_MANUAL']),
      pendingUnverified: pay(['MATCHED_UNVERIFIED']),
      awaitingPayment: pay(['QUEUED', 'AWAITING']),
    },
    refunds: {
      period: {
        requested: refundMoney(periodRefunds.REQUESTED),
        approvedAwaitingSend: refundMoney(periodRefunds.APPROVED_AWAITING_SEND),
        sentUnconfirmed: refundMoney(periodRefunds.SENT_UNCONFIRMED),
        confirmedByCustomer: refundMoney(periodRefunds.CONFIRMED_BY_CUSTOMER),
        confirmedByAdmin: refundMoney(periodRefunds.CONFIRMED_BY_ADMIN),
        disputed: refundMoney(periodRefunds.DISPUTED),
        rejected: refundMoney(periodRefunds.REJECTED),
      },
      openNow: {
        total: refundMoney(openNow.unresolved),
        requested: openNow.REQUESTED.count, approvedAwaitingSend: openNow.APPROVED_AWAITING_SEND.count,
        sentUnconfirmed: openNow.SENT_UNCONFIRMED.count, disputed: openNow.DISPUTED.count,
      },
      bankVerified: false, // the platform has no bank access; CONFIRMED is a customer/admin attestation
    },
    commission: {
      ruleCode: COMMISSION_RULE_CODE,
      currentFlatSom: safeFlat(),
      accruedInPeriod: { count: accruedPeriod._count._all, som: accruedPeriod._sum.amountSom ?? 0 },
      // All-time, not limited to the period. Nothing is collected automatically and settlements are not recorded yet.
      outstandingLiability: { count: outstanding._count._all, som: outstanding._sum.amountSom ?? 0 },
      // All-time commission on orders the platform collected: already deducted from the restaurant's payout, so it is not in outstandingLiability.
      nettedByPlatform: { count: netted._count._all, som: netted._sum.amountSom ?? 0 },
      settlementTracking: 'NOT_IMPLEMENTED',
    },
    unresolved: {
      refundsOpen: openNow.unresolved.count,
      refundsDisputed: openNow.DISPUTED.count,
      completedOrdersWithoutCommission: missing,
      commissionedOrdersWithRefund: withRefund,
    },
  };
}

const paymentState = (p: { status: string; isTest: boolean } | null) =>
  !p ? 'NONE' : p.isTest ? 'TEST' : p.status === 'CASH_PENDING' || p.status === 'CASH_ACCEPTED' ? 'CASH_ON_DELIVERY' : p.status === 'CONFIRMED_MANUAL' ? 'VERIFIED_BY_RESTAURANT' : p.status === 'MATCHED_UNVERIFIED' ? 'MATCHED_UNVERIFIED'
    : ['QUEUED', 'AWAITING'].includes(p.status) ? 'AWAITING_PAYMENT' : 'EXPIRED_OR_CANCELLED';

export async function financeOrders(restaurantId: string, q: { from?: string; to?: string; bucket?: OrderBucket } & PageQuery) {
  const { from, to } = range(q);
  const rows = await db.order.findMany({
    where: {
      restaurantId, paymentIsTest: false, createdAt: { gte: from, lt: to }, ...(q.bucket ? STATUS_FILTER[q.bucket] : {}),
      ...(q.cursor ? beforeCursor('createdAt', q.cursor) : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit + 1,
    select: {
      id: true, code: true, status: true, totalSom: true, createdAt: true,
      payment: { select: { status: true, isTest: true, amountTiyin: true } },
      commission: { select: { amountSom: true, accruedAt: true } },
      refundRequests: { orderBy: { requestedAt: 'desc' }, take: 1, select: { status: true, confirmedByType: true } },
    },
  });
  const page = rows.slice(0, q.limit);
  return {
    currency: 'UZS',
    items: page.map(o => {
      const received = paymentState(o.payment) === 'VERIFIED_BY_RESTAURANT';
      const bucket = bucketOf(o.status);
      const refund = o.refundRequests[0];
      return {
        code: o.code, status: o.status, bucket, totalSom: o.totalSom, createdAt: iso(o.createdAt),
        payment: { state: paymentState(o.payment), receivedSom: received ? tiyinToSom(o.payment!.amountTiyin) : 0 },
        commission: o.commission
          ? { state: 'ACCRUED', amountSom: o.commission.amountSom, accruedAt: iso(o.commission.accruedAt) }
          : { state: bucket === 'cancelled' ? 'NOT_APPLICABLE' : bucket === 'completed' ? 'NEEDS_REVIEW' : 'PENDING_DELIVERY_CONFIRMATION', amountSom: 0 },
        refund: refund ? { status: refund.status, stage: refundStage(refund.status, refund.confirmedByType), unresolved: isRefundUnresolved(refund.status) } : null,
      };
    }),
    nextCursor: rows.length > q.limit ? encodeCursor(page[page.length - 1]!.createdAt, page[page.length - 1]!.id) : null,
  };
}

export async function financeCommissions(restaurantId: string, q: { from?: string; to?: string } & PageQuery) {
  const { from, to } = range(q);
  const where: Prisma.CommissionEntryWhereInput = { restaurantId, accruedAt: { gte: from, lt: to } };
  const [rows, periodTotal, outstanding, netted] = await Promise.all([
    db.commissionEntry.findMany({
      where: { ...where, ...(q.cursor ? beforeCursor('accruedAt', q.cursor) : {}) },
      orderBy: [{ accruedAt: 'desc' }, { id: 'desc' }], take: q.limit + 1,
      select: {
        id: true, amountSom: true, orderTotalSom: true, ruleCode: true, accruedAt: true, payment: { select: { method: true, card: { select: { restaurantId: true } } } }, order: {
          select: { code: true, refundRequests: { orderBy: { requestedAt: 'desc' }, take: 1, select: { status: true, confirmedByType: true } } },
        },
      },
    }),
    db.commissionEntry.aggregate({ where, _count: { _all: true }, _sum: { amountSom: true } }),
    db.commissionEntry.aggregate({ where: { restaurantId, ...NOT_PLATFORM_COLLECTED }, _count: { _all: true }, _sum: { amountSom: true } }),
    db.commissionEntry.aggregate({ where: { restaurantId, ...PLATFORM_COLLECTED }, _count: { _all: true }, _sum: { amountSom: true } }),
  ]);
  const page = rows.slice(0, q.limit);
  return {
    currency: 'UZS',
    items: page.map(e => {
      const refund = e.order.refundRequests[0];
      return {
        orderCode: e.order.code, orderTotalSom: e.orderTotalSom, amountSom: e.amountSom, ruleCode: e.ruleCode,
        accruedAt: iso(e.accruedAt),
        // The platform collected this order's money and deducts the commission from the restaurant's payout: nothing for the restaurant to pay.
        nettedByPlatform: e.payment?.method === 'CARD' && e.payment.card?.restaurantId === null,
        // No automatic reversal: an order with a refund after accrual is only flagged for a human/policy decision.
        refund: refund ? { stage: refundStage(refund.status, refund.confirmedByType) } : null,
        needsPolicyReview: !!refund && refund.status !== 'REJECTED',
      };
    }),
    nextCursor: rows.length > q.limit ? encodeCursor(page[page.length - 1]!.accruedAt, page[page.length - 1]!.id) : null,
    totalInPeriod: { count: periodTotal._count._all, som: periodTotal._sum.amountSom ?? 0 },
    outstandingLiability: { count: outstanding._count._all, som: outstanding._sum.amountSom ?? 0 },
    nettedByPlatform: { count: netted._count._all, som: netted._sum.amountSom ?? 0 },
    settlementTracking: 'NOT_IMPLEMENTED',
  };
}

export type RefundFilter = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'SENT' | 'CONFIRMED' | 'DISPUTED';

export async function financeRefunds(restaurantId: string, q: { from?: string; to?: string; status?: RefundFilter } & PageQuery) {
  const { from, to } = range(q);
  const where: Prisma.RefundRequestWhereInput = {
    order: { restaurantId, paymentIsTest: false }, requestedAt: { gte: from, lt: to }, ...(q.status ? { status: q.status } : {}),
  };
  const [rows, all] = await Promise.all([
    db.refundRequest.findMany({
      where: { ...where, ...(q.cursor ? beforeCursor('requestedAt', q.cursor) : {}) },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }], take: q.limit + 1,
      select: {
        id: true, kind: true, status: true, reasonCode: true, requestedByType: true, requestedAt: true, decidedAt: true, rejectReason: true,
        paidAmountTiyin: true, approvedAmountTiyin: true, sentAt: true, bankReference: true, confirmedByType: true, confirmedAt: true,
        disputedAt: true, taxiActiveAtDecision: true,
        order: { select: { code: true, status: true, commission: { select: { amountSom: true } } } },
      },
    }),
    db.refundRequest.findMany({ where, select: { status: true, confirmedByType: true, paidAmountTiyin: true, approvedAmountTiyin: true } }),
  ]);
  const page = rows.slice(0, q.limit);
  const totals = summarizeRefunds(all);
  const d = (x: Date | null) => (x ? iso(x) : null);
  return {
    currency: 'UZS',
    items: page.map(r => ({
      orderCode: r.order.code, orderStatus: r.order.status, kind: r.kind, status: r.status,
      stage: refundStage(r.status, r.confirmedByType), unresolved: isRefundUnresolved(r.status),
      bankVerified: false, // CONFIRMED_* means customer/admin attestation, never a bank-verified settlement
      reasonCode: r.reasonCode, requestedByType: r.requestedByType, requestedAt: iso(r.requestedAt), decidedAt: d(r.decidedAt),
      rejectReason: r.rejectReason,
      paidAmountTiyin: r.paidAmountTiyin.toString(), paidAmountSom: tiyinToSom(r.paidAmountTiyin),
      refundAmountTiyin: refundAmountTiyin(r).toString(), refundAmountSom: tiyinToSom(refundAmountTiyin(r)),
      sentAt: d(r.sentAt), bankReference: r.bankReference, confirmedByType: r.confirmedByType, confirmedAt: d(r.confirmedAt),
      disputedAt: d(r.disputedAt), taxiActiveAtDecision: r.taxiActiveAtDecision,
      commissionAccruedSom: r.order.commission?.amountSom ?? null,
    })),
    nextCursor: rows.length > q.limit ? encodeCursor(page[page.length - 1]!.requestedAt, page[page.length - 1]!.id) : null,
    totals: {
      requested: refundMoney(totals.REQUESTED), approvedAwaitingSend: refundMoney(totals.APPROVED_AWAITING_SEND),
      sentUnconfirmed: refundMoney(totals.SENT_UNCONFIRMED), confirmedByCustomer: refundMoney(totals.CONFIRMED_BY_CUSTOMER),
      confirmedByAdmin: refundMoney(totals.CONFIRMED_BY_ADMIN), disputed: refundMoney(totals.DISPUTED),
      rejected: refundMoney(totals.REJECTED), unresolved: refundMoney(totals.unresolved),
    },
  };
}
