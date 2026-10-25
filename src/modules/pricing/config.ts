import type { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';
import { isSupportAdmin } from '../support/service.js';
import { DEFAULT_FEE_CONFIG, FEE_MODES, type FeeConfig, type FeeMode } from './fee.js';

/**
 * The platform fee mode, flipped by an administrator from Telegram (/fee) and audited in AdminAuditEvent, like the payments door.
 * A missing or unreadable row means FLAT (the legacy behaviour: nothing added to the customer's price). The mode is read when a quote
 * or an order is made and then frozen on the order, so changing it never touches an order that already exists.
 */
export const FEE_MODE_KEY = 'service_fee_mode';
export const FEE_PERCENT_KEY = 'service_fee_percent_bp';
export const MIN_PERCENT_BP = 100;
export const MAX_PERCENT_BP = 2500;

type Tx = Prisma.TransactionClient | typeof db;

export function parseFeeConfig(mode: string | undefined, percentBp: string | undefined): FeeConfig {
  const m = FEE_MODES.find(x => x === mode) ?? DEFAULT_FEE_CONFIG.mode;
  const bp = Number(percentBp);
  const ok = percentBp !== undefined && /^\d{1,4}$/.test(percentBp) && bp >= MIN_PERCENT_BP && bp <= MAX_PERCENT_BP;
  return { ...DEFAULT_FEE_CONFIG, mode: m, percentBp: ok ? bp : DEFAULT_FEE_CONFIG.percentBp };
}

export async function loadFeeConfig(tx: Tx = db): Promise<FeeConfig> {
  const rows = await tx.platformSetting.findMany({ where: { key: { in: [FEE_MODE_KEY, FEE_PERCENT_KEY] } }, select: { key: true, value: true } });
  const v = new Map(rows.map(r => [r.key, r.value]));
  return parseFeeConfig(v.get(FEE_MODE_KEY), v.get(FEE_PERCENT_KEY));
}

export async function setFeeMode(input: { adminId: string; mode: FeeMode; percentBp?: number }): Promise<{ result: 'CHANGED' | 'UNCHANGED'; config: FeeConfig }> {
  if (!isSupportAdmin(input.adminId)) throw new Error('ADMIN_RUXSAT_YOQ');
  if (!FEE_MODES.includes(input.mode)) throw new Error('XIZMAT_HAQI_REJIMI_NOTOGRI');
  if (input.percentBp !== undefined && (!Number.isInteger(input.percentBp) || input.percentBp < MIN_PERCENT_BP || input.percentBp > MAX_PERCENT_BP)) {
    throw new Error('XIZMAT_HAQI_FOIZI_NOTOGRI');
  }
  return db.$transaction(async tx => {
    const before = await loadFeeConfig(tx);
    const next: FeeConfig = { ...before, mode: input.mode, percentBp: input.percentBp ?? before.percentBp };
    if (next.mode === before.mode && next.percentBp === before.percentBp) return { result: 'UNCHANGED' as const, config: before };
    for (const [key, value] of [[FEE_MODE_KEY, next.mode], [FEE_PERCENT_KEY, String(next.percentBp)]] as const) {
      await tx.platformSetting.upsert({ where: { key }, create: { key, value, updatedBy: input.adminId }, update: { value, updatedBy: input.adminId } });
    }
    await tx.adminAuditEvent.create({ data: {
      actorId: input.adminId, action: 'SERVICE_FEE_MODE_CHANGED', targetType: 'PlatformSetting', targetId: FEE_MODE_KEY,
      details: { previous: { mode: before.mode, percentBp: before.percentBp }, next: { mode: next.mode, percentBp: next.percentBp } },
    } });
    return { result: 'CHANGED' as const, config: next };
  });
}
