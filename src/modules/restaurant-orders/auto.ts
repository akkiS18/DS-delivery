import type { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';
import type { StaffActor } from '../restaurant/actor.js';
import { takeStaffAction } from '../restaurant/service.js';
import {
  GMAIL_AUTO_ACTOR, HUMO_AUTO_ACTOR, autoActorOfSource, autoConfirmEnabledForSource, gmailAutoConfirmEnabled, humoAutoConfirmEnabled,
} from '../restaurant/auto-policy.js';

/**
 * Stage 6E automatic progression, built only from the existing transition service (takeStaffAction):
 *  - cooking starts with ONE preparation time: the one chosen at acceptance, else Restaurant.defaultPrepMinutes;
 *  - MOCK/test payments are confirmed and cooked by a restart-safe sweep (system actor, restricted to test payments);
 *  - REAL payments: since Stage 8D a trusted Gmail match is confirmed by the 'gmail-auto' system actor (advanceGmailMatchedOrder; kill switch
 *    GMAIL_AUTO_CONFIRM=false returns to "restaurant staff verify the bank credit", after which cooking starts by itself); since 2026-10-27 a
 *    Humocard Telegram match is confirmed the same way by 'humo-auto' (HUMO_AUTO_CONFIRM=false);
 *  - READY is never automatic.
 * A failed automatic start is not an error state of its own: the order stays PAYMENT_CONFIRMED and the app shows it as
 * "needs attention" with a manual start button.
 */
export type StartResult = { started: boolean; reason?: string };

export async function autoStartPreparing(actor: StaffActor, orderId: string): Promise<StartResult> {
  const order = await db.order.findUnique({
    where: { id: orderId }, select: { status: true, estimatedPrepMinutes: true, restaurant: { select: { defaultPrepMinutes: true } } },
  });
  if (!order || order.status !== 'PAYMENT_CONFIRMED') return { started: false, reason: 'NOT_CONFIRMED' };
  const prepMinutes = order.estimatedPrepMinutes ?? order.restaurant.defaultPrepMinutes;
  try {
    const r = await takeStaffAction({ ...actor, orderId, action: 'START_PREPARING', prepMinutes });
    return { started: r.changed, ...(r.changed ? {} : { reason: 'STALE' }) };
  } catch (err) {
    return { started: false, reason: err instanceof Error ? err.message : 'UNKNOWN' };
  }
}

const SYSTEM = { actorSystemId: 'mock-auto' } as const;

/** One MOCK order: confirm the test payment (system actor, refused for real money inside takeStaffAction), then start cooking. */
export async function advanceMockOrder(orderId: string): Promise<boolean> {
  const row = await db.order.findFirst({
    where: { id: orderId, createdViaBot: true, paymentIsTest: true, status: { in: ['PAYMENT_MATCHED_UNVERIFIED', 'PAYMENT_CONFIRMED'] }, payment: { isTest: true } },
    select: { id: true, status: true },
  });
  if (!row) return false;
  if (row.status === 'PAYMENT_MATCHED_UNVERIFIED') await takeStaffAction({ ...SYSTEM, orderId: row.id, action: 'VERIFY_PAYMENT' });
  return (await autoStartPreparing(SYSTEM, row.id)).started;
}

/** Order filter for a REAL payment matched by a bank signal and not yet cooking (the actor argument is the automatic actor that may finish it). */
const matchedRealWhere = (verifiedBy: string[]): Prisma.OrderWhereInput => ({
  createdViaBot: true, paymentIsTest: false, payment: { is: { isTest: false, status: { in: ['MATCHED_UNVERIFIED', 'CONFIRMED_MANUAL'] } } },
  OR: [{ status: 'PAYMENT_MATCHED_UNVERIFIED' }, { status: 'PAYMENT_CONFIRMED', paymentVerifiedBy: { in: verifiedBy } }],
});
const ALL_AUTO_ACTORS = [GMAIL_AUTO_ACTOR, HUMO_AUTO_ACTOR].map(a => `system:${a}`);

/**
 * Stage 8D: one REAL order whose payment a bank signal matched. Confirm it (the same checks as the restaurant's own VERIFY_PAYMENT plus
 * "no open refund, trusted transaction of the signal this actor is for"), then start cooking. Every step is a compare-and-swap, so a concurrent
 * restaurant tap or a second sweep changes nothing twice. A refusal leaves the order exactly as it was (still MATCHED_UNVERIFIED: the restaurant's
 * button and /money remain). `actorId` is the e-mail actor by default; the Humocard Telegram signal uses HUMO_AUTO_ACTOR.
 */
export async function advanceGmailMatchedOrder(orderId: string, actorId: string = GMAIL_AUTO_ACTOR): Promise<boolean> {
  const row = await db.order.findFirst({ where: { id: orderId, ...matchedRealWhere([`system:${actorId}`]) }, select: { id: true, status: true } });
  if (!row) return false;
  const actor = { actorSystemId: actorId };
  if (row.status === 'PAYMENT_MATCHED_UNVERIFIED') await takeStaffAction({ ...actor, orderId: row.id, action: 'VERIFY_PAYMENT' });
  return (await autoStartPreparing(actor, row.id)).started;
}

/** Source of each matched transaction (GMAIL / HUMO_TG ...), by transaction id. */
export async function matchedTransactionSources(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (!wanted.length) return new Map();
  const rows = await db.incomingTransaction.findMany({ where: { id: { in: wanted } }, select: { id: true, source: true } });
  return new Map(rows.map(r => [r.id, r.source]));
}

export interface AutoConfirmRefusal { orderId: string; code: string; reason: string }
const refusedAt = new Map<string, number>();
const RETRY_AFTER_REFUSAL_MS = 5 * 60_000;

/**
 * Sweep for REAL matched payments (restart-safe: runs from the notifier loop and right after a Humocard match). Never throws.
 * Each order is finished by the actor of the signal that matched it; that signal's own kill switch (GMAIL_AUTO_CONFIRM / HUMO_AUTO_CONFIRM) decides.
 */
export async function autoConfirmRealOrders(limit = 25, now = Date.now()): Promise<{ confirmed: string[]; refused: AutoConfirmRefusal[] }> {
  const out = { confirmed: [] as string[], refused: [] as AutoConfirmRefusal[] };
  if (!gmailAutoConfirmEnabled() && !humoAutoConfirmEnabled()) return out;
  const rows = await db.order.findMany({
    where: matchedRealWhere(ALL_AUTO_ACTORS),
    orderBy: { updatedAt: 'asc' }, take: limit, select: { id: true, code: true, payment: { select: { matchedTransactionId: true } } },
  });
  const sources = await matchedTransactionSources(rows.map(r => r.payment?.matchedTransactionId));
  for (const row of rows) {
    if ((refusedAt.get(row.id) ?? 0) > now) continue;
    const source = sources.get(row.payment?.matchedTransactionId ?? '');
    const actorId = source ? autoActorOfSource(source) : null;
    if (!actorId || !autoConfirmEnabledForSource(source)) continue; // not a bank signal we confirm automatically (or its switch is off): the restaurant confirms
    try {
      if (await advanceGmailMatchedOrder(row.id, actorId)) out.confirmed.push(row.id);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'UNKNOWN';
      refusedAt.set(row.id, now + RETRY_AFTER_REFUSAL_MS);
      out.refused.push({ orderId: row.id, code: row.code, reason });
      console.error(`[AUTO-CONFIRM ${actorId}] #${row.code} refused: ${reason}`);
    }
  }
  if (refusedAt.size > 500) for (const [id, t] of refusedAt) if (t <= now) refusedAt.delete(id);
  return out;
}

/** MOCK-only sweep. Idempotent and safe under concurrency (every step is a compare-and-swap in takeStaffAction). */
export async function autoAdvanceMockOrders(limit = 50): Promise<string[]> {
  const rows = await db.order.findMany({
    where: { createdViaBot: true, paymentIsTest: true, status: { in: ['PAYMENT_MATCHED_UNVERIFIED', 'PAYMENT_CONFIRMED'] }, payment: { isTest: true } },
    orderBy: { updatedAt: 'asc' }, take: limit, select: { id: true },
  });
  const advanced: string[] = [];
  for (const row of rows) {
    try { if (await advanceMockOrder(row.id)) advanced.push(row.id); }
    catch (err) { console.error(`[MOCK AUTO] ${row.id}:`, err instanceof Error ? err.message : err); }
  }
  return advanced;
}
