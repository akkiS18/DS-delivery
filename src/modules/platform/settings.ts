import type { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';
import { isSupportAdmin } from '../support/service.js';
import { gmailHealth } from '../payment/gmail-health.js';
import { paymentMode } from '../payment/requisites.js';

/**
 * Stage 9: the "real payments" door, opened and closed by a platform administrator from Telegram (/payments).
 *
 * Two independent layers, both must allow money:
 *  1. the process (config-check at start): BOT_PAYMENT_MODE=REAL, CONFIRM_REAL_PAYMENTS=yes, Gmail enabled, a non-test database, an administrator.
 *     Only the server owner can set these; they are the capability.
 *  2. this switch (a database row): even a REAL-capable production backend takes no REAL order until an administrator opens the door.
 * A missing row means CLOSED. Closing never touches payments already created: they keep matching, confirming and expiring as usual;
 * only NEW REAL checkouts are refused. Every change is written to the append-only AdminAuditEvent.
 */
export const REAL_PAYMENTS_KEY = 'real_payments_open';

type Tx = Prisma.TransactionClient | typeof db;

/** Enforced in production only: staging is MOCK and the test suites place REAL orders without a production door. */
export const realPaymentsGateActive = (env: NodeJS.ProcessEnv = process.env): boolean => env.NODE_ENV === 'production';

export async function realPaymentsOpen(tx: Tx = db): Promise<boolean> {
  const row = await tx.platformSetting.findUnique({ where: { key: REAL_PAYMENTS_KEY }, select: { value: true } });
  return row?.value === 'true';
}

/** Why the door cannot be opened right now (empty = ready). Plain Uzbek, one short line each, shown to the administrator. */
export async function realPaymentsBlockers(env: NodeJS.ProcessEnv = process.env, tx: Tx = db): Promise<string[]> {
  const issues: string[] = [];
  if (paymentMode(env) !== 'REAL') issues.push('Server REAL rejimida emas (BOT_PAYMENT_MODE).');
  const gmail = gmailHealth.status();
  if (gmail !== 'ok') issues.push(`Gmail ishlamayapti (holat: ${gmail}). Pul kelganini ko‘ra olmaymiz.`);
  const cards = await tx.card.count({
    where: { isTest: false, active: true, approvalStatus: 'APPROVED', restaurant: { is: { isActive: true } } },
  });
  if (cards === 0) issues.push('Faol, tasdiqlangan karta yo‘q (restoran kartasini tasdiqlang: /cards).');
  return issues;
}

export interface PaymentsPanel { open: boolean; gateActive: boolean; mode: 'MOCK' | 'REAL'; blockers: string[] }

export async function paymentsPanel(env: NodeJS.ProcessEnv = process.env): Promise<PaymentsPanel> {
  return { open: await realPaymentsOpen(), gateActive: realPaymentsGateActive(env), mode: paymentMode(env), blockers: await realPaymentsBlockers(env) };
}

export type SetPaymentsResult = { result: 'CHANGED' | 'UNCHANGED' } | { result: 'BLOCKED'; blockers: string[] };

export async function setRealPaymentsOpen(input: { adminId: string; open: boolean }, env: NodeJS.ProcessEnv = process.env): Promise<SetPaymentsResult> {
  if (!isSupportAdmin(input.adminId)) throw new Error('ADMIN_RUXSAT_YOQ');
  if (input.open) {
    const blockers = await realPaymentsBlockers(env);
    if (blockers.length) return { result: 'BLOCKED', blockers };
  }
  const value = input.open ? 'true' : 'false';
  return db.$transaction(async tx => {
    const before = await tx.platformSetting.findUnique({ where: { key: REAL_PAYMENTS_KEY }, select: { value: true } });
    if ((before?.value === 'true') === input.open && before !== null) return { result: 'UNCHANGED' } as const;
    await tx.platformSetting.upsert({
      where: { key: REAL_PAYMENTS_KEY }, create: { key: REAL_PAYMENTS_KEY, value, updatedBy: input.adminId }, update: { value, updatedBy: input.adminId },
    });
    await tx.adminAuditEvent.create({ data: {
      actorId: input.adminId, action: input.open ? 'REAL_PAYMENTS_OPENED' : 'REAL_PAYMENTS_CLOSED', targetType: 'PlatformSetting', targetId: REAL_PAYMENTS_KEY,
      details: { previous: before?.value ?? null },
    } });
    return { result: 'CHANGED' } as const;
  });
}
