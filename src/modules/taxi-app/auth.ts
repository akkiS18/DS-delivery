import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';
import { assertPasswordPolicy, dummyHash, hashPassword, verifyPassword } from '../restaurant-auth/password.js';
import { authConfig, isThrottled } from '../restaurant-auth/service.js';

/**
 * Sign-in for the DS Taxi app. Same model as the restaurant app: one shared login per company, an Argon2id password, an opaque bearer token
 * of which only the SHA-256 is stored, throttled attempts, and a password change that signs every device out. The company identity returned
 * by `authenticate` is the ONLY one routes may use: request bodies, query strings and headers never choose a company.
 */
function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const n = Number(env[name] ?? fallback);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name} ${min}–${max} oralig‘ida bo‘lsin`);
  return n;
}
/** An operator's phone stays signed in for weeks (it sits on the dispatcher's desk), unlike a restaurant tablet. */
export function taxiAuthConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    ...authConfig(env),
    sessionMs: intEnv(env, 'TAXI_SESSION_HOURS', 4320, 1, 8760) * 3_600_000, // sliding, like the restaurant app: renewed on use
    maxSessions: intEnv(env, 'TAXI_MAX_SESSIONS', 5, 1, 50),
  };
}

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
export const taxiAttemptKey = (kind: 'login' | 'ip', value: string): string => sha256(`taxi-${kind}:${value}`);
export const hashTaxiToken = (token: string): string => sha256(`taxi-session:${token}`);
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const LOGIN_RE = /^[a-z0-9-]{2,40}$/;

export function bearerToken(header: unknown): string | undefined {
  if (typeof header !== 'string') return undefined;
  return /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header)?.[1];
}

export type PublicTaxiCompany = { id: string; name: string; login: string };
export type TaxiLoginResult =
  | { result: 'OK'; token: string; expiresAt: Date; company: PublicTaxiCompany }
  | { result: 'INVALID' }
  | { result: 'INACTIVE' }
  | { result: 'LOCKED'; retryAfterSeconds: number };

export async function loginTaxi(input: { login: string; password: string; ip: string }, now = new Date()): Promise<TaxiLoginResult> {
  const cfg = taxiAuthConfig();
  const login = input.login.toLowerCase();
  const loginKey = taxiAttemptKey('login', login);
  const ipKey = taxiAttemptKey('ip', input.ip);
  const since = new Date(now.getTime() - cfg.windowMs);
  const gate = await db.$transaction(async tx => {
    for (const k of [loginKey, ipKey].sort()) {
      await tx.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(7018, hashtext(${k}))`;
    }
    await tx.restaurantLoginAttempt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 24 * 3_600_000) } } });
    const a = await tx.restaurantLoginAttempt.create({ data: { keyHash: loginKey } });
    const b = await tx.restaurantLoginAttempt.create({ data: { keyHash: ipKey } });
    const [loginFailures, ipFailures] = await Promise.all([loginKey, ipKey].map(keyHash =>
      tx.restaurantLoginAttempt.count({ where: { keyHash, success: false, createdAt: { gte: since } } })));
    return { ids: [a.id, b.id], throttled: isThrottled(loginFailures!, ipFailures!, cfg) };
  });
  if (gate.throttled) return { result: 'LOCKED', retryAfterSeconds: Math.ceil(cfg.windowMs / 1000) };

  const credential = await db.taxiCredential.findUnique({ where: { login }, include: { taxiCompany: true } });
  const ok = await verifyPassword(input.password, credential?.passwordHash ?? await dummyHash());
  if (!ok || !credential) return { result: 'INVALID' };

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + cfg.sessionMs);
  const company = credential.taxiCompany;
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(7019, hashtext(${company.id}))`;
    await tx.restaurantLoginAttempt.updateMany({ where: { OR: [{ id: { in: gate.ids } }, { keyHash: loginKey, success: false }] }, data: { success: true } });
    if (!company.isActive) return { result: 'INACTIVE' } as const;
    await tx.taxiSession.create({ data: { tokenHash: hashTaxiToken(token), taxiCompanyId: company.id, passwordVersion: credential.passwordVersion, expiresAt } });
    const stale = await tx.taxiSession.findMany({
      where: { taxiCompanyId: company.id, revokedAt: null, expiresAt: { gt: now } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: cfg.maxSessions, select: { id: true },
    });
    if (stale.length) await tx.taxiSession.updateMany({ where: { id: { in: stale.map(s => s.id) }, revokedAt: null }, data: { revokedAt: now } });
    return { result: 'OK', token, expiresAt, company: { id: company.id, name: company.name, login: credential.login } } as const;
  });
}

export type TaxiAuthResult =
  | { ok: true; sessionId: string; expiresAt: Date; company: PublicTaxiCompany }
  | { ok: false; reason: 'UNAUTHENTICATED' | 'COMPANY_INACTIVE' };

/** Every protected request: token exists, not revoked, not expired, issued under the CURRENT password version, company still active.
 *  `lastSeenAt` is refreshed at most every 15 seconds: it is the app's heartbeat (the dispatcher alerts the administrators when it is stale). */
export async function authenticateTaxi(token: string | undefined, now = new Date()): Promise<TaxiAuthResult> {
  if (!token || !TOKEN_RE.test(token)) return { ok: false, reason: 'UNAUTHENTICATED' };
  const s = await db.taxiSession.findUnique({
    where: { tokenHash: hashTaxiToken(token) },
    include: { taxiCompany: { include: { credential: { select: { login: true, passwordVersion: true } } } } },
  });
  if (!s || s.revokedAt || s.expiresAt <= now) return { ok: false, reason: 'UNAUTHENTICATED' };
  const credential = s.taxiCompany.credential;
  if (!credential || credential.passwordVersion !== s.passwordVersion) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!s.taxiCompany.isActive) return { ok: false, reason: 'COMPANY_INACTIVE' };
  if (now.getTime() - s.lastSeenAt.getTime() > 15_000) {
    await db.taxiSession.updateMany({ where: { id: s.id, revokedAt: null }, data: { lastSeenAt: now, expiresAt: new Date(now.getTime() + taxiAuthConfig().sessionMs) } });
  }
  return { ok: true, sessionId: s.id, expiresAt: s.expiresAt, company: { id: s.taxiCompany.id, name: s.taxiCompany.name, login: credential.login } };
}

export async function logoutTaxi(sessionId: string, now = new Date()): Promise<boolean> {
  const { count } = await db.taxiSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: now } });
  return count === 1;
}

/** Creates or replaces the company's app login. A replacement bumps passwordVersion and signs every device out. */
export async function setTaxiCredential(input: { companyId: string; login: string; password: string }): Promise<{ created: boolean }> {
  const login = input.login.toLowerCase();
  if (!LOGIN_RE.test(login)) throw new Error('LOGIN_NOTOGRI');
  assertPasswordPolicy(input.password, login);
  const company = await db.taxiCompany.findUnique({ where: { id: input.companyId }, include: { credential: true } });
  if (!company) throw new Error('TAKSI_KOMPANIYASI_TOPILMADI');
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.$transaction(async tx => {
      const now = new Date();
      if (!company.credential) {
        await tx.taxiCredential.create({ data: { taxiCompanyId: company.id, login, passwordHash } });
        return { created: true };
      }
      await tx.taxiCredential.update({
        where: { taxiCompanyId: company.id },
        data: { login, passwordHash, passwordVersion: { increment: 1 }, passwordChangedAt: now },
      });
      await tx.taxiSession.updateMany({ where: { taxiCompanyId: company.id, revokedAt: null }, data: { revokedAt: now } });
      return { created: false };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new Error('LOGIN_BAND');
    throw err;
  }
}
