import { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';
import { decodeCursor, encodeCursor } from '../../lib/cursor.js';
import { dayStart, isDateKey, payoutReport } from '../admin-payouts/service.js';
import { FinanceError } from './service.js';

/**
 * The restaurant's simple money view (owner decision 2026-11-05): money counts when the order is DELIVERED (COMPLETED) and its payment is cleared.
 * Per payment source:
 *   platform = paid onto a PLATFORM card: the platform holds it and pays the restaurant out by hand (PayoutMark),
 *   own      = paid onto the restaurant's own card: the restaurant holds it and owes the platform fee (settled by an administrator, CommissionSettlement),
 *   cash     = paid to the driver (shown only inside the history screen, not on the main screen).
 * restaurantEarned = collected - platform fee - refunds the restaurant sent. A waived fee (CommissionWaiver) counts as 0. Test orders never count.
 */
type Bucket = 'platform' | 'own' | 'cash';

const BUCKET = Prisma.sql`CASE WHEN p."method" = 'CASH' THEN 'cash' WHEN p."method" = 'CARD' AND k."id" IS NOT NULL AND k."restaurantId" IS NULL THEN 'platform' ELSE 'own' END`;

/** One row per delivered, cleared, non-test order of the restaurant. */
const delivered = (restaurantId: string) => Prisma.sql`
  SELECT o."id" AS order_id, o."code" AS code, ${BUCKET} AS bucket,
    (p."amountTiyin" / 100)::bigint AS collected,
    (CASE WHEN c."id" IS NULL OR w."id" IS NOT NULL THEN 0 ELSE c."amountSom" END)::bigint AS fee,
    (CASE WHEN c."id" IS NOT NULL AND w."id" IS NULL AND s."entryId" IS NOT NULL THEN c."amountSom" ELSE 0 END)::bigint AS fee_settled,
    COALESCE((SELECT min(e."createdAt") FROM "OrderEvent" e WHERE e."orderId" = o."id" AND e."toStatus" = 'COMPLETED'), o."updatedAt") AS at,
    (COALESCE((SELECT sum(COALESCE(r."approvedAmountTiyin", r."paidAmountTiyin")) FROM "RefundRequest" r
       WHERE r."orderId" = o."id" AND r."status" IN ('SENT', 'DISPUTED', 'CONFIRMED')), 0) / 100)::bigint AS refunds
  FROM "Order" o
  JOIN "Payment" p ON p."orderId" = o."id"
  LEFT JOIN "Card" k ON k."id" = p."cardId"
  LEFT JOIN "CommissionEntry" c ON c."orderId" = o."id"
  LEFT JOIN "CommissionWaiver" w ON w."entryId" = c."id"
  LEFT JOIN "CommissionSettlementEntry" s ON s."entryId" = c."id"
  WHERE o."restaurantId" = ${restaurantId} AND o."status" = 'COMPLETED' AND o."paymentIsTest" = false AND p."isTest" = false
    AND p."status" IN ('CONFIRMED_MANUAL', 'CASH_ACCEPTED')`;

const n = (v: bigint | number | null | undefined): number => Number(v ?? 0);

export interface SourceTotals {
  orders: number; collectedSom: number; platformFeeSom: number; refundsSom: number;
  /** collected - platform fee - refunds */
  restaurantEarnedSom: number;
  /** Platform fee already settled by an administrator (own card / cash); for the platform card the fee is netted in the payout instead. */
  feeSettledSom: number;
}
const empty = (): SourceTotals => ({ orders: 0, collectedSom: 0, platformFeeSom: 0, refundsSom: 0, restaurantEarnedSom: 0, feeSettledSom: 0 });

export async function financeOverview(restaurantId: string) {
  const [rows, marks, restaurant, report, openRefunds] = await Promise.all([
    db.$queryRaw<Array<{ bucket: Bucket; orders: number; collected: bigint; fee: bigint; fee_settled: bigint; refunds: bigint }>>`
      WITH d AS (${delivered(restaurantId)})
      SELECT bucket, count(*)::int AS orders, COALESCE(sum(collected), 0)::bigint AS collected, COALESCE(sum(fee), 0)::bigint AS fee,
             COALESCE(sum(fee_settled), 0)::bigint AS fee_settled, COALESCE(sum(refunds), 0)::bigint AS refunds
      FROM d GROUP BY bucket`,
    db.payoutMark.aggregate({ where: { restaurantId, revokedAt: null }, _sum: { amountSom: true }, _count: { _all: true } }),
    db.restaurant.findUnique({ where: { id: restaurantId }, select: { collectsToPlatform: true } }),
    payoutReport(1, new Date(), restaurantId),
    db.refundRequest.findMany({ where: { order: { restaurantId, paymentIsTest: false }, status: { in: ['REQUESTED', 'APPROVED', 'SENT', 'DISPUTED'] } }, select: { approvedAmountTiyin: true, paidAmountTiyin: true } }),
  ]);
  const by: Record<Bucket, SourceTotals> = { platform: empty(), own: empty(), cash: empty() };
  for (const r of rows) {
    by[r.bucket] = {
      orders: r.orders, collectedSom: n(r.collected), platformFeeSom: n(r.fee), refundsSom: n(r.refunds),
      restaurantEarnedSom: n(r.collected) - n(r.fee) - n(r.refunds), feeSettledSom: n(r.fee_settled),
    };
  }
  const paidOutSom = marks._sum.amountSom ?? 0;
  const inProgress = report.inProgress.find(p => p.restaurantId === restaurantId);
  return {
    currency: 'UZS',
    collectsToPlatform: !!restaurant?.collectsToPlatform,
    /** Paid onto platform cards: the platform pays the restaurant out. remaining = earned - paid out (negative = paid more than earned so far). */
    platformCard: {
      ...by.platform, paidOutSom, remainingSom: by.platform.restaurantEarnedSom - paidOutSom,
      inProgressOrders: inProgress?.orders ?? 0, inProgressSom: inProgress?.amountSom ?? 0,
    },
    /** Paid onto the restaurant's own card(s): the restaurant owes the platform fee. */
    ownCard: { ...by.own, feeRemainingSom: by.own.platformFeeSom - by.own.feeSettledSom },
    /** Cash to the driver: shown inside the history screen only. */
    cash: { ...by.cash, feeRemainingSom: by.cash.platformFeeSom - by.cash.feeSettledSom },
    /** Refund requests that still need an answer or a transfer (the one warning the main screen keeps). */
    openRefunds: { count: openRefunds.length, amountSom: openRefunds.reduce((s, r) => s + Number((r.approvedAmountTiyin ?? r.paidAmountTiyin) / 100n), 0) },
  };
}

// ------------------------------------------------------------------------------------------------ history ("Jami")
export type LedgerFilter = 'all' | 'card' | 'cash';

export interface LedgerQuery { from?: string; to?: string; filter: LedgerFilter; limit: number; cursor?: string }

function dayRange(from?: string, to?: string): { from: Date | null; to: Date | null } {
  for (const d of [from, to]) if (d !== undefined && !isDateKey(d)) throw new FinanceError(400, 'DATE_FILTER_INVALID');
  const f = from ? dayStart(from) : null;
  const t = to ? new Date(dayStart(to).getTime() + 86_400_000) : null;
  if (f && t && f >= t) throw new FinanceError(400, 'DATE_FILTER_INVALID');
  return { from: f, to: t };
}

/**
 * The income history: one line per delivered order (money counted at delivery) and one per payout the administrator recorded, newest first.
 * `totals` cover the whole filtered range, not just the page.
 */
export async function financeLedger(restaurantId: string, q: LedgerQuery) {
  const { from, to } = dayRange(q.from, q.to);
  const filterSql = q.filter === 'card' ? Prisma.sql`AND (kind = 'PAYOUT' OR bucket IN ('platform', 'own'))` : q.filter === 'cash' ? Prisma.sql`AND bucket = 'cash'` : Prisma.empty;
  const rangeSql = Prisma.sql`${from ? Prisma.sql`AND at >= ${from}` : Prisma.empty} ${to ? Prisma.sql`AND at < ${to}` : Prisma.empty}`;
  const cursor = q.cursor ? decodeCursor(q.cursor) : null;
  const cursorSql = cursor ? Prisma.sql`AND (at < ${cursor.at} OR (at = ${cursor.at} AND id < ${cursor.id}))` : Prisma.empty;
  const all = Prisma.sql`
    WITH d AS (${delivered(restaurantId)}),
    t AS (
      SELECT 'INCOME'::text AS kind, order_id AS id, at, code, bucket::text AS bucket, collected, fee, refunds FROM d
      UNION ALL
      SELECT 'PAYOUT'::text, m."id", m."createdAt", NULL::text, 'platform'::text, m."amountSom"::bigint, 0::bigint, 0::bigint
      FROM "PayoutMark" m WHERE m."restaurantId" = ${restaurantId} AND m."revokedAt" IS NULL
    )`;
  const [rows, totals] = await Promise.all([
    db.$queryRaw<Array<{ kind: 'INCOME' | 'PAYOUT'; id: string; at: Date; code: string | null; bucket: Bucket; collected: bigint; fee: bigint; refunds: bigint }>>`
      ${all} SELECT * FROM t WHERE true ${filterSql} ${rangeSql} ${cursorSql} ORDER BY at DESC, id DESC LIMIT ${q.limit + 1}`,
    db.$queryRaw<Array<{ orders: number; collected: bigint; fee: bigint; refunds: bigint; payouts: bigint }>>`
      ${all} SELECT count(*) FILTER (WHERE kind = 'INCOME')::int AS orders,
        COALESCE(sum(collected) FILTER (WHERE kind = 'INCOME'), 0)::bigint AS collected, COALESCE(sum(fee) FILTER (WHERE kind = 'INCOME'), 0)::bigint AS fee,
        COALESCE(sum(refunds) FILTER (WHERE kind = 'INCOME'), 0)::bigint AS refunds, COALESCE(sum(collected) FILTER (WHERE kind = 'PAYOUT'), 0)::bigint AS payouts
      FROM t WHERE true ${filterSql} ${rangeSql}`,
  ]);
  const page = rows.slice(0, q.limit);
  const t = totals[0]!;
  return {
    currency: 'UZS',
    totals: {
      orders: t.orders, collectedSom: n(t.collected), platformFeeSom: n(t.fee), refundsSom: n(t.refunds),
      restaurantEarnedSom: n(t.collected) - n(t.fee) - n(t.refunds), paidOutSom: n(t.payouts),
    },
    items: page.map(r => r.kind === 'PAYOUT'
      ? { kind: 'PAYOUT' as const, id: r.id, at: r.at.toISOString(), amountSom: n(r.collected) }
      : {
        kind: 'INCOME' as const, id: r.id, at: r.at.toISOString(), orderCode: r.code, source: r.bucket,
        collectedSom: n(r.collected), platformFeeSom: n(r.fee), refundsSom: n(r.refunds), restaurantShareSom: n(r.collected) - n(r.fee) - n(r.refunds),
      }),
    nextCursor: rows.length > q.limit ? encodeCursor(page[page.length - 1]!.at, page[page.length - 1]!.id) : null,
  };
}
