import { db } from '../../lib/db.js';
import { isPlatformHeld } from '../refunds/workflow.js';

/**
 * DS Admin app, A4c: refunds. DS Delivery never moves money: the restaurant refunds from its own account and the platform only records who said what.
 * The administrator confirms with a written note (adminConfirmRefund) and, when the customer paid onto the PLATFORM card (the platform holds the money),
 * also sends the refund himself and types the bank reference (adminMarkRefundSent): the restaurant never had that money.
 */
export const OPEN_STATUSES = ['REQUESTED', 'APPROVED', 'SENT', 'DISPUTED'] as const;
const RECENT_DAYS = 14;

const REASON_LABEL: Record<string, string> = {
  CHANGED_MIND: 'Fikrim o‘zgardi', TOO_SLOW: 'Juda kech bo‘lyapti', WRONG_ORDER: 'Noto‘g‘ri buyurtma', OTHER: 'Boshqa sabab',
  OUT_OF_STOCK: 'Mahsulot tugagan', CANNOT_FULFIL: 'Bajara olmaymiz', CLOSED: 'Restoran yopiq',
  MONEY_NOT_RECEIVED: 'Pul kelmagan', ALREADY_PREPARED: 'Allaqachon tayyorlangan', POLICY: 'Qoida bo‘yicha',
};
export const reasonLabel = (code: string | null): string | null => (code ? REASON_LABEL[code] ?? code : null);

export interface RefundRow {
  id: string; number: number; orderCode: string; restaurantName: string; status: string; kind: string;
  reason: string | null; paidSom: number; approvedSom: number | null; requestedAt: string; lastAt: string;
  /** The administrator may confirm it (the customer is the normal confirmer; an administrator steps in after checking independently). */
  canConfirm: boolean;
  /** The customer paid onto a platform card: the money is the platform's, so the administrator (not the restaurant) refunds it. */
  byPlatform: boolean;
  /** The administrator should now send the refund from the platform card and type the bank reference (approved, or disputed after a first send). */
  canSend: boolean;
}

const rowSelect = {
  id: true, number: true, status: true, kind: true, reasonCode: true, paidAmountTiyin: true, approvedAmountTiyin: true,
  requestedAt: true, decidedAt: true, sentAt: true, disputedAt: true, confirmedAt: true,
  order: { select: { code: true, restaurant: { select: { name: true } } } },
  payment: { select: { method: true, card: { select: { restaurantId: true } } } },
} as const;

type RowSource = {
  id: string; number: number; status: string; kind: string; reasonCode: string; paidAmountTiyin: bigint; approvedAmountTiyin: bigint | null;
  requestedAt: Date; decidedAt: Date | null; sentAt: Date | null; disputedAt: Date | null; confirmedAt: Date | null;
  order: { code: string; restaurant: { name: string } };
  payment: { method: string; card: { restaurantId: string | null } | null };
};

const som = (tiyin: bigint): number => Number(tiyin / 100n);

/** Pure: one list row. `lastAt` is the newest thing that happened to the request. */
export function toRow(r: RowSource): RefundRow {
  const stamps = [r.requestedAt, r.decidedAt, r.sentAt, r.disputedAt, r.confirmedAt].filter((d): d is Date => d !== null);
  const last = stamps.reduce((a, b) => (b.getTime() > a.getTime() ? b : a));
  return {
    id: r.id, number: r.number, orderCode: r.order.code, restaurantName: r.order.restaurant.name, status: r.status, kind: r.kind,
    reason: reasonLabel(r.reasonCode), paidSom: som(r.paidAmountTiyin), approvedSom: r.approvedAmountTiyin === null ? null : som(r.approvedAmountTiyin),
    requestedAt: r.requestedAt.toISOString(), lastAt: last.toISOString(), canConfirm: r.status === 'SENT' || r.status === 'DISPUTED',
    byPlatform: isPlatformHeld(r.payment), canSend: isPlatformHeld(r.payment) && (r.status === 'APPROVED' || r.status === 'DISPUTED'),
  };
}

export async function listRefunds(): Promise<{ open: RefundRow[]; recent: RefundRow[] }> {
  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);
  const [open, recent] = await Promise.all([
    db.refundRequest.findMany({ where: { status: { in: [...OPEN_STATUSES] } }, orderBy: { requestedAt: 'asc' }, take: 60, select: rowSelect }),
    db.refundRequest.findMany({ where: { status: { in: ['REJECTED', 'CONFIRMED'] }, requestedAt: { gte: since } }, orderBy: { requestedAt: 'desc' }, take: 30, select: rowSelect }),
  ]);
  return { open: open.map(toRow), recent: recent.map(toRow) };
}

export interface RefundDetail extends RefundRow {
  rejectReason: string | null; confirmNote: string | null; confirmedByType: string | null; hasReceipt: boolean;
  restaurantPhone: string | null; customerName: string | null; customerPhone: string | null;
  events: Array<{ at: string; actor: string; action: string; from: string | null; to: string | null }>;
}

export async function refundDetail(id: string): Promise<RefundDetail | null> {
  const r = await db.refundRequest.findUnique({
    where: { id },
    select: {
      ...rowSelect, rejectReason: true, confirmNote: true, confirmedByType: true, receiptKey: true, bankReference: true,
      order: { select: { code: true, restaurant: { select: { name: true, pickupPhone: true } }, customer: { select: { displayName: true, phone: true } } } },
      events: { orderBy: { createdAt: 'asc' }, take: 100, select: { createdAt: true, actorType: true, action: true, fromStatus: true, toStatus: true } },
    },
  });
  if (!r) return null;
  return {
    ...toRow(r), rejectReason: reasonLabel(r.rejectReason), confirmNote: r.confirmNote, confirmedByType: r.confirmedByType,
    hasReceipt: r.receiptKey !== null || r.bankReference !== null,
    restaurantPhone: r.order.restaurant.pickupPhone, customerName: r.order.customer.displayName, customerPhone: r.order.customer.phone,
    events: r.events.map(e => ({ at: e.createdAt.toISOString(), actor: e.actorType, action: e.action, from: e.fromStatus, to: e.toStatus })),
  };
}
