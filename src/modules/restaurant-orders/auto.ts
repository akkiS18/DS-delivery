import { db } from '../../lib/db.js';
import type { StaffActor } from '../restaurant/actor.js';
import { takeStaffAction } from '../restaurant/service.js';
import { GMAIL_AUTO_ACTOR, gmailAutoConfirmEnabled } from '../restaurant/auto-policy.js';

/**
 * Stage 6E automatic progression, built only from the existing transition service (takeStaffAction):
 *  - cooking starts with ONE preparation time: the one chosen at acceptance, else Restaurant.defaultPrepMinutes;
 *  - MOCK/test payments are confirmed and cooked by a restart-safe sweep (system actor, restricted to test payments);
 *  - REAL payments: since Stage 8D a trusted Gmail match is confirmed by the 'gmail-auto' system actor (advanceGmailMatchedOrder; kill switch
 *    GMAIL_AUTO_CONFIRM=false returns to "restaurant staff verify the bank credit", after which cooking starts by itself);
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

const GMAIL_AUTO = { actorSystemId: GMAIL_AUTO_ACTOR } as const;

/**
 * Stage 8D: one REAL order whose payment the bank e-mail matched. Confirm it (the same checks as the restaurant's own VERIFY_PAYMENT plus
 * "no open refund, trusted GMAIL transaction"), then start cooking. Every step is a compare-and-swap, so a concurrent restaurant tap or a second
 * sweep changes nothing twice. A refusal leaves the order exactly as it was (still MATCHED_UNVERIFIED: the restaurant's button and /money remain).
 */
export async function advanceGmailMatchedOrder(orderId: string): Promise<boolean> {
  const row = await db.order.findFirst({
    where: {
      id: orderId, createdViaBot: true, paymentIsTest: false, payment: { is: { isTest: false, status: { in: ['MATCHED_UNVERIFIED', 'CONFIRMED_MANUAL'] } } },
      OR: [{ status: 'PAYMENT_MATCHED_UNVERIFIED' }, { status: 'PAYMENT_CONFIRMED', paymentVerifiedBy: `system:${GMAIL_AUTO_ACTOR}` }],
    },
    select: { id: true, status: true },
  });
  if (!row) return false;
  if (row.status === 'PAYMENT_MATCHED_UNVERIFIED') await takeStaffAction({ ...GMAIL_AUTO, orderId: row.id, action: 'VERIFY_PAYMENT' });
  return (await autoStartPreparing(GMAIL_AUTO, row.id)).started;
}

export interface AutoConfirmRefusal { orderId: string; code: string; reason: string }
const refusedAt = new Map<string, number>();
const RETRY_AFTER_REFUSAL_MS = 5 * 60_000;

/** Sweep for REAL matched payments (restart-safe: runs from the notifier loop and right after a Gmail match). Never throws. */
export async function autoConfirmRealOrders(limit = 25, now = Date.now()): Promise<{ confirmed: string[]; refused: AutoConfirmRefusal[] }> {
  const out = { confirmed: [] as string[], refused: [] as AutoConfirmRefusal[] };
  if (!gmailAutoConfirmEnabled()) return out;
  const rows = await db.order.findMany({
    where: {
      createdViaBot: true, paymentIsTest: false, payment: { is: { isTest: false, status: { in: ['MATCHED_UNVERIFIED', 'CONFIRMED_MANUAL'] } } },
      OR: [{ status: 'PAYMENT_MATCHED_UNVERIFIED' }, { status: 'PAYMENT_CONFIRMED', paymentVerifiedBy: `system:${GMAIL_AUTO_ACTOR}` }],
    },
    orderBy: { updatedAt: 'asc' }, take: limit, select: { id: true, code: true },
  });
  for (const row of rows) {
    if ((refusedAt.get(row.id) ?? 0) > now) continue;
    try {
      if (await advanceGmailMatchedOrder(row.id)) out.confirmed.push(row.id);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'UNKNOWN';
      refusedAt.set(row.id, now + RETRY_AFTER_REFUSAL_MS);
      out.refused.push({ orderId: row.id, code: row.code, reason });
      console.error(`[GMAIL AUTO-CONFIRM] #${row.code} refused: ${reason}`);
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
