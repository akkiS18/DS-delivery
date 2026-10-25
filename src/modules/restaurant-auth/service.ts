import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';
import { assertPasswordPolicy, dummyHash, hashPassword, verifyPassword } from './password.js';

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const n = Number(env[name] ?? fallback);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name} ${min}–${max} oralig‘ida bo‘lsin`);
  return n;
}
/** Read per call so tests (and operators after a restart) can change them. */
export function authConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    // Sliding: the app stays signed in until the person logs out; a session expires only after this long WITHOUT any use (authenticate() renews it).
    sessionMs: intEnv(env, 'RESTAURANT_SESSION_HOURS', 4320, 1, 8760) * 3_600_000,
    maxSessions: intEnv(env, 'RESTAURANT_MAX_SESSIONS', 10, 1, 100),
    maxFailures: intEnv(env, 'RESTAURANT_LOGIN_MAX_FAILURES', 5, 1, 100),
    ipMaxFailures: intEnv(env, 'RESTAURANT_LOGIN_IP_MAX_FAILURES', 30, 1, 1000),
    windowMs: intEnv(env, 'RESTAURANT_LOGIN_WINDOW_MINUTES', 15, 1, 1440) * 60_000,
  };
}

export const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
export const attemptKey = (kind: 'slug' | 'ip', value: string): string => sha256(`${kind}:${value}`);
export const hashToken = (token: string): string => sha256(`restaurant-session:${token}`);
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** "Authorization: Bearer <token>" only; anything else is treated as no credentials. */
export function bearerToken(header: unknown): string | undefined {
  if (typeof header !== 'string') return undefined;
  const m = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
  return m?.[1];
}

/** Pure throttle decision. Counts include the attempt being made. */
export function isThrottled(slugFailures: number, ipFailures: number, cfg: { maxFailures: number; ipMaxFailures: number }): boolean {
  return slugFailures > cfg.maxFailures || ipFailures > cfg.ipMaxFailures;
}

export type PublicRestaurant = { id: string; slug: string; name: string; isPaused: boolean };
export type LoginResult =
  | { result: 'OK'; token: string; expiresAt: Date; restaurant: PublicRestaurant }
  | { result: 'INVALID' }
  | { result: 'INACTIVE' }
  | { result: 'LOCKED'; retryAfterSeconds: number };

/** The attempt is recorded and counted under a per-key advisory lock BEFORE the password is checked, so a burst of
 *  parallel guesses cannot exceed the limit. Unknown slug, missing credential and wrong password are indistinguishable. */
export async function login(input: { slug: string; password: string; ip: string }, now = new Date()): Promise<LoginResult> {
  const cfg = authConfig();
  const slug = input.slug.toLowerCase();
  const slugKey = attemptKey('slug', slug);
  const ipKey = attemptKey('ip', input.ip);
  const since = new Date(now.getTime() - cfg.windowMs);
  const gate = await db.$transaction(async tx => {
    for (const k of [slugKey, ipKey].sort()) {
      await tx.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(7014, hashtext(${k}))`;
    }
    await tx.restaurantLoginAttempt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 24 * 3_600_000) } } });
    const slugRow = await tx.restaurantLoginAttempt.create({ data: { keyHash: slugKey } });
    const ipRow = await tx.restaurantLoginAttempt.create({ data: { keyHash: ipKey } });
    const [slugFailures, ipFailures] = await Promise.all([slugKey, ipKey].map(keyHash =>
      tx.restaurantLoginAttempt.count({ where: { keyHash, success: false, createdAt: { gte: since } } })));
    return { ids: [slugRow.id, ipRow.id], throttled: isThrottled(slugFailures!, ipFailures!, cfg) };
  });
  if (gate.throttled) return { result: 'LOCKED', retryAfterSeconds: Math.ceil(cfg.windowMs / 1000) };

  const restaurant = await db.restaurant.findUnique({ where: { slug }, include: { credential: true } });
  const credential = restaurant?.credential ?? null;
  const ok = await verifyPassword(input.password, credential?.passwordHash ?? await dummyHash());
  if (!ok || !restaurant || !credential) return { result: 'INVALID' };

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + cfg.sessionMs);
  return db.$transaction(async tx => {
    // Serialize session creation per restaurant so the session cap holds under parallel logins.
    await tx.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(7015, hashtext(${restaurant.id}))`;
    // A correct password clears this slug's failure counter (not the IP's).
    await tx.restaurantLoginAttempt.updateMany({ where: { OR: [{ id: { in: gate.ids } }, { keyHash: slugKey, success: false }] }, data: { success: true } });
    if (!restaurant.isActive) return { result: 'INACTIVE' } as const;
    await tx.restaurantSession.create({ data: {
      tokenHash: hashToken(token), restaurantId: restaurant.id, passwordVersion: credential.passwordVersion, expiresAt,
    } });
    const stale = await tx.restaurantSession.findMany({
      where: { restaurantId: restaurant.id, revokedAt: null, expiresAt: { gt: now } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: cfg.maxSessions, select: { id: true },
    });
    if (stale.length) {
      await tx.restaurantSession.updateMany({ where: { id: { in: stale.map(s => s.id) }, revokedAt: null }, data: { revokedAt: now } });
    }
    return { result: 'OK', token, expiresAt, restaurant: { id: restaurant.id, slug: restaurant.slug, name: restaurant.name, isPaused: restaurant.isPaused } } as const;
  });
}

export type AuthResult =
  | { ok: true; sessionId: string; expiresAt: Date; restaurant: PublicRestaurant }
  | { ok: false; reason: 'UNAUTHENTICATED' | 'RESTAURANT_INACTIVE' };

/** Every protected request: token exists, not revoked, not expired, issued under the CURRENT password version,
 *  and the restaurant is still active. The restaurant identity comes only from here, never from the client. */
export async function authenticate(token: string | undefined, now = new Date()): Promise<AuthResult> {
  if (!token || !TOKEN_RE.test(token)) return { ok: false, reason: 'UNAUTHENTICATED' };
  const s = await db.restaurantSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { restaurant: { include: { credential: { select: { passwordVersion: true } } } } },
  });
  if (!s || s.revokedAt || s.expiresAt <= now) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!s.restaurant.credential || s.restaurant.credential.passwordVersion !== s.passwordVersion) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!s.restaurant.isActive) return { ok: false, reason: 'RESTAURANT_INACTIVE' };
  if (now.getTime() - s.lastSeenAt.getTime() > 60_000) {
    await db.restaurantSession.updateMany({ where: { id: s.id, revokedAt: null }, data: { lastSeenAt: now, expiresAt: new Date(now.getTime() + authConfig().sessionMs) } });
  }
  const r = s.restaurant;
  return { ok: true, sessionId: s.id, expiresAt: s.expiresAt, restaurant: { id: r.id, slug: r.slug, name: r.name, isPaused: r.isPaused } };
}

/** Idempotent compare-and-set; returns whether THIS call revoked the session. */
export async function logout(sessionId: string, now = new Date()): Promise<boolean> {
  const { count } = await db.restaurantSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: now } });
  return count === 1;
}

/** Explicit provisioning (CLI). Never runs implicitly, never overwrites without `replace`. A change bumps
 *  passwordVersion and revokes every session of that restaurant. */
export async function setRestaurantPassword(input: { slug: string; password: string; replace?: boolean }): Promise<{ created: boolean }> {
  const slug = input.slug.toLowerCase();
  assertPasswordPolicy(input.password, slug);
  const restaurant = await db.restaurant.findUnique({ where: { slug }, include: { credential: true } });
  if (!restaurant) throw new Error('RESTORAN_TOPILMADI');
  if (restaurant.credential && !input.replace) throw new Error('PAROL_MAVJUD: almashtirish uchun --replace kerak');
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.$transaction(async tx => {
      const now = new Date();
      if (!restaurant.credential) {
        await tx.restaurantCredential.create({ data: { restaurantId: restaurant.id, passwordHash } });
        return { created: true };
      }
      await tx.restaurantCredential.update({
        where: { restaurantId: restaurant.id },
        data: { passwordHash, passwordVersion: { increment: 1 }, passwordChangedAt: now },
      });
      await tx.restaurantSession.updateMany({ where: { restaurantId: restaurant.id, revokedAt: null }, data: { revokedAt: now } });
      return { created: false };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new Error('PAROL_MAVJUD: almashtirish uchun --replace kerak');
    throw err;
  }
}
