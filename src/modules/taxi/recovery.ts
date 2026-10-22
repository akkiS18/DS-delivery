import { db } from '../../lib/db.js';
import { isSupportAdmin } from '../support/service.js';
import { createNextAttempt, nextEligibleCompany, reassignableCompanies } from './assignment.js';

/**
 * Taxi dispatch recovery. A dispatch that nobody answered, that the operator declined, or that needs help must never be re-sent
 * blindly, because a driver may already be on the way (that is how one order gets two cars). So:
 *  - automatic fallback happens only on an EXPLICIT "no driver" answer (respondToTaxi) or, if switched on, after prolonged silence;
 *  - otherwise a platform administrator (a support admin id) resolves it, attesting that no driver was dispatched, with a note;
 *  - every step makes the old attempt terminal (CANCELLED, history kept) before the next one exists, under the order row lock.
 * READY, payment and the order itself are never touched here.
 */
export type RecoveryAction = 'RETRY_SAME' | 'REASSIGN' | 'DRIVER_SENT';
export const RECOVERABLE = ['NEEDS_HELP', 'CANCELLATION_PENDING', 'DECLINED'] as const;

export type RecoveryResult =
  | { result: 'DONE'; action: RecoveryAction; nextDispatchId: string | null; companyName: string | null }
  | { result: 'STALE'; status: string }
  | { result: 'NOT_FOUND' };

export function validateRecoveryNote(raw: string): string {
  const note = raw.trim();
  if (note.length < 10 || note.length > 300) throw new Error('ADMIN_IZOH_NOTOGRI');
  return note;
}

export async function adminRecoverDispatch(input: {
  adminTelegramId: string; dispatchId: string; action: RecoveryAction; companyId?: string; note: string;
}): Promise<RecoveryResult> {
  if (!isSupportAdmin(input.adminTelegramId)) throw new Error('ADMIN_RUXSAT_YOQ');
  const note = validateRecoveryNote(input.note);
  return db.$transaction(async (tx): Promise<RecoveryResult> => {
    const candidate = await tx.taxiDispatch.findUnique({ where: { id: input.dispatchId }, select: { orderId: true } });
    if (!candidate) return { result: 'NOT_FOUND' };
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${candidate.orderId} FOR UPDATE`;
    const d = await tx.taxiDispatch.findUnique({
      where: { id: input.dispatchId },
      include: { taxiCompany: true, order: { include: { payment: { select: { status: true } } } } },
    });
    if (!d) return { result: 'NOT_FOUND' };
    const newer = await tx.taxiDispatch.count({ where: { orderId: d.orderId, attemptNo: { gt: d.attemptNo } } });
    if (!(RECOVERABLE as readonly string[]).includes(d.status) || newer > 0) return { result: 'STALE', status: d.status };
    if (!['PREPARING', 'READY'].includes(d.order.status) || d.order.payment?.status !== 'CONFIRMED_MANUAL') {
      return { result: 'STALE', status: d.order.status };
    }
    const now = new Date();
    const audit = (action: string, details: Record<string, unknown>) => tx.orderEvent.create({ data: {
      orderId: d.orderId, actorTelegramId: input.adminTelegramId, actorType: 'ADMIN', action,
      fromStatus: d.order.status, toStatus: d.order.status,
      details: { dispatchId: d.id, attemptNo: d.attemptNo, fromStatusDispatch: d.status, fromCompany: d.taxiCompany.name, note, ...details } as never,
    } });

    if (input.action === 'DRIVER_SENT') {
      // The admin established that a driver really is on the way: record it, create nothing new.
      const moved = await tx.taxiDispatch.updateMany({
        where: { id: d.id, status: d.status },
        data: { status: 'ASSIGNED', dispatchedAt: now, dispatchedBy: `admin:${input.adminTelegramId}`, respondedAt: now, expiresAt: null,
          customerNotifiedAt: null, staffNotifiedAt: null, adminNotifiedAt: null },
      });
      if (moved.count !== 1) return { result: 'STALE', status: 'CHANGED' };
      await audit('TAXI_ADMIN_DRIVER_SENT', {});
      return { result: 'DONE', action: input.action, nextDispatchId: null, companyName: d.taxiCompany.name };
    }

    // RETRY_SAME / REASSIGN: the administrator attests that NO driver was dispatched for this attempt.
    let company: { id: string; name: string } | null;
    if (input.action === 'RETRY_SAME') {
      company = (await reassignableCompanies(tx)).find(c => c.id === d.taxiCompanyId) ?? null;
    } else if (input.companyId) {
      company = (await reassignableCompanies(tx)).find(c => c.id === input.companyId) ?? null;
    } else {
      company = await nextEligibleCompany(tx, d.orderId);
    }
    if (!company) throw new Error('TAKSI_KOMPANIYASI_YOQ');
    const cancelled = await tx.taxiDispatch.updateMany({
      where: { id: d.id, status: d.status },
      data: { status: 'CANCELLED', respondedAt: now, expiresAt: null, leaseAt: null },
    });
    if (cancelled.count !== 1) return { result: 'STALE', status: 'CHANGED' };
    const next = await createNextAttempt(tx, d.orderId, company.id, now);
    await audit(input.action === 'RETRY_SAME' ? 'TAXI_ADMIN_RETRY' : 'TAXI_ADMIN_REASSIGN',
      { toCompany: company.name, nextAttemptNo: next.attemptNo, attestation: 'NO_DRIVER_SENT' });
    return { result: 'DONE', action: input.action, nextDispatchId: next.id, companyName: company.name };
  });
}

/** Dispatches an administrator can act on, newest first. A DECLINED attempt only counts while it is the latest one. */
export async function recoverableDispatches(limit = 12) {
  const rows = await db.taxiDispatch.findMany({
    where: { status: { in: [...RECOVERABLE] }, order: { status: { in: ['PREPARING', 'READY'] } } },
    orderBy: { updatedAt: 'desc' }, take: limit * 3,
    include: { taxiCompany: { select: { name: true } }, order: { select: { number: true, status: true, taxiDispatches: { select: { attemptNo: true } } } } },
  });
  return rows.filter(r => !r.order.taxiDispatches.some(x => x.attemptNo > r.attemptNo)).slice(0, limit);
}

export async function dispatchHistory(orderId: string) {
  return db.taxiDispatch.findMany({
    where: { orderId }, orderBy: { attemptNo: 'asc' },
    select: { id: true, attemptNo: true, status: true, acceptedAt: true, dispatchedAt: true, respondedAt: true, taxiCompany: { select: { name: true } } },
  });
}

/**
 * Prolonged silence from the operator (reminders used up). Never silently re-sends: either the opt-in automatic fallback
 * (TAXI_AUTO_FALLBACK_ON_SILENCE=true, only when the customer/channel allowed fallback and another company exists - accepting the
 * small risk of a double booking, which is audited) or an escalation to the administrators (NEEDS_HELP).
 */
export async function escalateSilentDispatch(dispatchId: string, autoFallback: boolean): Promise<'ESCALATED' | 'REASSIGNED' | 'STALE'> {
  return db.$transaction(async (tx) => {
    const candidate = await tx.taxiDispatch.findUnique({ where: { id: dispatchId }, select: { orderId: true } });
    if (!candidate) return 'STALE';
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${candidate.orderId} FOR UPDATE`;
    const d = await tx.taxiDispatch.findUnique({ where: { id: dispatchId }, include: { order: true, taxiCompany: true } });
    if (!d || d.status !== 'CANCELLATION_PENDING') return 'STALE';
    const next = autoFallback && d.order.allowTaxiFallback && ['PREPARING', 'READY'].includes(d.order.status)
      ? await nextEligibleCompany(tx, d.orderId) : null;
    const now = new Date();
    if (!next) {
      const moved = await tx.taxiDispatch.updateMany({
        where: { id: d.id, status: 'CANCELLATION_PENDING' },
        data: { status: 'NEEDS_HELP', customerNotifiedAt: null, staffNotifiedAt: null, adminNotifiedAt: null },
      });
      return moved.count === 1 ? 'ESCALATED' : 'STALE';
    }
    const cancelled = await tx.taxiDispatch.updateMany({ where: { id: d.id, status: 'CANCELLATION_PENDING' }, data: { status: 'CANCELLED', respondedAt: now, expiresAt: null } });
    if (cancelled.count !== 1) return 'STALE';
    const created = await createNextAttempt(tx, d.orderId, next.id, now);
    await tx.orderEvent.create({ data: {
      orderId: d.orderId, actorTelegramId: 'SYSTEM', actorType: 'SYSTEM', action: 'TAXI_AUTO_REASSIGNED_ON_SILENCE',
      fromStatus: d.order.status, toStatus: d.order.status,
      details: { dispatchId: d.id, fromCompany: d.taxiCompany.name, toCompany: next.name, nextAttemptNo: created.attemptNo, risk: 'OPERATOR_SILENT_DRIVER_MAY_EXIST' },
    } });
    return 'REASSIGNED';
  });
}
