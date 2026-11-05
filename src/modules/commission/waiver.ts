import { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';
import { isSupportAdmin } from '../support/service.js';

/**
 * Owner decision 2026-11-05: the administrator can excuse the platform fee of ONE delivered order (the owner's own order from a pilot restaurant must
 * not show up as that restaurant's debt). The ledger entry is append-only and is NOT changed; the waiver is its own append-only record, and every
 * balance, payout and weekly statement ignores an entry that has one (`waiver: null` in those queries, `effectiveCommissionSom` for loaded rows).
 */
export const WAIVE_REASON_MIN = 10;
export const WAIVE_REASON_MAX = 300;

/** What a ledger entry counts for after a possible waiver (a loaded row with its waiver relation). */
export const effectiveCommissionSom = (c: { amountSom: number; waiver?: { id: string } | null } | null | undefined): number => (!c || c.waiver ? 0 : c.amountSom);

export type WaiveResult =
  | { result: 'WAIVED'; orderCode: string; restaurantName: string; amountSom: number }
  | { result: 'ALREADY_WAIVED'; orderCode: string }
  | { result: 'NOT_FOUND' }
  | { result: 'NO_COMMISSION'; orderCode: string }
  | { result: 'SETTLED'; orderCode: string };

/**
 * `orderCode` is the public order code (e.g. D56WB). Idempotent: a second call changes nothing. Refused when the entry is already covered by a weekly
 * settlement (the restaurant paid it; that is a refund question, not a waiver). Serialised with the weekly settlement by the same advisory lock.
 */
export async function waiveCommission(input: { adminId: string; orderCode: string; reason: string }): Promise<WaiveResult> {
  if (!isSupportAdmin(input.adminId)) throw new Error('ADMIN_RUXSAT_YOQ');
  const reason = input.reason.trim();
  if (reason.length < WAIVE_REASON_MIN || reason.length > WAIVE_REASON_MAX) throw new Error('ADMIN_IZOH_NOTOGRI');
  const code = input.orderCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,12}$/.test(code)) return { result: 'NOT_FOUND' };
  try {
    return await db.$transaction(async tx => {
      const order = await tx.order.findFirst({
        where: { code }, select: { id: true, code: true, restaurantId: true, restaurant: { select: { name: true } } },
      });
      if (!order) return { result: 'NOT_FOUND' } as const;
      await tx.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(7017, hashtext(${order.restaurantId}))`;
      const entry = await tx.commissionEntry.findUnique({
        where: { orderId: order.id }, select: { id: true, amountSom: true, settlement: { select: { entryId: true } }, waiver: { select: { id: true } } },
      });
      if (!entry) return { result: 'NO_COMMISSION', orderCode: order.code } as const;
      if (entry.waiver) return { result: 'ALREADY_WAIVED', orderCode: order.code } as const;
      if (entry.settlement) return { result: 'SETTLED', orderCode: order.code } as const;
      await tx.commissionWaiver.create({ data: { entryId: entry.id, restaurantId: order.restaurantId, amountSom: entry.amountSom, reason, waivedBy: input.adminId } });
      await tx.commissionEvent.create({ data: { entryId: entry.id, actorId: input.adminId, actorType: 'ADMIN', action: 'WAIVED', details: { amountSom: entry.amountSom, reason } } });
      await tx.adminAuditEvent.create({
        data: { actorId: input.adminId, action: 'COMMISSION_WAIVED', targetType: 'Restaurant', targetId: order.restaurantId, details: { orderCode: order.code, amountSom: entry.amountSom, reason } },
      });
      return { result: 'WAIVED', orderCode: order.code, restaurantName: order.restaurant.name, amountSom: entry.amountSom } as const;
    });
  } catch (error) {
    // Two taps at once: the unique index on entryId let exactly one through.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { result: 'ALREADY_WAIVED', orderCode: code };
    throw error;
  }
}
