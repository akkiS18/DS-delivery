import { db } from '../../lib/db.js';
import type { StaffActor } from '../restaurant/actor.js';
import { takeStaffAction } from '../restaurant/service.js';

/**
 * Stage 6E automatic progression, built only from the existing transition service (takeStaffAction):
 *  - cooking starts with ONE preparation time: the one chosen at acceptance, else Restaurant.defaultPrepMinutes;
 *  - MOCK/test payments are confirmed and cooked by a restart-safe sweep (system actor, restricted to test payments);
 *  - REAL payments are never confirmed automatically - a Gmail match stays MATCHED_UNVERIFIED until restaurant staff verify
 *    the bank credit; only AFTER that explicit verification does cooking start by itself;
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
