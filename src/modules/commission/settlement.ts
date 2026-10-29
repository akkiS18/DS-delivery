import type { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';
import { isSupportAdmin } from '../support/service.js';

/**
 * An order paid on a PLATFORM card (Card.restaurantId null: the platform pool) was collected by the platform, which nets this commission in the
 * daily payout report (admin-payouts). Billing it again in the weekly statement would charge the restaurant twice. Cash and own-card orders
 * (the restaurant holds the money) stay in the weekly statement exactly as before.
 */
export const NOT_PLATFORM_COLLECTED: Prisma.CommissionEntryWhereInput = {
  NOT: { payment: { is: { method: 'CARD', card: { is: { restaurantId: null } } } } },
};

/**
 * Stage 8C: weekly commission settlement (docs/ROADMAP.html: week = Monday 00:00 to the next Monday 00:00, Asia/Tashkent; an open support
 * ticket on an order holds its commission). The platform earns a flat fee per delivered order; the restaurant pays the platform and an
 * administrator verifies that in the bank. This module only RECORDS that verification: ledger entries are immutable, so a settlement is a
 * separate append-only record that lists the entries it covers (each entry can be covered once).
 */
const TASHKENT_OFFSET_MS = 5 * 3600_000;

/** Monday 00:00 (Asia/Tashkent, no DST) of the week containing `now`, as a UTC instant. */
export function weekStartTashkent(now: Date): Date {
  const local = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  const dow = local.getUTCDay() === 0 ? 7 : local.getUTCDay(); // Monday = 1 ... Sunday = 7
  const mondayLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - (dow - 1));
  return new Date(mondayLocal - TASHKENT_OFFSET_MS);
}

export interface RestaurantStatement {
  restaurantId: string;
  name: string;
  /** Entries from closed weeks that nothing holds: what the restaurant owes now. */
  due: { count: number; amountSom: number };
  /** Closed-week entries held by an open support ticket (not collectable until it is resolved). */
  held: { count: number; amountSom: number };
  /** The running week (not collectable yet). */
  current: { count: number; amountSom: number };
}

type Entry = { id: string; restaurantId: string; amountSom: number; accruedAt: Date; orderId: string };
const add = (t: { count: number; amountSom: number }, e: Entry) => { t.count += 1; t.amountSom += e.amountSom; };

async function unsettledEntries(restaurantId?: string): Promise<Array<Entry & { held: boolean; name: string }>> {
  const rows = await db.commissionEntry.findMany({
    where: { settlement: null, ...NOT_PLATFORM_COLLECTED, ...(restaurantId ? { restaurantId } : {}) },
    select: { id: true, restaurantId: true, amountSom: true, accruedAt: true, orderId: true, restaurant: { select: { name: true } } },
    orderBy: [{ accruedAt: 'asc' }, { id: 'asc' }],
  });
  const tickets = rows.length
    ? await db.supportTicket.findMany({ where: { orderId: { in: rows.map(r => r.orderId) }, status: { in: ['OPEN', 'IN_PROGRESS'] } }, select: { orderId: true } })
    : [];
  const held = new Set(tickets.map(t => t.orderId));
  return rows.map(r => ({ id: r.id, restaurantId: r.restaurantId, amountSom: r.amountSom, accruedAt: r.accruedAt, orderId: r.orderId, name: r.restaurant.name, held: held.has(r.orderId) }));
}

export async function commissionStatements(now = new Date()): Promise<RestaurantStatement[]> {
  const cutoff = weekStartTashkent(now);
  const byRestaurant = new Map<string, RestaurantStatement>();
  for (const e of await unsettledEntries()) {
    const s = byRestaurant.get(e.restaurantId) ?? { restaurantId: e.restaurantId, name: e.name, due: { count: 0, amountSom: 0 }, held: { count: 0, amountSom: 0 }, current: { count: 0, amountSom: 0 } };
    add(e.accruedAt < cutoff ? (e.held ? s.held : s.due) : s.current, e);
    byRestaurant.set(e.restaurantId, s);
  }
  return [...byRestaurant.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type SettleResult =
  | { result: 'SETTLED'; settlementNumber: number; count: number; amountSom: number }
  | { result: 'CHANGED'; count: number; amountSom: number }
  | { result: 'NOTHING_DUE' };

export const NOTE_MIN = 10;
export const NOTE_MAX = 300;

/**
 * Records that the restaurant paid the commission now due. The administrator confirmed `expectedCount`/`expectedSom` on screen; if the set
 * changed since (a new ticket holds an order, a week rolled over) nothing is recorded and the new numbers are returned.
 */
export async function settleRestaurant(
  input: { restaurantId: string; adminId: string; expectedCount: number; expectedSom: number; note: string }, now = new Date(),
): Promise<SettleResult> {
  if (!isSupportAdmin(input.adminId)) throw new Error('ADMIN_RUXSAT_YOQ');
  const note = input.note.trim();
  if (note.length < NOTE_MIN || note.length > NOTE_MAX) throw new Error('ADMIN_IZOH_NOTOGRI');
  const cutoff = weekStartTashkent(now);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(7017, hashtext(${input.restaurantId}))`;
    const rows = await tx.commissionEntry.findMany({
      where: { restaurantId: input.restaurantId, settlement: null, accruedAt: { lt: cutoff }, ...NOT_PLATFORM_COLLECTED },
      select: { id: true, amountSom: true, orderId: true }, orderBy: [{ accruedAt: 'asc' }, { id: 'asc' }],
    });
    const tickets = rows.length
      ? await tx.supportTicket.findMany({ where: { orderId: { in: rows.map(r => r.orderId) }, status: { in: ['OPEN', 'IN_PROGRESS'] } }, select: { orderId: true } })
      : [];
    const held = new Set(tickets.map(t => t.orderId));
    const due = rows.filter(r => !held.has(r.orderId));
    const amountSom = due.reduce((s, r) => s + r.amountSom, 0);
    if (!due.length) return { result: 'NOTHING_DUE' } as const;
    if (due.length !== input.expectedCount || amountSom !== input.expectedSom) return { result: 'CHANGED', count: due.length, amountSom } as const;
    const settlement = await tx.commissionSettlement.create({
      data: { restaurantId: input.restaurantId, cutoffAt: cutoff, entryCount: due.length, amountSom, confirmedBy: input.adminId, note },
    });
    await tx.commissionSettlementEntry.createMany({ data: due.map(r => ({ settlementId: settlement.id, entryId: r.id })) });
    await tx.commissionEvent.createMany({
      data: due.map(r => ({ entryId: r.id, actorId: input.adminId, actorType: 'ADMIN', action: 'SETTLED', details: { settlementNumber: settlement.number } })),
    });
    return { result: 'SETTLED', settlementNumber: settlement.number, count: due.length, amountSom } as const;
  });
}
