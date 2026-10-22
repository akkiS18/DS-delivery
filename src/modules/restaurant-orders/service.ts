import { Prisma, type OrderStatus } from '@prisma/client';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import type { PaymentEngineV3 } from '../payment/engine.js';
import { acceptOrder, rejectOrder, REJECT_REASONS, type SnapshotProblem } from '../restaurant/acceptance.js';
import { buildRevision } from '../restaurant/price-consent.js';
import { takeStaffAction } from '../restaurant/service.js';
import { isValidPrepMinutes } from '../restaurant/workflow.js';
import { decideRefund, markRefundSent, requestCancellation } from '../refunds/service.js';
import { REJECT_REASONS as REFUND_REJECT_REASONS, RESTAURANT_REASONS } from '../refunds/workflow.js';
import { taxiStage } from '../taxi/workflow.js';
import { autoStartPreparing } from './auto.js';

/** Same buckets the Android tabs use. */
export const FILTERS = {
  // Stage 6F: "new" = paid-or-paying-and-needs-the-restaurant: legacy waiting orders, a payment signal awaiting the restaurant's bank
  // check, and a confirmed payment whose automatic start did not happen. Unpaid orders (PAYMENT_PENDING) are not announced.
  incoming: ['WAITING_RESTAURANT', 'PAYMENT_MATCHED_UNVERIFIED', 'PAYMENT_CONFIRMED'],
  inProgress: ['WAITING_CUSTOMER_CONSENT', 'PAYMENT_PENDING', 'ACCEPTED',
    'PREPARING', 'TAXI_REQUESTED', 'DRIVER_ASSIGNED', 'DELIVERY_ASSUMED', 'CANCELLATION_REQUESTED'],
  // Everything that is (about to be) cooked. Used by the app's new-order poll: an order enters it when it becomes payable-and-actionable
  // or starts cooking automatically, which is the moment the kitchen should hear about it.
  toCook: ['WAITING_RESTAURANT', 'PAYMENT_MATCHED_UNVERIFIED', 'PAYMENT_CONFIRMED', 'PREPARING'],
  ready: ['READY'],
  history: ['COMPLETED', 'RESTAURANT_REJECTED', 'RESTAURANT_EXPIRED', 'PAYMENT_EXPIRED', 'CUSTOMER_CANCELLED', 'CANCELLED', 'FAILED'],
} as const satisfies Record<string, readonly OrderStatus[]>;

export const listQuerySchema = z.object({
  filter: z.enum(['all', 'incoming', 'inProgress', 'toCook', 'ready', 'history']).default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** Keyset cursor: the `number` of the last order of the previous page. */
  cursor: z.coerce.number().int().min(1).optional(),
}).strict();

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
/** Optional everywhere: when omitted the restaurant's default (Restaurant.defaultPrepMinutes) is used. */
const prepSchema = z.number().int().refine(isValidPrepMinutes, 'prepMinutes').optional();
const expected = z.string().regex(/^[A-Z_]{3,40}$/).optional();
export const acceptBodySchema = z.object({ prepMinutes: prepSchema, expectedStatus: expected }).strict();
export const rejectBodySchema = z.object({ reason: z.enum(REJECT_REASONS), expectedStatus: expected }).strict();
export const preparingBodySchema = z.object({ prepMinutes: prepSchema, expectedStatus: expected }).strict();
export const readyBodySchema = z.object({ expectedStatus: expected }).strict();
/** The explicit staff statement that the money is really on the restaurant's bank account. */
export const verifyBodySchema = z.object({ confirmReceived: z.literal(true), expectedStatus: expected }).strict();
export const cancelBodySchema = z.object({ reason: z.enum(RESTAURANT_REASONS), note: z.string().trim().max(300).optional(), expectedStatus: expected }).strict();
export const refundDecisionBodySchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']), rejectReason: z.enum(REFUND_REJECT_REASONS).optional(), expectedStatus: expected,
}).strict().refine(b => b.decision === 'APPROVE' || b.rejectReason !== undefined, { message: 'rejectReason' });
export const refundSentBodySchema = z.object({ bankReference: z.string().trim().min(4).max(64), expectedStatus: expected }).strict();
export const orderIdSchema = idSchema;

export type OrderAction = 'ACCEPT' | 'REJECT' | 'VERIFY_PAYMENT' | 'START_PREPARING' | 'MARK_READY'
  | 'CANCEL_ORDER' | 'REFUND_APPROVE' | 'REFUND_REJECT' | 'REFUND_SENT';

const OPEN_REFUND = ['REQUESTED', 'APPROVED', 'SENT', 'DISPUTED'];

const detailSelect = {
  id: true, number: true, status: true, totalSom: true, createdAt: true, estimatedPrepMinutes: true, prepMinutes: true,
  addressText: true, phoneSnapshot: true, paymentIsTest: true, createdViaBot: true, rejectReason: true,
  restaurantDeadlineAt: true, acceptedAt: true, paymentVerifiedAt: true, preparingStartedAt: true, readyAt: true,
  restaurantId: true,
  restaurant: { select: { defaultPrepMinutes: true, isPaused: true } },
  customer: { select: { displayName: true } },
  taxiCompany: { select: { name: true } },
  items: { where: { supersededAt: null }, select: { productId: true, name: true, unitSom: true, quantity: true, subtotalSom: true } },
  payment: { select: { number: true, status: true, isTest: true, amountTiyin: true, assignedAt: true, matchedAt: true, matchedTransactionId: true, card: { select: { last4: true } } } },
  taxiDispatches: { orderBy: { attemptNo: 'desc' }, take: 1, select: {
    status: true, attemptNo: true, acceptedAt: true, dispatchedAt: true, deliveredAt: true, taxiCompany: { select: { name: true } },
  } },
  refundRequests: { orderBy: { number: 'desc' }, take: 1, select: {
    id: true, number: true, kind: true, status: true, reasonCode: true, requestedByType: true, paidAmountTiyin: true,
    approvedAmountTiyin: true, bankReference: true, sentAt: true, rejectReason: true, requestedAt: true,
  } },
} satisfies Prisma.OrderSelect;
type Row = Prisma.OrderGetPayload<{ select: typeof detailSelect }>;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const som = (t: bigint): number => Number(t / 100n);

/** Facts only the detail view computes (they need extra queries). */
export interface Extras {
  incoming: { source: string; amountTiyin: bigint; occurredAt: Date; receivedAt: Date; trustedSender: boolean; cardLast4: string; minutePrecision: boolean; status: string } | null;
  priceChange: { oldTotalSom: number; newTotalSom: number } | null;
  menuProblems: SnapshotProblem[];
  revision: { id: string; oldTotalSom: number; newTotalSom: number; expiresAt: Date } | null;
}
const NO_EXTRAS: Extras = { incoming: null, priceChange: null, menuProblems: [], revision: null };

type ActionInput = Pick<Row, 'status' | 'createdViaBot' | 'restaurantDeadlineAt'> & {
  paymentStatus: string | null; refund: { status: string } | null; paymentIsTest: boolean;
};

/** What the app may offer. The server re-checks every transition; this only drives which buttons are shown.
 *  VERIFY_PAYMENT is offered only for a matched-but-unverified payment and still needs an explicit confirmation. */
export function allowedActions(o: ActionInput, extras: Pick<Extras, 'priceChange' | 'menuProblems'> = NO_EXTRAS, now = new Date()): OrderAction[] {
  if (!o.createdViaBot) return [];
  const actions: OrderAction[] = [];
  const openRefund = o.refund && OPEN_REFUND.includes(o.refund.status) ? o.refund.status : null;
  if (o.status === 'WAITING_RESTAURANT') {
    // Legacy/rollback only: orders created before 6F (or with RESTAURANT_MANUAL_ACCEPTANCE=true). With a stale price or a missing
    // product only rejection is possible - price proposals no longer exist.
    const open = Boolean(o.restaurantDeadlineAt && o.restaurantDeadlineAt > now);
    if (open && extras.menuProblems.length === 0 && !extras.priceChange) actions.push('ACCEPT');
    actions.push('REJECT');
  } else if (o.status === 'PAYMENT_MATCHED_UNVERIFIED' && o.paymentStatus === 'MATCHED_UNVERIFIED') {
    actions.push('VERIFY_PAYMENT');
  } else if (o.status === 'PAYMENT_CONFIRMED' && o.paymentStatus === 'CONFIRMED_MANUAL' && !openRefund) {
    actions.push('START_PREPARING', 'CANCEL_ORDER');
  } else if (o.status === 'PREPARING' && o.paymentStatus === 'CONFIRMED_MANUAL' && !openRefund) {
    actions.push('MARK_READY', 'CANCEL_ORDER');
  } else if (o.status === 'READY' && o.paymentStatus === 'CONFIRMED_MANUAL' && !openRefund) {
    actions.push('CANCEL_ORDER');
  }
  if (openRefund === 'REQUESTED') actions.push('REFUND_APPROVE', 'REFUND_REJECT');
  if (openRefund === 'APPROVED' || openRefund === 'DISPUTED') actions.push('REFUND_SENT');
  return actions;
}

/** Orders the restaurant has to look at because automation cannot or must not decide. Highest priority first. */
export function attentionCodes(o: Row, extras: Extras): string[] {
  const out: string[] = [];
  const refund = o.refundRequests[0];
  const taxi = o.taxiDispatches[0];
  if (o.status === 'PAYMENT_MATCHED_UNVERIFIED') out.push('VERIFY_PAYMENT');
  if (o.status === 'CANCELLATION_REQUESTED' || refund?.status === 'REQUESTED') out.push('CANCELLATION_REQUESTED');
  if (refund && ['APPROVED', 'DISPUTED'].includes(refund.status)) out.push('REFUND_PENDING');
  if (o.status === 'PAYMENT_CONFIRMED') out.push('AUTO_START_FAILED');
  if (extras.menuProblems.length) out.push('MENU_PROBLEM');
  if (extras.priceChange) out.push('PRICE_CHANGED');
  if (taxi && taxiStage(taxi.status) === 'NEEDS_HELP' && ['PREPARING', 'READY'].includes(o.status)) out.push('TAXI_NEEDS_HELP');
  return out;
}

/** Server-time based preparation clock. The client must compute remaining time as `estimatedReadyAt - serverNow`, adding its own
 *  elapsed time since the response, so a wrong phone clock cannot produce a wrong countdown or a wrong "overdue" figure. */
export function prepClock(o: Pick<Row, 'status' | 'preparingStartedAt' | 'prepMinutes' | 'estimatedPrepMinutes' | 'readyAt'> & { restaurant: { defaultPrepMinutes: number } }, now: Date) {
  const minutes = o.prepMinutes ?? o.estimatedPrepMinutes ?? o.restaurant.defaultPrepMinutes;
  const startedAt = o.preparingStartedAt;
  const estimatedReadyAt = startedAt ? new Date(startedAt.getTime() + minutes * 60_000) : null;
  const cooking = o.status === 'PREPARING' && estimatedReadyAt !== null;
  const remainingSeconds = cooking ? Math.ceil((estimatedReadyAt.getTime() - now.getTime()) / 1000) : null;
  return {
    minutes, startedAt: iso(startedAt), estimatedReadyAt: iso(estimatedReadyAt), readyAt: iso(o.readyAt),
    /** Positive while time is left, negative once overdue; null when the order is not being cooked. */
    remainingSeconds,
    overdueMinutes: remainingSeconds !== null && remainingSeconds < 0 ? Math.floor(-remainingSeconds / 60) : 0,
    isOverdue: remainingSeconds !== null && remainingSeconds < 0,
  };
}

export function orderView(o: Row, extras: Extras = NO_EXTRAS, now = new Date()) {
  const refund = o.refundRequests[0] ?? null;
  const taxi = o.taxiDispatches[0];
  return {
    serverNow: now.toISOString(),
    prep: prepClock(o, now),
    id: o.id, number: o.number, status: o.status, totalSom: o.totalSom, createdAt: o.createdAt.toISOString(),
    estimatedPrepMinutes: o.estimatedPrepMinutes ?? o.prepMinutes,
    /** Pre-selected preparation time for accept / start: the restaurant default (override is optional). */
    defaultPrepMinutes: o.estimatedPrepMinutes ?? o.restaurant.defaultPrepMinutes,
    items: o.items.map(({ name, unitSom, quantity, subtotalSom }) => ({ name, unitSom, quantity, subtotalSom })),
    payment: o.payment && {
      status: o.payment.status, isTest: o.payment.isTest, amountSom: som(o.payment.amountTiyin),
      cardLast4: o.payment.card?.last4 ?? null,
    },
    /** What the restaurant checks before confirming real money. A Gmail signal is NEVER proof of a bank credit. */
    paymentEvidence: o.payment && {
      reference: o.payment.number, expectedAmountSom: som(o.payment.amountTiyin), status: o.payment.status, isTest: o.payment.isTest,
      cardLast4: o.payment.card?.last4 ?? null, assignedAt: iso(o.payment.assignedAt), matchedAt: iso(o.payment.matchedAt),
      verifiedAt: iso(o.paymentVerifiedAt),
      signal: extras.incoming && {
        source: extras.incoming.source, amountSom: som(extras.incoming.amountTiyin), occurredAt: extras.incoming.occurredAt.toISOString(),
        receivedAt: extras.incoming.receivedAt.toISOString(), trustedSender: extras.incoming.trustedSender, cardLast4: extras.incoming.cardLast4,
        amountMatches: extras.incoming.amountTiyin === o.payment.amountTiyin,
      },
      notBankProof: !o.payment.isTest,
    },
    // Progress of the latest dispatch, driven by the taxi operator bot: requested -> accepted -> dispatched -> delivered.
    // Only `stage: DELIVERED` (operator-confirmed, order COMPLETED) means delivery; nothing earlier does.
    taxi: taxi ? {
      status: taxi.status, stage: taxiStage(taxi.status), attemptNo: taxi.attemptNo,
      companyName: taxi.taxiCompany.name, acceptedAt: iso(taxi.acceptedAt),
      dispatchedAt: iso(taxi.dispatchedAt), deliveredAt: iso(taxi.deliveredAt),
    } : null,
    taxiCompanyName: o.taxiCompany?.name ?? null,
    customerName: o.customer.displayName ?? null,
    customerPhone: o.phoneSnapshot,
    addressText: o.addressText,
    isTest: o.paymentIsTest,
    rejectReason: o.rejectReason,
    restaurantDeadlineAt: iso(o.restaurantDeadlineAt),
    acceptedAt: iso(o.acceptedAt), paymentVerifiedAt: iso(o.paymentVerifiedAt),
    preparingStartedAt: iso(o.preparingStartedAt), readyAt: iso(o.readyAt),
    // Only legacy waiting orders can still show a stale price; price proposals no longer exist.
    priceChange: extras.priceChange,
    menuProblems: extras.menuProblems.map(p => ({ kind: p.kind, name: p.name })),
    /** An old proposal that is still waiting for the customer (created before 6F). Read-only. */
    priceProposal: extras.revision && { oldTotalSom: extras.revision.oldTotalSom, newTotalSom: extras.revision.newTotalSom, expiresAt: extras.revision.expiresAt.toISOString() },
    refund: refund && {
      id: refund.id, number: refund.number, kind: refund.kind, status: refund.status, reasonCode: refund.reasonCode, requestedBy: refund.requestedByType,
      paidAmountSom: som(refund.paidAmountTiyin), approvedAmountSom: refund.approvedAmountTiyin === null ? null : som(refund.approvedAmountTiyin),
      bankReference: refund.bankReference, sentAt: iso(refund.sentAt), rejectReason: refund.rejectReason, requestedAt: refund.requestedAt.toISOString(),
    },
    attention: attentionCodes(o, extras),
    allowedActions: allowedActions({ ...o, paymentStatus: o.payment?.status ?? null, paymentIsTest: o.paymentIsTest, refund: refund && { status: refund.status } }, extras, now),
    awaitingPaymentVerification: o.status === 'PAYMENT_MATCHED_UNVERIFIED',
  };
}
export type OrderView = ReturnType<typeof orderView>;

/** The detail view needs a few more reads (bank signal, current menu vs the order snapshot, open price proposal). */
async function loadExtras(row: Row): Promise<Extras> {
  const extras: Extras = { ...NO_EXTRAS };
  if (row.payment?.matchedTransactionId) {
    const t = await db.incomingTransaction.findUnique({ where: { id: row.payment.matchedTransactionId } });
    if (t) extras.incoming = { source: t.source, amountTiyin: t.amountTiyin, occurredAt: t.occurredAt, receivedAt: t.receivedAt, trustedSender: t.trustedSender, cardLast4: t.cardLast4, minutePrecision: t.minutePrecision, status: t.status };
  }
  if (row.status === 'WAITING_RESTAURANT') {
    const ids = row.items.map(i => i.productId).filter((id): id is string => id !== null);
    const menu = new Map((await db.product.findMany({ where: { id: { in: ids } } })).map(p => [p.id, p]));
    const plan = buildRevision(row.items, menu, row.restaurantId);
    if (plan.ok) extras.priceChange = { oldTotalSom: plan.oldTotal, newTotalSom: plan.newTotal };
    else extras.menuProblems = plan.problems.filter(p => p.kind !== 'PRICE_CHANGED');
  }
  if (row.status === 'WAITING_CUSTOMER_CONSENT') {
    const rev = await db.orderPriceRevision.findFirst({ where: { orderId: row.id, status: 'PROPOSED' }, orderBy: { proposedAt: 'desc' } });
    if (rev) extras.revision = { id: rev.id, oldTotalSom: rev.oldTotalSom, newTotalSom: rev.newTotalSom, expiresAt: rev.expiresAt };
  }
  return extras;
}

/** Tenant isolation lives in the WHERE clause: another restaurant's order is just "not found". */
export async function getOrderView(restaurantId: string, orderId: string): Promise<OrderView | null> {
  const row = await db.order.findFirst({ where: { id: orderId, restaurantId }, select: detailSelect });
  return row ? orderView(row, await loadExtras(row)) : null;
}

export async function listOrders(restaurantId: string, q: z.output<typeof listQuerySchema>) {
  const base: Prisma.OrderWhereInput = { restaurantId, createdViaBot: true };
  const statusIn = (s: readonly OrderStatus[]): Prisma.OrderWhereInput => ({ ...base, status: { in: [...s] } });
  const where: Prisma.OrderWhereInput = {
    ...(q.filter === 'all' ? base : statusIn(FILTERS[q.filter])),
    ...(q.cursor ? { number: { lt: q.cursor } } : {}),
  };
  const [rows, grouped, attention] = await Promise.all([
    db.order.findMany({ where, orderBy: { number: 'desc' }, take: q.limit + 1, select: detailSelect }),
    db.order.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    db.order.count({ where: { ...base, OR: [
      { status: 'CANCELLATION_REQUESTED' }, // unverified/confirmed orders are already counted in `incoming`
      { status: { in: ['PREPARING', 'READY'] }, taxiDispatches: { some: { status: { in: ['NEEDS_HELP', 'CANCELLATION_PENDING', 'DECLINED'] } } } },
      { refundRequests: { some: { status: { in: ['REQUESTED', 'APPROVED', 'DISPUTED'] } } } },
    ] } }),
  ]);
  const page = rows.slice(0, q.limit);
  const count = (s: readonly OrderStatus[]) => grouped.filter(g => s.includes(g.status)).reduce((n, g) => n + g._count._all, 0);
  return {
    orders: page.map(r => orderView(r)),
    nextCursor: rows.length > q.limit ? page[page.length - 1]!.number : null,
    counts: { incoming: count(FILTERS.incoming), inProgress: count(FILTERS.inProgress), toCook: count(FILTERS.toCook), ready: count(FILTERS.ready), attention },
  };
}

export type ActionOutcome =
  | { ok: true; order: OrderView; autoStart?: { started: boolean; reason?: string } }
  | { ok: false; httpStatus: 400 | 404 | 409; error: string; status?: string; problems?: SnapshotProblem[]; canProposePrice?: boolean };

const BAD_INPUT = new Set(['TAYYORLASH_VAQTI_NOTOGRI', 'RAD_SABABI_NOTOGRI', 'SABAB_NOTOGRI', 'BANK_REFERENCE_NOTOGRI']);
const WRONG_STATE = new Set(['TOLOV_MOS_EMAS_YOKI_AVVAL_TASDIQLANGAN', 'TAYYORLASH_UCHUN_TOLOV_TASDIGI_KERAK',
  'BUYURTMA_TAYYORLASHDA_EMAS', 'BANK_REFERENCE_TAKROR', 'REFUND_SUMMASI_MOS_EMAS', 'NOTOGRI_OTISH', 'HOLAT_ORALIQDA_OZGARDI']);
/** The stored bank signal does not match the payment (amount, sender, link): the restaurant must not confirm. */
const EVIDENCE_INVALID = new Set(['TOLOV_SUMMASI_MOS_EMAS', 'TOLOV_MOS_EMAS']);

export type ActionArgs = {
  prepMinutes?: number | undefined; reason?: (typeof REJECT_REASONS)[number] | (typeof RESTAURANT_REASONS)[number] | undefined;
  note?: string | undefined; decision?: 'APPROVE' | 'REJECT' | undefined; rejectReason?: (typeof REFUND_REJECT_REASONS)[number] | undefined;
  bankReference?: string | undefined; expectedStatus?: string | undefined;
};

/** Runs one restaurant action through the same services the Telegram staff buttons used. The restaurant id is the
 *  session's; nothing here writes Order.status directly. */
export async function performOrderAction(
  engine: PaymentEngineV3,
  restaurantId: string,
  orderId: string,
  action: OrderAction,
  args: ActionArgs,
): Promise<ActionOutcome> {
  const current = await db.order.findFirst({
    where: { id: orderId, restaurantId, createdViaBot: true },
    select: { status: true, estimatedPrepMinutes: true, restaurant: { select: { defaultPrepMinutes: true } } },
  });
  if (!current) return { ok: false, httpStatus: 404, error: 'NOT_FOUND' };
  if (args.expectedStatus && args.expectedStatus !== current.status) {
    return { ok: false, httpStatus: 409, error: 'STALE', status: current.status };
  }
  const stale = async (error = 'STALE'): Promise<ActionOutcome> => ({
    ok: false, httpStatus: 409, error,
    status: (await db.order.findFirst({ where: { id: orderId, restaurantId }, select: { status: true } }))?.status,
  });
  const alreadyReady = async (a: OrderAction) => a === 'MARK_READY'
    && (await db.order.findFirst({ where: { id: orderId, restaurantId }, select: { status: true } }))?.status === 'READY';
  const actor = { actorRestaurantId: restaurantId, orderId } as const;
  const label = `restaurant-api:${restaurantId}`;
  // One preparation time, asked once: the explicit value, else the one stored at acceptance, else the restaurant default.
  const prepMinutes = args.prepMinutes ?? current.estimatedPrepMinutes ?? current.restaurant.defaultPrepMinutes;
  let autoStart: { started: boolean; reason?: string } | undefined;
  try {
    if (action === 'ACCEPT') {
      const r = await acceptOrder(engine, { ...actor, prepMinutes: args.prepMinutes ?? current.restaurant.defaultPrepMinutes });
      if (r.result === 'PROBLEMS') {
        return { ok: false, httpStatus: 409, error: 'ORDER_PROBLEMS', status: 'WAITING_RESTAURANT', problems: r.problems,
          canProposePrice: r.problems.every(p => p.kind === 'PRICE_CHANGED') };
      }
      if (r.result === 'RESTAURANT_CLOSED') return stale('RESTAURANT_CLOSED');
      if (r.result === 'TIMED_OUT') return stale('TIMED_OUT');
      if (r.result === 'STALE') return stale();
    } else if (action === 'REJECT') {
      if ((await rejectOrder({ ...actor, reason: args.reason as (typeof REJECT_REASONS)[number] })).result === 'STALE') return stale();
    } else if (action === 'VERIFY_PAYMENT') {
      const r = await takeStaffAction({ ...actor, action: 'VERIFY_PAYMENT' });
      if (!r.changed) return stale();
      // Only after this explicit, audited verification may cooking start by itself.
      autoStart = await autoStartPreparing({ actorRestaurantId: restaurantId }, orderId);
    } else if (action === 'START_PREPARING' || action === 'MARK_READY') {
      // READY is idempotent: a double tap or a retry after a lost response must not turn into an error. Nothing is written twice.
      if (action === 'MARK_READY' && current.status === 'READY') {
        const view = await getOrderView(restaurantId, orderId);
        return view ? { ok: true, order: view } : { ok: false, httpStatus: 404, error: 'NOT_FOUND' };
      }
      try {
        const r = await takeStaffAction({ ...actor, action, ...(action === 'START_PREPARING' ? { prepMinutes } : {}) });
        if (!r.changed && !(await alreadyReady(action))) return stale();
      } catch (err) {
        // Concurrent taps: the loser's transition is refused because the winner already made the order READY - that is success.
        if (!(await alreadyReady(action))) throw err;
      }
    } else if (action === 'CANCEL_ORDER') {
      const r = await requestCancellation({ actorType: 'RESTAURANT_STAFF', actorTelegramId: label, restaurantId, orderId,
        reasonCode: args.reason as string, ...(args.note ? { note: args.note } : {}) });
      if (r.result === 'NOT_FOUND') return { ok: false, httpStatus: 404, error: 'NOT_FOUND' };
      if (r.result === 'ALREADY_REQUESTED') return stale('REFUND_ALREADY_OPEN');
      if (r.result !== 'APPROVED') return stale('INVALID_STATE');
    } else {
      // refund steps address the order's latest open refund
      const open = await db.refundRequest.findFirst({
        where: { orderId, status: { in: action === 'REFUND_SENT' ? ['APPROVED', 'DISPUTED'] : ['REQUESTED'] }, order: { restaurantId } },
        orderBy: { number: 'desc' }, select: { id: true },
      });
      if (!open) return stale('NO_OPEN_REFUND');
      const r = action === 'REFUND_SENT'
        ? await markRefundSent({ actorTelegramId: label, restaurantId, refundId: open.id, bankReference: args.bankReference! })
        : await decideRefund({ actorTelegramId: label, restaurantId, refundId: open.id, decision: action === 'REFUND_APPROVE' ? 'APPROVE' : 'REJECT',
          ...(action === 'REFUND_REJECT' ? { rejectReason: args.rejectReason! } : {}) });
      if (r.result === 'NOT_FOUND') return { ok: false, httpStatus: 404, error: 'NOT_FOUND' };
      if (r.result === 'STALE') return stale();
    }
  } catch (err) {
    const code = err instanceof Error ? err.message : '';
    if (code === 'RUXSAT_YOQ') return { ok: false, httpStatus: 404, error: 'NOT_FOUND' };
    if (BAD_INPUT.has(code)) return { ok: false, httpStatus: 400, error: code };
    if (action === 'VERIFY_PAYMENT' && EVIDENCE_INVALID.has(code)) return stale('PAYMENT_EVIDENCE_INVALID');
    if (WRONG_STATE.has(code) || EVIDENCE_INVALID.has(code)) return stale('INVALID_STATE');
    throw err;
  }
  const order = await getOrderView(restaurantId, orderId);
  return order ? { ok: true, order, ...(autoStart ? { autoStart } : {}) } : { ok: false, httpStatus: 404, error: 'NOT_FOUND' };
}
