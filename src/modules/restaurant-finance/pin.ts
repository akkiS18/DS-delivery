import { randomInt } from 'node:crypto';
import { db } from '../../lib/db.js';
import { hashPassword, verifyPassword } from '../restaurant-auth/password.js';
import { isSupportAdmin } from '../support/service.js';

/**
 * Finance PIN (owner decision 2026-11-05). The restaurant's money screens are behind a 4-digit code so cashiers who share the login cannot open them.
 * An administrator issues the code (shown once; only an Argon2id hash is stored); the restaurant owner will be able to change it later (not built yet).
 * Entering it opens the money screens on THAT device session for a short sliding window; leaving the screen (or the app) locks it again.
 * Wrong codes: 5 in a row lock the code for 15 minutes (10 000 possible codes must not be guessable by trying them all).
 */
export const PIN_LENGTH = 4;
export const UNLOCK_WINDOW_MS = 10 * 60_000;
export const MAX_FAILED = 5;
export const LOCK_MS = 15 * 60_000;

export class FinanceLockedError extends Error {
  readonly statusCode = 423;
  constructor(readonly code: 'FINANCE_LOCKED' | 'FINANCE_NO_PIN') { super(code); }
}

/** Random 4 digits that are not trivially guessable (0000, 1111, 1234, 4321 ...). */
export function generatePin(): string {
  for (;;) {
    const pin = String(randomInt(0, 10_000)).padStart(PIN_LENGTH, '0');
    if (/^(\d)\1{3}$/.test(pin)) continue;
    const d = [...pin].map(Number);
    const step = d[1]! - d[0]!;
    if ((step === 1 || step === -1) && d[2]! - d[1]! === step && d[3]! - d[2]! === step) continue;
    return pin;
  }
}

export type IssueResult = { result: 'ISSUED'; pin: string; restaurantName: string } | { result: 'NOT_FOUND' };

/** An administrator issues (or re-issues) the code. The plain code is returned ONCE; it is never stored. Every open unlock of the restaurant is closed. */
export async function issueFinancePin(input: { adminId: string; restaurantId: string }): Promise<IssueResult> {
  if (!isSupportAdmin(input.adminId)) throw new Error('ADMIN_RUXSAT_YOQ');
  const restaurant = await db.restaurant.findUnique({ where: { id: input.restaurantId }, select: { id: true, name: true } });
  if (!restaurant) return { result: 'NOT_FOUND' };
  const pin = generatePin();
  const pinHash = await hashPassword(pin);
  await db.$transaction(async tx => {
    await tx.restaurantFinancePin.upsert({
      where: { restaurantId: restaurant.id },
      create: { restaurantId: restaurant.id, pinHash, setBy: input.adminId },
      update: { pinHash, setBy: input.adminId, failedAttempts: 0, lockedUntil: null },
    });
    await tx.restaurantSession.updateMany({ where: { restaurantId: restaurant.id, financeUnlockedUntil: { not: null } }, data: { financeUnlockedUntil: null } });
    await tx.adminAuditEvent.create({ data: { actorId: input.adminId, action: 'FINANCE_PIN_ISSUED', targetType: 'Restaurant', targetId: restaurant.id, details: {} } });
  });
  return { result: 'ISSUED', pin, restaurantName: restaurant.name };
}

export type UnlockResult =
  | { result: 'UNLOCKED'; until: Date }
  | { result: 'WRONG'; attemptsLeft: number }
  | { result: 'LOCKED'; retryAfterSeconds: number }
  | { result: 'NO_PIN' };

/** Checks the code for the restaurant of this session and opens the money screens on that session. Attempts are counted under a row lock (parallel guesses cannot skip the limit). */
export async function unlockFinance(input: { sessionId: string; restaurantId: string; pin: string }, now = new Date()): Promise<UnlockResult> {
  if (!/^\d{4}$/.test(input.pin)) return { result: 'WRONG', attemptsLeft: MAX_FAILED };
  return db.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ id: string; pinHash: string; failedAttempts: number; lockedUntil: Date | null }>>`
      SELECT "id", "pinHash", "failedAttempts", "lockedUntil" FROM "RestaurantFinancePin" WHERE "restaurantId" = ${input.restaurantId} FOR UPDATE`;
    const row = rows[0];
    if (!row) return { result: 'NO_PIN' } as const;
    if (row.lockedUntil && row.lockedUntil > now) return { result: 'LOCKED', retryAfterSeconds: Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 1000) } as const;
    if (!(await verifyPassword(input.pin, row.pinHash))) {
      const failed = row.failedAttempts + 1;
      const lock = failed >= MAX_FAILED;
      await tx.restaurantFinancePin.update({ where: { id: row.id }, data: { failedAttempts: lock ? 0 : failed, lockedUntil: lock ? new Date(now.getTime() + LOCK_MS) : null } });
      return lock ? { result: 'LOCKED', retryAfterSeconds: LOCK_MS / 1000 } as const : { result: 'WRONG', attemptsLeft: MAX_FAILED - failed } as const;
    }
    await tx.restaurantFinancePin.update({ where: { id: row.id }, data: { failedAttempts: 0, lockedUntil: null } });
    const until = new Date(now.getTime() + UNLOCK_WINDOW_MS);
    await tx.restaurantSession.updateMany({ where: { id: input.sessionId, restaurantId: input.restaurantId, revokedAt: null }, data: { financeUnlockedUntil: until } });
    return { result: 'UNLOCKED', until } as const;
  });
}

export async function lockFinance(sessionId: string, restaurantId: string): Promise<void> {
  await db.restaurantSession.updateMany({ where: { id: sessionId, restaurantId }, data: { financeUnlockedUntil: null } });
}

export interface FinanceState { hasPin: boolean; unlocked: boolean; unlockedUntil: string | null }

export async function financeState(sessionId: string, restaurantId: string, now = new Date()): Promise<FinanceState> {
  const [pin, session] = await Promise.all([
    db.restaurantFinancePin.findUnique({ where: { restaurantId }, select: { id: true } }),
    db.restaurantSession.findFirst({ where: { id: sessionId, restaurantId, revokedAt: null }, select: { financeUnlockedUntil: true } }),
  ]);
  const until = session?.financeUnlockedUntil ?? null;
  const open = !!pin && !!until && until > now;
  return { hasPin: !!pin, unlocked: open, unlockedUntil: open ? until!.toISOString() : null };
}

/**
 * Guard for the money endpoints. `strict` (the new overview/history): a code must exist AND be entered. Not strict (the older summary endpoints the
 * installed apps still call): locked only once a code exists, so a restaurant without a code keeps working until an administrator issues one.
 * A successful check slides the window forward.
 */
export async function requireFinanceUnlocked(sessionId: string, restaurantId: string, opts: { strict: boolean }, now = new Date()): Promise<void> {
  const state = await financeState(sessionId, restaurantId, now);
  if (!state.hasPin) { if (opts.strict) throw new FinanceLockedError('FINANCE_NO_PIN'); return; }
  if (!state.unlocked) throw new FinanceLockedError('FINANCE_LOCKED');
  await db.restaurantSession.updateMany({ where: { id: sessionId, restaurantId, revokedAt: null }, data: { financeUnlockedUntil: new Date(now.getTime() + UNLOCK_WINDOW_MS) } });
}
