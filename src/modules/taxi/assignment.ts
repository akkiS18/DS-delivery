import type { Prisma } from '@prisma/client';
import { taxiTelegramEnabled } from '../../lib/features.js';

type Tx = Prisma.TransactionClient;

/**
 * A company that can receive a booking right now: active and reachable - it has an app login (DS Taxi app) or, while the Telegram taxi panel is on,
 * a linked operator. When TAXI_OPERATOR_ALLOWLIST is set (development safety) only Telegram operators on that list count, so automatic
 * assignment/fallback never picks an operator the sender would refuse to message anyway. An app login is not a Telegram id and is not filtered.
 */
export function eligibleCompanyWhere(env: NodeJS.ProcessEnv = process.env): Prisma.TaxiCompanyWhereInput {
  const allow = (env.TAXI_OPERATOR_ALLOWLIST ?? '').split(',').map(v => v.trim()).filter(Boolean);
  const viaApp: Prisma.TaxiCompanyWhereInput = { credential: { isNot: null } };
  if (!taxiTelegramEnabled(env)) return { isActive: true, ...viaApp };
  return { isActive: true, OR: [viaApp, { operatorTelegramUserId: allow.length ? { in: allow } : { not: null } }] };
}

/** Next company for an order that has not been tried yet (alphabetical, deterministic). Used by every automatic fallback. */
export async function nextEligibleCompany(tx: Tx, orderId: string) {
  const tried = await tx.taxiDispatch.findMany({ where: { orderId }, select: { taxiCompanyId: true } });
  return tx.taxiCompany.findFirst({
    where: { ...eligibleCompanyWhere(), id: { notIn: tried.map(r => r.taxiCompanyId) } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
}

/** Companies an administrator may reassign to (every eligible company; they decide, with an attestation). */
export async function reassignableCompanies(tx: Tx | Prisma.TransactionClient, excludeCompanyId?: string) {
  return tx.taxiCompany.findMany({
    where: { ...eligibleCompanyWhere(), ...(excludeCompanyId ? { id: { not: excludeCompanyId } } : {}) },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true },
  });
}

/**
 * Creates the next attempt for an order. The caller must already have made every earlier attempt terminal in the SAME transaction
 * (the partial unique index "one active dispatch per order" is the backstop: a second active attempt fails with P2002).
 */
export async function createNextAttempt(tx: Tx, orderId: string, companyId: string, dueAt = new Date()) {
  const last = await tx.taxiDispatch.findFirst({ where: { orderId }, orderBy: { attemptNo: 'desc' }, select: { attemptNo: true } });
  const created = await tx.taxiDispatch.create({
    data: { orderId, taxiCompanyId: companyId, attemptNo: (last?.attemptNo ?? 0) + 1, status: 'SCHEDULED', dueAt },
  });
  await tx.order.update({ where: { id: orderId }, data: { taxiCompanyId: companyId } });
  return created;
}
