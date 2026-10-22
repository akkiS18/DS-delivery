import { db } from '../../lib/db.js';
import { isSupportAdmin } from '../support/service.js';
import { REVIEW_ACTIONS, type ReviewAction } from './review-reasons.js';

/**
 * Stage 8C: what an administrator sees and does about money that arrived but matched no payment. Nothing here moves money or changes a
 * payment: it records WHO decided WHAT and WHY, so the decision survives. Returning the money to the payer is done in the bank.
 */

export interface ReviewItem {
  id: string;
  cardLast4: string;
  amountTiyin: bigint;
  occurredAt: Date;
  emailReceivedAt: Date | null;
  reason: string | null;
  source: string;
  restaurantName: string | null;
}

export async function listUnhandledReviews(limit = 10): Promise<ReviewItem[]> {
  const rows = await db.incomingTransaction.findMany({
    where: { status: 'REVIEW_REQUIRED', handledAt: null, source: 'GMAIL' },
    orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }], take: limit,
  });
  const cards = await db.card.findMany({
    where: { last4: { in: [...new Set(rows.map(r => r.cardLast4))] } }, select: { last4: true, restaurant: { select: { name: true } } },
  });
  const byLast4 = new Map(cards.map(c => [c.last4, c.restaurant?.name ?? null]));
  return rows.map(r => ({
    id: r.id, cardLast4: r.cardLast4, amountTiyin: r.amountTiyin, occurredAt: r.occurredAt, emailReceivedAt: r.emailReceivedAt,
    reason: r.reason, source: r.source, restaurantName: byLast4.get(r.cardLast4) ?? null,
  }));
}

export const countUnhandledReviews = (): Promise<number> =>
  db.incomingTransaction.count({ where: { status: 'REVIEW_REQUIRED', handledAt: null, source: 'GMAIL' } });

export type HandleResult = { result: 'HANDLED' } | { result: 'ALREADY_HANDLED' | 'NOT_FOUND' };

export const NOTE_MIN = 10;
export const NOTE_MAX = 300;

/** Compare-and-set on "not handled yet": two administrators closing the same item produce one record. */
export async function handleReview(input: { incomingId: string; adminId: string; action: ReviewAction; note: string }, now = new Date()): Promise<HandleResult> {
  if (!isSupportAdmin(input.adminId)) throw new Error('ADMIN_RUXSAT_YOQ');
  const note = input.note.trim();
  if (note.length < NOTE_MIN || note.length > NOTE_MAX) throw new Error('ADMIN_IZOH_NOTOGRI');
  if (!REVIEW_ACTIONS.includes(input.action)) throw new Error('AMAL_NOTOGRI');
  return db.$transaction(async tx => {
    const row = await tx.incomingTransaction.findUnique({ where: { id: input.incomingId }, select: { id: true, status: true } });
    if (!row || row.status !== 'REVIEW_REQUIRED') return { result: 'NOT_FOUND' } as const;
    const { count } = await tx.incomingTransaction.updateMany({
      where: { id: row.id, status: 'REVIEW_REQUIRED', handledAt: null },
      data: { handledAt: now, handledBy: input.adminId, handledAction: input.action, handledNote: note },
    });
    return count === 1 ? ({ result: 'HANDLED' } as const) : ({ result: 'ALREADY_HANDLED' } as const);
  });
}

export interface StaleVerification { orderNumber: number | null; restaurantName: string; amountTiyin: bigint; matchedAt: Date }

/** Payments the bank e-mail matched but the restaurant has not confirmed yet for a while: the customer paid and nobody is cooking. */
export async function listStaleUnverified(minutes = 10, now = new Date()): Promise<StaleVerification[]> {
  const rows = await db.payment.findMany({
    where: { status: 'MATCHED_UNVERIFIED', isTest: false, matchedAt: { lte: new Date(now.getTime() - minutes * 60_000) } },
    orderBy: { matchedAt: 'asc' }, take: 20,
    select: { amountTiyin: true, matchedAt: true, order: { select: { number: true } }, restaurant: { select: { name: true } } },
  });
  return rows.map(r => ({ orderNumber: r.order?.number ?? null, restaurantName: r.restaurant?.name ?? '—', amountTiyin: r.amountTiyin, matchedAt: r.matchedAt! }));
}
