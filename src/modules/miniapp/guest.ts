import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';

/**
 * Android guest identity. The app opens without registration: the server creates a Customer WITHOUT a Telegram id and a session whose
 * credential is 32 random bytes generated here. Only the SHA-256 of the credential is stored, so a database read cannot replay it.
 * The client-made installationId is a label for support/abuse analysis only; knowing it grants nothing.
 */
export const GUEST_TOKEN_PREFIX = 'dsg_';
const TOKEN_RE = /^dsg_[A-Za-z0-9_-]{43}$/;
export const installationIdSchemaRe = /^[A-Za-z0-9-]{16,64}$/;
const TOUCH_AFTER_MS = 60 * 60 * 1000;

export const guestAuthEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.ANDROID_GUEST_ENABLED?.trim().toLowerCase() === 'true';
export const guestSessionDays = (env: NodeJS.ProcessEnv = process.env): number => {
  const n = Number(env.GUEST_SESSION_DAYS ?? 180);
  return Number.isInteger(n) && n >= 1 && n <= 730 ? n : 180;
};

export const newGuestToken = (): string => GUEST_TOKEN_PREFIX + randomBytes(32).toString('base64url');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
export const guestTokenFromHeader = (header: string | undefined): string | null => {
  const m = header ? /^bearer\s+(\S+)$/i.exec(header.trim()) : null;
  return m && TOKEN_RE.test(m[1]!) ? m[1]! : null;
};

type Tx = Prisma.TransactionClient;
export interface IssuedSession { token: string; sessionId: string; customerId: string; expiresAt: Date }

/** Creates a session row for an existing customer and returns the one-time credential. */
export async function issueSession(tx: Tx, customerId: string, installationId: string | null, now = new Date()): Promise<IssuedSession> {
  const token = newGuestToken();
  const expiresAt = new Date(now.getTime() + guestSessionDays() * 86_400_000);
  const row = await tx.guestSession.create({ data: { customerId, tokenHash: hashToken(token), installationId, createdAt: now, lastSeenAt: now, expiresAt } });
  return { token, sessionId: row.id, customerId, expiresAt };
}

/** First launch: a new guest profile + session. Every call makes a NEW guest (the credential cannot be re-issued from an installation id). */
export async function createGuest(installationId: string | null, now = new Date()): Promise<IssuedSession> {
  return db.$transaction(async tx => {
    const customer = await tx.customer.create({ data: {}, select: { id: true } });
    return issueSession(tx, customer.id, installationId, now);
  });
}

export interface GuestPrincipal { customerId: string; sessionId: string }

/** Valid, unexpired, unrevoked session of a customer that has not been merged away. Sliding expiry, written at most hourly. */
export async function resolveGuestSession(token: string, now = new Date()): Promise<GuestPrincipal | null> {
  if (!TOKEN_RE.test(token)) return null;
  const hash = hashToken(token);
  const s = await db.guestSession.findUnique({ where: { tokenHash: hash }, include: { customer: { select: { mergedIntoId: true } } } });
  if (!s || !timingSafeEqual(Buffer.from(s.tokenHash), Buffer.from(hash))) return null;
  if (s.revokedAt || s.expiresAt <= now || s.customer.mergedIntoId) return null;
  if (now.getTime() - s.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    await db.guestSession.updateMany({
      where: { id: s.id, revokedAt: null },
      data: { lastSeenAt: now, expiresAt: new Date(now.getTime() + guestSessionDays() * 86_400_000) },
    });
  }
  return { customerId: s.customerId, sessionId: s.id };
}

export async function revokeSession(sessionId: string, reason: string, now = new Date()): Promise<void> {
  await db.guestSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: now, revokedReason: reason } });
}
