import type { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';
import { isSupportAdmin } from '../support/service.js';

/**
 * When the taxi service is asked to send a driver (owner decision 2026-10-25: a driver who arrives before the food is ready wastes time):
 *   READY  only when the restaurant presses "Tayyor" (default; the driver may arrive a little late, never early);
 *   LEAD   a few minutes before the food is expected to be ready (preparing start + chosen time - lead), or at "Tayyor" if that comes first.
 * A missing or unreadable setting means READY. It is read when cooking starts and when the restaurant changes the preparation time.
 */
export type TaxiDispatchMode = 'READY' | 'LEAD';
export const TAXI_MODE_KEY = 'taxi_dispatch_mode';
type Tx = Prisma.TransactionClient | typeof db;

export async function loadTaxiMode(tx: Tx = db): Promise<TaxiDispatchMode> {
  const row = await tx.platformSetting.findUnique({ where: { key: TAXI_MODE_KEY }, select: { value: true } });
  return row?.value === 'LEAD' ? 'LEAD' : 'READY';
}

export async function setTaxiMode(input: { adminId: string; mode: TaxiDispatchMode }): Promise<'CHANGED' | 'UNCHANGED'> {
  if (!isSupportAdmin(input.adminId)) throw new Error('ADMIN_RUXSAT_YOQ');
  if (input.mode !== 'READY' && input.mode !== 'LEAD') throw new Error('TAKSI_REJIMI_NOTOGRI');
  return db.$transaction(async tx => {
    const before = await loadTaxiMode(tx);
    if (before === input.mode) return 'UNCHANGED' as const;
    await tx.platformSetting.upsert({ where: { key: TAXI_MODE_KEY }, create: { key: TAXI_MODE_KEY, value: input.mode, updatedBy: input.adminId }, update: { value: input.mode, updatedBy: input.adminId } });
    await tx.adminAuditEvent.create({ data: {
      actorId: input.adminId, action: 'TAXI_DISPATCH_MODE_CHANGED', targetType: 'PlatformSetting', targetId: TAXI_MODE_KEY, details: { previous: before, mode: input.mode },
    } });
    return 'CHANGED' as const;
  });
}

/** READY mode parks the request this long after cooking starts; "Tayyor" moves it to "now". Safety net only (a longer-forgotten order is stale anyway). */
export const TAXI_HOLD_MS = 6 * 60 * 60_000;
