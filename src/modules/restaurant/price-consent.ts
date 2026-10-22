import { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';
import type { PaymentEngineV3 } from '../payment/engine.js';
import { validateSnapshot, type SnapshotProblem } from './acceptance.js';
import { isValidPrepMinutes } from './workflow.js';
import { actorChannel, actorLabel, isActorOf, type StaffActor } from './actor.js';

export function consentTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.PRICE_CONSENT_SECONDS ?? 300);
  if (!Number.isSafeInteger(n) || n < 30 || n > 3_600) throw new Error('PRICE_CONSENT_SECONDS 30–3600 oralig‘ida bo‘lsin');
  return n * 1000;
}

export type Line = { productId: string | null; name: string; unitSom: number; quantity: number; subtotalSom: number };
type Menu = Map<string, { restaurantId: string; isAvailable: boolean; priceSom: number }>;

/** Pure. A revision is only possible when the ONLY problem is a changed price; unavailable/missing products must be rejected. */
export function buildRevision(lines: Line[], menu: Menu, restaurantId: string):
  { ok: true; lines: Line[]; oldTotal: number; newTotal: number } | { ok: false; problems: SnapshotProblem[] } {
  const problems = validateSnapshot(lines, menu, restaurantId);
  const blocking = problems.filter(p => p.kind !== 'PRICE_CHANGED');
  if (blocking.length) return { ok: false, problems };
  const revised = lines.map(l => {
    const unitSom = menu.get(l.productId!)!.priceSom;
    return { ...l, unitSom, subtotalSom: unitSom * l.quantity };
  });
  const newTotal = revised.reduce((n, l) => n + l.subtotalSom, 0);
  if (!Number.isSafeInteger(newTotal) || newTotal > 100_000_000) return { ok: false, problems };
  const oldTotal = lines.reduce((n, l) => n + l.subtotalSom, 0);
  if (newTotal === oldTotal && problems.length === 0) return { ok: false, problems };
  return { ok: true, lines: revised, oldTotal, newTotal };
}

export type ProposeResult =
  | { result: 'PROPOSED'; revisionId: string; oldTotal: number; newTotal: number }
  | { result: 'STALE' } | { result: 'TIMED_OUT' } | { result: 'RESTAURANT_CLOSED' }
  | { result: 'NOT_REVISABLE'; problems: SnapshotProblem[] };

async function staffOrder(actor: StaffActor, orderId: string) {
  if (actor.actorSystemId !== undefined) throw new Error('RUXSAT_YOQ'); // a price change is a human decision
  const order = await db.order.findUnique({
    where: { id: orderId }, select: { createdViaBot: true, restaurant: { select: { id: true, staffTelegramUserId: true } } },
  });
  if (!order || !order.createdViaBot || !isActorOf(order.restaurant, actor)) throw new Error('RUXSAT_YOQ');
}

/** Restaurant offers the current price. Nothing is charged and no payment exists until the customer consents. */
export async function proposePriceRevision(input: StaffActor & {
  orderId: string; prepMinutes: number;
}): Promise<ProposeResult> {
  // Stage 6F: prices are validated and frozen BEFORE payment, so a price change after the order exists is no longer a
  // workflow. Orders already waiting for a customer's consent can still be answered/expired; nothing new is proposed.
  if (process.env.LEGACY_PRICE_PROPOSALS !== 'true') throw new Error('PRICE_PROPOSALS_REMOVED');
  if (!isValidPrepMinutes(input.prepMinutes)) throw new Error('TAYYORLASH_VAQTI_NOTOGRI');
  const actor = actorLabel(input);
  await staffOrder(input, input.orderId);
  const result = await db.$transaction(async (tx): Promise<ProposeResult> => {
    const now = new Date();
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: { items: { where: { supersededAt: null } },
        restaurant: { select: { id: true, staffTelegramUserId: true, isActive: true, isPaused: true } } },
    });
    if (!order || !order.createdViaBot || !isActorOf(order.restaurant, input)) throw new Error('RUXSAT_YOQ');
    if (order.status !== 'WAITING_RESTAURANT') return { result: 'STALE' };
    if (!order.restaurantDeadlineAt || order.restaurantDeadlineAt <= now) return { result: 'TIMED_OUT' };
    if (!order.restaurant.isActive || order.restaurant.isPaused) return { result: 'RESTAURANT_CLOSED' };
    const ids = order.items.map(i => i.productId).filter((id): id is string => id !== null);
    const menu = new Map((await tx.product.findMany({ where: { id: { in: ids } } })).map(p => [p.id, p]));
    const plan = buildRevision(order.items, menu, order.restaurantId);
    if (!plan.ok) return { result: 'NOT_REVISABLE', problems: plan.problems };
    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: 'WAITING_RESTAURANT', restaurantDeadlineAt: { gt: now } },
      data: { status: 'WAITING_CUSTOMER_CONSENT', customerLastNotifiedStatus: null },
    });
    if (claimed.count !== 1) return { result: 'STALE' };
    const previousLines = order.items.map(({ productId, name, unitSom, quantity, subtotalSom }) => ({ productId, name, unitSom, quantity, subtotalSom }));
    const rev = await tx.orderPriceRevision.create({ data: {
      orderId: order.id, proposedBy: actor, expiresAt: new Date(now.getTime() + consentTimeoutMs()),
      oldTotalSom: plan.oldTotal, newTotalSom: plan.newTotal, prepMinutes: input.prepMinutes,
      previousLines, lines: plan.lines.map(({ productId, name, unitSom, quantity, subtotalSom }) => ({ productId, name, unitSom, quantity, subtotalSom })),
    } });
    await tx.orderEvent.create({ data: {
      orderId: order.id, actorTelegramId: actor, actorType: 'RESTAURANT_STAFF', action: 'PRICE_PROPOSED',
      fromStatus: 'WAITING_RESTAURANT', toStatus: 'WAITING_CUSTOMER_CONSENT',
      details: { revisionId: rev.id, oldTotalSom: plan.oldTotal, newTotalSom: plan.newTotal, prepMinutes: input.prepMinutes, channel: actorChannel(input) },
    } });
    return { result: 'PROPOSED', revisionId: rev.id, oldTotal: plan.oldTotal, newTotal: plan.newTotal };
  });
  return result;
}

export type ConsentResult =
  | { result: 'ACCEPTED'; orderId: string; paymentId: string }
  | { result: 'DECLINED' }
  | { result: 'NOT_FOUND' } | { result: 'STALE' } | { result: 'EXPIRED' } | { result: 'MENU_CHANGED' };

class Outcome extends Error { constructor(readonly value: ConsentResult) { super(value.result); } }

/** The customer (identified by Telegram id in the same query that finds the revision) answers the proposal.
 *  Consent = ONE transaction under the payment lock: revision ACCEPTED, old lines superseded (kept), new lines
 *  inserted, total updated, order -> PAYMENT_PENDING, single payment created at exactly the consented amount. */
export async function respondToRevision(engine: PaymentEngineV3, input: {
  telegramUserId: string; revisionId: string; accept: boolean;
}): Promise<ConsentResult> {
  const rev = await db.orderPriceRevision.findFirst({
    where: { id: input.revisionId, order: { customer: { telegramUserId: input.telegramUserId } } },
    include: { order: { select: { paymentIsTest: true } } },
  });
  if (!rev) return { result: 'NOT_FOUND' }; // foreign and unknown ids look the same
  if (!input.accept) {
    return db.$transaction(async (tx): Promise<ConsentResult> => {
      const now = new Date();
      const claimed = await tx.orderPriceRevision.updateMany({
        where: { id: rev.id, status: 'PROPOSED' }, data: { status: 'DECLINED', respondedAt: now },
      });
      if (claimed.count !== 1) return { result: 'STALE' };
      await cancelOrder(tx, rev.orderId, 'WAITING_CUSTOMER_CONSENT', input.telegramUserId, 'CUSTOMER', 'PRICE_DECLINED', now);
      return { result: 'DECLINED' };
    });
  }
  try {
    const { order, payment } = await engine.createCheckout(async tx => {
      const now = new Date();
      const claimed = await tx.orderPriceRevision.updateMany({
        where: { id: rev.id, status: 'PROPOSED', expiresAt: { gt: now } }, data: { status: 'ACCEPTED', respondedAt: now },
      });
      if (claimed.count !== 1) {
        const cur = await tx.orderPriceRevision.findUnique({ where: { id: rev.id } });
        throw new Outcome({ result: cur?.status === 'PROPOSED' ? 'EXPIRED' : 'STALE' });
      }
      const order = await tx.order.findUniqueOrThrow({
        where: { id: rev.orderId }, include: { restaurant: { select: { isActive: true, isPaused: true } } },
      });
      const lines = rev.lines as unknown as Line[];
      // The menu must still match what the customer consented to.
      const menu = new Map((await tx.product.findMany({ where: { id: { in: lines.map(l => l.productId!) } } })).map(p => [p.id, p]));
      const drift = validateSnapshot(lines, menu, order.restaurantId);
      if (drift.length || !order.restaurant.isActive || order.restaurant.isPaused) throw new Outcome({ result: 'MENU_CHANGED' });
      const moved = await tx.order.updateMany({
        where: { id: order.id, status: 'WAITING_CUSTOMER_CONSENT' },
        data: { status: 'PAYMENT_PENDING', totalSom: rev.newTotalSom, acceptedAt: now, acceptedBy: rev.proposedBy,
          estimatedPrepMinutes: rev.prepMinutes },
      });
      if (moved.count !== 1) throw new Outcome({ result: 'STALE' }); // e.g. cancelled meanwhile
      await tx.orderItem.updateMany({ where: { orderId: order.id, supersededAt: null }, data: { supersededAt: now } });
      await tx.orderItem.createMany({ data: lines.map(l => ({ orderId: order.id, productId: l.productId, name: l.name,
        unitSom: l.unitSom, quantity: l.quantity, subtotalSom: l.subtotalSom })) });
      await tx.orderEvent.create({ data: {
        orderId: order.id, actorTelegramId: input.telegramUserId, actorType: 'CUSTOMER', action: 'PRICE_CONSENT',
        fromStatus: 'WAITING_CUSTOMER_CONSENT', toStatus: 'PAYMENT_PENDING',
        details: { revisionId: rev.id, oldTotalSom: rev.oldTotalSom, newTotalSom: rev.newTotalSom, prepMinutes: rev.prepMinutes },
      } });
      return { id: order.id, restaurantId: order.restaurantId, totalSom: rev.newTotalSom };
    }, rev.order.paymentIsTest);
    return { result: 'ACCEPTED', orderId: order.id, paymentId: payment.id };
  } catch (err) {
    if (!(err instanceof Outcome)) throw err;
    if (err.value.result === 'MENU_CHANGED') { // consent could not be honoured: close it, charge nothing
      await db.$transaction(async tx => {
        const now = new Date();
        const v = await tx.orderPriceRevision.updateMany({ where: { id: rev.id, status: 'PROPOSED' }, data: { status: 'VOID', respondedAt: now } });
        if (v.count === 1) await cancelOrder(tx, rev.orderId, 'WAITING_CUSTOMER_CONSENT', 'system', 'SYSTEM', 'MENU_CHANGED', now);
      });
    }
    if (err.value.result === 'EXPIRED') await expireConsents();
    return err.value;
  }
}

async function cancelOrder(
  tx: Prisma.TransactionClient, orderId: string, from: 'WAITING_RESTAURANT' | 'WAITING_CUSTOMER_CONSENT',
  actor: string, actorType: 'CUSTOMER' | 'SYSTEM', reason: string, now: Date,
): Promise<boolean> {
  const { count } = await tx.order.updateMany({
    where: { id: orderId, status: from },
    data: { status: 'CUSTOMER_CANCELLED', cancelledAt: now, cancelledBy: actor, cancelReason: reason, customerLastNotifiedStatus: null },
  });
  if (count !== 1) return false;
  await tx.orderEvent.create({ data: {
    orderId, actorTelegramId: actor, actorType, action: 'CANCEL', fromStatus: from, toStatus: 'CUSTOMER_CANCELLED', details: { reason },
  } });
  return true;
}

export type CancelResult = { result: 'CANCELLED' } | { result: 'NOT_FOUND' } | { result: 'TOO_LATE' };

/** Customer cancels while the restaurant (or the customer's own consent) is still pending. Racing with an
 *  acceptance is safe: both are compare-and-set on the order status, so exactly one of them wins. */
export async function cancelWaitingOrder(input: { telegramUserId: string; orderId: string }): Promise<CancelResult> {
  const owned = await db.order.findFirst({
    where: { id: input.orderId, customer: { telegramUserId: input.telegramUserId } }, select: { id: true },
  });
  if (!owned) return { result: 'NOT_FOUND' };
  return db.$transaction(async (tx): Promise<CancelResult> => {
    const now = new Date();
    const a = await cancelOrder(tx, owned.id, 'WAITING_RESTAURANT', input.telegramUserId, 'CUSTOMER', 'CUSTOMER_REQUEST', now);
    if (a) return { result: 'CANCELLED' };
    const b = await cancelOrder(tx, owned.id, 'WAITING_CUSTOMER_CONSENT', input.telegramUserId, 'CUSTOMER', 'CUSTOMER_REQUEST', now);
    if (b) {
      await tx.orderPriceRevision.updateMany({ where: { orderId: owned.id, status: 'PROPOSED' }, data: { status: 'VOID', respondedAt: now } });
      return { result: 'CANCELLED' };
    }
    return { result: 'TOO_LATE' };
  });
}

/** Unanswered price proposals close the order; nothing was charged. Idempotent and multi-worker safe. */
export async function expireConsents(now = new Date()): Promise<string[]> {
  const due = await db.orderPriceRevision.findMany({
    where: { status: 'PROPOSED', expiresAt: { lte: now } }, select: { id: true, orderId: true }, take: 100,
  });
  const done: string[] = [];
  for (const r of due) {
    const ok = await db.$transaction(async tx => {
      const c = await tx.orderPriceRevision.updateMany({
        where: { id: r.id, status: 'PROPOSED', expiresAt: { lte: now } }, data: { status: 'EXPIRED', respondedAt: now },
      });
      if (c.count !== 1) return false;
      await cancelOrder(tx, r.orderId, 'WAITING_CUSTOMER_CONSENT', 'system', 'SYSTEM', 'CONSENT_TIMEOUT', now);
      return true;
    });
    if (ok) done.push(r.orderId);
  }
  return done;
}
