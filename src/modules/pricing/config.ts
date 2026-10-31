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
export const FEE_LINE_SOM_KEY = 'service_fee_line_som';
export const FEE_LINE_WAIVED_KEY = 'service_fee_line_waived';
export const MIN_LINE_SOM = 1000;
export const MAX_LINE_SOM = 50_000;
export const MIN_PERCENT_BP = 100;
export const MAX_PERCENT_BP = 2500;

type Tx = Prisma.TransactionClient | typeof db;

export function parseFeeConfig(mode: string | undefined, percentBp: string | undefined, lineSom?: string, lineWaived?: string): FeeConfig {
  const m = FEE_MODES.find(x => x === mode) ?? DEFAULT_FEE_CONFIG.mode;
  const bp = Number(percentBp);
  const ok = percentBp !== undefined && /^\d{1,4}$/.test(percentBp) && bp >= MIN_PERCENT_BP && bp <= MAX_PERCENT_BP;
  const ls = Number(lineSom);
  const lineOk = lineSom !== undefined && /^\d{4,5}$/.test(lineSom) && ls >= MIN_LINE_SOM && ls <= MAX_LINE_SOM;
  return { ...DEFAULT_FEE_CONFIG, mode: m, percentBp: ok ? bp : DEFAULT_FEE_CONFIG.percentBp,
    lineSom: lineOk ? ls : DEFAULT_FEE_CONFIG.lineSom, lineWaived: lineWaived === 'true' };
}

export async function loadFeeConfig(tx: Tx = db): Promise<FeeConfig> {
  const rows = await tx.platformSetting.findMany({ where: { key: { in: [FEE_MODE_KEY, FEE_PERCENT_KEY, FEE_LINE_SOM_KEY, FEE_LINE_WAIVED_KEY] } }, select: { key: true, value: true } });
  const v = new Map(rows.map(r => [r.key, r.value]));
  return parseFeeConfig(v.get(FEE_MODE_KEY), v.get(FEE_PERCENT_KEY), v.get(FEE_LINE_SOM_KEY), v.get(FEE_LINE_WAIVED_KEY));
}

export async function setFeeMode(input: { adminId: string; mode: FeeMode; percentBp?: number; lineSom?: number; lineWaived?: boolean }): Promise<{ result: 'CHANGED' | 'UNCHANGED'; config: FeeConfig }> {
  if (!isSupportAdmin(input.adminId)) throw new Error('ADMIN_RUXSAT_YOQ');
  if (!FEE_MODES.includes(input.mode)) throw new Error('XIZMAT_HAQI_REJIMI_NOTOGRI');
  if (input.percentBp !== undefined && (!Number.isInteger(input.percentBp) || input.percentBp < MIN_PERCENT_BP || input.percentBp > MAX_PERCENT_BP)) {
    throw new Error('XIZMAT_HAQI_FOIZI_NOTOGRI');
  }
  if (input.lineSom !== undefined && (!Number.isInteger(input.lineSom) || input.lineSom < MIN_LINE_SOM || input.lineSom > MAX_LINE_SOM)) throw new Error('XIZMAT_HAQI_SUMMASI_NOTOGRI');
  return db.$transaction(async tx => {
    const before = await loadFeeConfig(tx);
    const next: FeeConfig = { ...before, mode: input.mode, percentBp: input.percentBp ?? before.percentBp,
      lineSom: input.lineSom ?? before.lineSom, lineWaived: input.lineWaived ?? before.lineWaived };
    if (next.mode === before.mode && next.percentBp === before.percentBp && next.lineSom === before.lineSom && next.lineWaived === before.lineWaived) return { result: 'UNCHANGED' as const, config: before };
    for (const [key, value] of [[FEE_MODE_KEY, next.mode], [FEE_PERCENT_KEY, String(next.percentBp)], [FEE_LINE_SOM_KEY, String(next.lineSom)], [FEE_LINE_WAIVED_KEY, String(next.lineWaived)]] as const) {
      await tx.platformSetting.upsert({ where: { key }, create: { key, value, updatedBy: input.adminId }, update: { value, updatedBy: input.adminId } });
    }
    await tx.adminAuditEvent.create({ data: {
      actorId: input.adminId, action: 'SERVICE_FEE_MODE_CHANGED', targetType: 'PlatformSetting', targetId: FEE_MODE_KEY,
      details: { previous: { mode: before.mode, percentBp: before.percentBp, lineSom: before.lineSom, lineWaived: before.lineWaived }, next: { mode: next.mode, percentBp: next.percentBp, lineSom: next.lineSom, lineWaived: next.lineWaived } },
    } });
    return { result: 'CHANGED' as const, config: next };
  });
}
