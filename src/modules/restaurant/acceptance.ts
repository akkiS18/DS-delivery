import { db } from '../../lib/db.js';
import type { PaymentEngineV3 } from '../payment/engine.js';
import { isValidPrepMinutes } from './workflow.js';
import { actorLabel, isActorOf, restaurantScope, type StaffActor } from './actor.js';

export const REJECT_REASONS = ['UNAVAILABLE', 'PRICE_CHANGED', 'CLOSED', 'OTHER'] as const;
export type RejectReason = typeof REJECT_REASONS[number];

/**
 * Stage 6F: there is no routine manual acceptance. Server-side validation (restaurant open, products available, prices current)
 * at checkout replaces it, and the order is created directly in PAYMENT_PENDING with its payment attempt. The legacy
 * "restaurant must accept first" flow (WAITING_RESTAURANT) is kept for rollback and for orders created before 6F; it is used
 * only when RESTAURANT_MANUAL_ACCEPTANCE=true. (RESTAURANT_ACCEPTANCE_MOCK is retired and ignored.)
 */
export function acceptanceRequired(_paymentMode: 'MOCK' | 'REAL', env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RESTAURANT_MANUAL_ACCEPTANCE === 'true';
}

export function responseTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.RESTAURANT_RESPONSE_SECONDS ?? 600);
  if (!Number.isSafeInteger(n) || n < 30 || n > 86_400) {
    throw new Error('RESTAURANT_RESPONSE_SECONDS 30–86400 oralig‘ida bo‘lsin');
  }
  return n * 1000;
}

export type SnapshotProblem =
  | { kind: 'MISSING' | 'UNAVAILABLE'; name: string }
  | { kind: 'PRICE_CHANGED'; name: string; snapshotSom: number; currentSom: number };

/** Pure: the order lines (snapshot taken at placement) must still match the live menu. */
export function validateSnapshot(
  lines: Array<{ productId: string | null; name: string; unitSom: number }>,
  products: Map<string, { restaurantId: string; isAvailable: boolean; priceSom: number }>,
  restaurantId: string,
): SnapshotProblem[] {
  const problems: SnapshotProblem[] = [];
  for (const line of lines) {
    const p = line.productId ? products.get(line.productId) : undefined;
    if (!p || p.restaurantId !== restaurantId) problems.push({ kind: 'MISSING', name: line.name });
    else if (!p.isAvailable) problems.push({ kind: 'UNAVAILABLE', name: line.name });
    else if (p.priceSom !== line.unitSom) {
      problems.push({ kind: 'PRICE_CHANGED', name: line.name, snapshotSom: line.unitSom, currentSom: p.priceSom });
    }
  }
  return problems;
}

export type AcceptResult =
  | { result: 'ACCEPTED'; orderId: string; paymentId: string }
  | { result: 'STALE' }
  | { result: 'TIMED_OUT' }
  | { result: 'PROBLEMS'; problems: SnapshotProblem[] }
  | { result: 'RESTAURANT_CLOSED' };
export type RejectResult = { result: 'REJECTED' } | { result: 'STALE' };

/** Carries a non-error outcome out of the checkout transaction, which rolls back. */
class Outcome extends Error { constructor(readonly value: AcceptResult) { super(value.result); } }

async function authorizedOrder(actor: StaffActor, orderId: string) {
  if (actor.actorSystemId !== undefined) throw new Error('RUXSAT_YOQ'); // accept/reject are human decisions
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { createdViaBot: true, paymentIsTest: true, restaurant: { select: { id: true, staffTelegramUserId: true } } },
  });
  if (!order || !order.createdViaBot || !isActorOf(order.restaurant, actor)) throw new Error('RUXSAT_YOQ');
  return order;
}

/** Restaurant accepts: price/availability re-validated, then in ONE transaction under the payment lock the order
 *  moves WAITING_RESTAURANT -> PAYMENT_PENDING and its single payment attempt is created. A duplicate or late
 *  acceptance finds the status changed and creates nothing. */
export async function acceptOrder(engine: PaymentEngineV3, input: StaffActor & {
  orderId: string; prepMinutes: number;
}): Promise<AcceptResult> {
  const actor = actorLabel(input);
  if (!isValidPrepMinutes(input.prepMinutes)) throw new Error('TAYYORLASH_VAQTI_NOTOGRI');
  const pre = await authorizedOrder(input, input.orderId);
  try {
    const { order, payment } = await engine.createCheckout(async tx => {
      const now = new Date();
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        include: { items: { where: { supersededAt: null } },
          restaurant: { select: { id: true, staffTelegramUserId: true, isActive: true, isPaused: true } } },
      });
      if (!order || !order.createdViaBot || !isActorOf(order.restaurant, input)) {
        throw new Error('RUXSAT_YOQ');
      }
      if (order.status !== 'WAITING_RESTAURANT') throw new Outcome({ result: 'STALE' });
      if (!order.restaurantDeadlineAt || order.restaurantDeadlineAt <= now) {
        throw new Outcome({ result: 'TIMED_OUT' });
      }
      // Stage 4B-2: a restaurant that closed or paused after placement cannot accept.
      if (!order.restaurant.isActive || order.restaurant.isPaused) throw new Outcome({ result: 'RESTAURANT_CLOSED' });
      const ids = order.items.map(i => i.productId).filter((id): id is string => id !== null);
      const products = new Map((await tx.product.findMany({ where: { id: { in: ids } } })).map(p => [p.id, p]));
      // A service-fee line is compared at the restaurant's own menu price, not at the fee-inclusive price the customer pays.
      const problems = validateSnapshot(order.items.map(i => ({ ...i, unitSom: i.baseUnitSom ?? i.unitSom })), products, order.restaurantId);
      if (problems.length) throw new Outcome({ result: 'PROBLEMS', problems });
      const claimed = await tx.order.updateMany({
        where: { id: order.id, status: 'WAITING_RESTAURANT', restaurantDeadlineAt: { gt: now } },
        data: { status: 'PAYMENT_PENDING', acceptedAt: now, acceptedBy: actor,
          estimatedPrepMinutes: input.prepMinutes },
      });
      if (claimed.count !== 1) throw new Outcome({ result: 'STALE' });
      await tx.orderEvent.create({ data: {
        orderId: order.id, actorTelegramId: actor, actorType: 'RESTAURANT_STAFF', action: 'ACCEPT',
        fromStatus: 'WAITING_RESTAURANT', toStatus: 'PAYMENT_PENDING',
        details: { totalSom: order.totalSom, prepMinutes: input.prepMinutes,
          items: order.items.map(i => ({ productId: i.productId, name: i.name, unitSom: i.unitSom, quantity: i.quantity })) },
      } });
      return order;
    }, pre.paymentIsTest);
    return { result: 'ACCEPTED', orderId: order.id, paymentId: payment.id };
  } catch (err) {
    if (!(err instanceof Outcome)) throw err;
    if (err.value.result === 'TIMED_OUT') await expireWaitingOrders();
    if (err.value.result === 'PROBLEMS' || err.value.result === 'RESTAURANT_CLOSED') {
      // The transaction rolled back; keep the refusal in the audit trail.
      await db.orderEvent.create({ data: {
        orderId: input.orderId, actorTelegramId: actor, actorType: 'RESTAURANT_STAFF',
        action: 'ACCEPT_REFUSED', fromStatus: 'WAITING_RESTAURANT', toStatus: 'WAITING_RESTAURANT',
        details: err.value.result === 'PROBLEMS' ? { problems: err.value.problems } : { reason: 'RESTAURANT_CLOSED' },
      } });
    }
    return err.value;
  }
}

/** Atomic reject: only a still-waiting order can be rejected, exactly once. */
export async function rejectOrder(input: StaffActor & {
  orderId: string; reason: RejectReason;
}): Promise<RejectResult> {
  const actor = actorLabel(input);
  if (!REJECT_REASONS.includes(input.reason)) throw new Error('RAD_SABABI_NOTOGRI');
  await authorizedOrder(input, input.orderId);
  return db.$transaction(async tx => {
    const now = new Date();
    const { count } = await tx.order.updateMany({
      where: { id: input.orderId, status: 'WAITING_RESTAURANT', restaurant: restaurantScope(input) },
      data: { status: 'RESTAURANT_REJECTED', rejectedAt: now, rejectedBy: actor, rejectReason: input.reason },
    });
    if (count !== 1) return { result: 'STALE' };
    await tx.orderEvent.create({ data: {
      orderId: input.orderId, actorTelegramId: actor, actorType: 'RESTAURANT_STAFF', action: 'REJECT',
      fromStatus: 'WAITING_RESTAURANT', toStatus: 'RESTAURANT_REJECTED', details: { reason: input.reason },
    } });
    return { result: 'REJECTED' };
  });
}

/** Response timeout sweep. Safe to run from several workers: each order flips once. Returns the expired order ids. */
export async function expireWaitingOrders(now = new Date()): Promise<string[]> {
  const due = await db.order.findMany({
    where: { status: 'WAITING_RESTAURANT', restaurantDeadlineAt: { lte: now } }, select: { id: true }, take: 100,
  });
  const expired: string[] = [];
  for (const { id } of due) {
    const done = await db.$transaction(async tx => {
      const { count } = await tx.order.updateMany({
        where: { id, status: 'WAITING_RESTAURANT', restaurantDeadlineAt: { lte: now } },
        data: { status: 'RESTAURANT_EXPIRED' },
      });
      if (count !== 1) return false;
      await tx.orderEvent.create({ data: {
        orderId: id, actorTelegramId: 'system', actorType: 'SYSTEM', action: 'RESTAURANT_TIMEOUT',
        fromStatus: 'WAITING_RESTAURANT', toStatus: 'RESTAURANT_EXPIRED',
      } });
      return true;
    });
    if (done) expired.push(id);
  }
  return expired;
}
