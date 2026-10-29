import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { db } from '../../lib/db.js';
import { isSupportAdmin } from '../support/service.js';
import { sendToAdmin } from './messenger.js';

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const n = Number(env[name] ?? fallback);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name} ${min}–${max} oralig‘ida bo‘lsin`);
  return n;
}
/** Read per call so tests (and operators after a restart) can change them. */
export function adminAuthConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    codeMs: intEnv(env, 'ADMIN_CODE_MINUTES', 5, 1, 30) * 60_000,
    codeMaxTries: intEnv(env, 'ADMIN_CODE_MAX_TRIES', 5, 1, 20),
    requestsPerId: intEnv(env, 'ADMIN_CODE_REQUESTS_PER_ID', 5, 1, 100),
    requestsPerIp: intEnv(env, 'ADMIN_CODE_REQUESTS_PER_IP', 20, 1, 1000),
    verifyFailuresPerId: intEnv(env, 'ADMIN_VERIFY_MAX_FAILURES', 10, 1, 100),
    verifyFailuresPerIp: intEnv(env, 'ADMIN_VERIFY_IP_MAX_FAILURES', 30, 1, 1000),
    windowMs: intEnv(env, 'ADMIN_LOGIN_WINDOW_MINUTES', 15, 1, 1440) * 60_000,
    // Sliding: the phone stays signed in until logout; a session expires only after this long WITHOUT use.
    sessionMs: intEnv(env, 'ADMIN_SESSION_DAYS', 90, 1, 365) * 86_400_000,
    maxSessions: intEnv(env, 'ADMIN_MAX_SESSIONS', 5, 1, 50),
  };
}

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
export const attemptKey = (kind: 'tg' | 'ip', value: string): string => sha256(`admin-${kind}:${value}`);
export const hashToken = (token: string): string => sha256(`admin-session:${token}`);
export const hashCode = (telegramUserId: string, code: string): string => sha256(`admin-login-code:${telegramUserId}:${code}`);
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const generateCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** "Authorization: Bearer <token>" only; anything else is treated as no credentials. */
export function bearerToken(header: unknown): string | undefined {
  if (typeof header !== 'string') return undefined;
  return /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header)?.[1];
}

/** Pure throttle decision. Counts include the attempt being made. */
export const isThrottled = (idCount: number, ipCount: number, limits: { id: number; ip: number }): boolean =>
  idCount > limits.id || ipCount > limits.ip;

export function cleanDeviceName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const v = raw.replace(/[\u0000-\u001f\u007f<>&]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return v === '' ? null : v;
}

/** Support admins are configured by env; a malformed env must lock everyone out, never throw into a request. */
function stillAdmin(telegramUserId: string): boolean {
  try { return isSupportAdmin(telegramUserId); } catch { return false; }
}

type Kind = 'CODE_REQUEST' | 'VERIFY';

/** The attempt is recorded and counted under per-key advisory locks BEFORE anything is decided, so a burst of parallel
 *  guesses cannot exceed the limit. The same answer is given for administrators and strangers. */
async function gate(kind: Kind, telegramUserId: string, ip: string, limits: { id: number; ip: number }, now: Date) {
  const cfg = adminAuthConfig();
  const keys = { tg: attemptKey('tg', telegramUserId), ip: attemptKey('ip', ip) };
  const since = new Date(now.getTime() - cfg.windowMs);
  return db.$transaction(async tx => {
    for (const k of [keys.tg, keys.ip].sort()) {
      await tx.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(7020, hashtext(${k}))`;
    }
    await tx.adminAuthAttempt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 24 * 3_600_000) } } });
    const idRow = await tx.adminAuthAttempt.create({ data: { keyHash: keys.tg, kind } });
    const ipRow = await tx.adminAuthAttempt.create({ data: { keyHash: keys.ip, kind } });
    const [idCount, ipCount] = await Promise.all([keys.tg, keys.ip].map(keyHash =>
      tx.adminAuthAttempt.count({ where: { keyHash, kind, success: false, createdAt: { gte: since } } })));
    return { ids: [idRow.id, ipRow.id], tgKey: keys.tg, throttled: isThrottled(idCount!, ipCount!, limits), retryAfterSeconds: Math.ceil(cfg.windowMs / 1000) };
  });
}

export type RequestCodeResult =
  | { result: 'ACCEPTED'; validMinutes: number; delivery: Promise<void> }
  | { result: 'LOCKED'; retryAfterSeconds: number };

/** Sends a one-time code to an administrator's Telegram. Administrators and strangers get the identical answer
 *  ("accepted"); a stranger just receives nothing. The Telegram call runs after the answer (`delivery`), so response
 *  time does not tell the two apart. A failed send burns the code. */
export async function requestCode(input: { telegramUserId: string; ip: string }, now = new Date()): Promise<RequestCodeResult> {
  const cfg = adminAuthConfig();
  const g = await gate('CODE_REQUEST', input.telegramUserId, input.ip, { id: cfg.requestsPerId, ip: cfg.requestsPerIp }, now);
  if (g.throttled) return { result: 'LOCKED', retryAfterSeconds: g.retryAfterSeconds };
  const validMinutes = Math.round(cfg.codeMs / 60_000);
  if (!stillAdmin(input.telegramUserId)) return { result: 'ACCEPTED', validMinutes, delivery: Promise.resolve() };

  const code = generateCode();
  const row = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(7021, hashtext(${input.telegramUserId}))`;
    // Only the newest code can work.
    await tx.adminLoginCode.updateMany({ where: { telegramUserId: input.telegramUserId, usedAt: null }, data: { usedAt: now } });
    return tx.adminLoginCode.create({ data: {
      telegramUserId: input.telegramUserId, codeHash: hashCode(input.telegramUserId, code), expiresAt: new Date(now.getTime() + cfg.codeMs),
    } });
  });
  const delivery = sendToAdmin(input.telegramUserId,
    `🔐 <b>DS Admin</b> kirish kodi: <code>${code}</code>\n${validMinutes} daqiqa amal qiladi. Hech kimga bermang.`)
    .catch(async (err: unknown) => {
      console.error('[ADMIN CODE]', err instanceof Error ? err.message : 'Unknown error');
      await db.adminLoginCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    });
  return { result: 'ACCEPTED', validMinutes, delivery };
}

export type VerifyResult =
  | { result: 'OK'; token: string; sessionId: string; expiresAt: Date; delivery: Promise<void> }
  | { result: 'INVALID' }
  | { result: 'LOCKED'; retryAfterSeconds: number };

/** Unknown id, wrong code, used code, expired code and a code that ran out of tries are indistinguishable. */
export async function verifyCode(input: { telegramUserId: string; code: string; deviceName?: string | null; ip: string }, now = new Date()): Promise<VerifyResult> {
  const cfg = adminAuthConfig();
  const g = await gate('VERIFY', input.telegramUserId, input.ip, { id: cfg.verifyFailuresPerId, ip: cfg.verifyFailuresPerIp }, now);
  if (g.throttled) return { result: 'LOCKED', retryAfterSeconds: g.retryAfterSeconds };
  if (!stillAdmin(input.telegramUserId)) return { result: 'INVALID' };

  const deviceName = cleanDeviceName(input.deviceName);
  const token = randomBytes(32).toString('base64url');
  const out = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(7021, hashtext(${input.telegramUserId}))`;
    const latest = await tx.adminLoginCode.findFirst({
      where: { telegramUserId: input.telegramUserId, usedAt: null, expiresAt: { gt: now }, attempts: { lt: cfg.codeMaxTries } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!latest) return null;
    // The try is counted before the comparison and survives a wrong code (this branch commits).
    const tried = await tx.adminLoginCode.updateMany({ where: { id: latest.id, usedAt: null, attempts: { lt: cfg.codeMaxTries } }, data: { attempts: { increment: 1 } } });
    if (tried.count !== 1) return null;
    const a = Buffer.from(hashCode(input.telegramUserId, input.code));
    const b = Buffer.from(latest.codeHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const used = await tx.adminLoginCode.updateMany({ where: { id: latest.id, usedAt: null }, data: { usedAt: now } });
    if (used.count !== 1) return null;

    // A correct code clears this admin's failure counter (not the IP's).
    await tx.adminAuthAttempt.updateMany({ where: { OR: [{ id: { in: g.ids } }, { keyHash: g.tgKey, kind: 'VERIFY', success: false }] }, data: { success: true } });
    const session = await tx.adminSession.create({ data: {
      tokenHash: hashToken(token), telegramUserId: input.telegramUserId, deviceName, expiresAt: new Date(now.getTime() + cfg.sessionMs),
    } });
    const stale = await tx.adminSession.findMany({
      where: { telegramUserId: input.telegramUserId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: cfg.maxSessions, select: { id: true },
    });
    if (stale.length) {
      await tx.adminSession.updateMany({ where: { id: { in: stale.map(s => s.id) }, revokedAt: null }, data: { revokedAt: now, revokedReason: 'SESSION_LIMIT' } });
    }
    await tx.adminAuditEvent.create({ data: {
      actorId: input.telegramUserId, action: 'ADMIN_APP_LOGIN', targetType: 'AdminSession', targetId: session.id, details: { deviceName },
    } });
    return session;
  });
  if (!out) return { result: 'INVALID' };
  // Best effort, after the commit: the administrator learns that a new device signed in.
  const delivery = sendToAdmin(input.telegramUserId,
    `📱 <b>DS Admin</b> ilovasiga kirildi${deviceName ? `: ${deviceName}` : ''}.\nSiz emasmisiz? Hamma qurilmalarni yopish: /logoutall`)
    .catch((err: unknown) => { console.error('[ADMIN LOGIN NOTICE]', err instanceof Error ? err.message : 'Unknown error'); });
  return { result: 'OK', token, sessionId: out.id, expiresAt: out.expiresAt, delivery };
}

export type AdminAuth =
  | { ok: true; sessionId: string; telegramUserId: string; deviceName: string | null; expiresAt: Date }
  | { ok: false };

/** Every protected request: token exists, not revoked, not expired, AND its Telegram id is still a support admin
 *  (removing an id from the environment cuts that phone off at once). The admin identity comes only from here. */
export async function authenticate(token: string | undefined, now = new Date()): Promise<AdminAuth> {
  if (!token || !TOKEN_RE.test(token)) return { ok: false };
  const s = await db.adminSession.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!s || s.revokedAt || s.expiresAt <= now) return { ok: false };
  if (!stillAdmin(s.telegramUserId)) return { ok: false };
  if (now.getTime() - s.lastSeenAt.getTime() > 60_000) {
    await db.adminSession.updateMany({ where: { id: s.id, revokedAt: null }, data: { lastSeenAt: now, expiresAt: new Date(now.getTime() + adminAuthConfig().sessionMs) } });
  }
  return { ok: true, sessionId: s.id, telegramUserId: s.telegramUserId, deviceName: s.deviceName, expiresAt: s.expiresAt };
}

/** Idempotent compare-and-set; returns whether THIS call revoked the session. */
export async function logout(sessionId: string, actorId: string, now = new Date()): Promise<boolean> {
  return db.$transaction(async tx => {
    const { count } = await tx.adminSession.updateMany({ where: { id: sessionId, telegramUserId: actorId, revokedAt: null }, data: { revokedAt: now, revokedReason: 'LOGOUT' } });
    if (count === 1) await tx.adminAuditEvent.create({ data: { actorId, action: 'ADMIN_APP_LOGOUT', targetType: 'AdminSession', targetId: sessionId } });
    return count === 1;
  });
}

/** Closes every open session of this administrator (lost phone). Returns how many were open. */
export async function logoutAll(actorId: string, now = new Date()): Promise<number> {
  return db.$transaction(async tx => {
    const { count } = await tx.adminSession.updateMany({ where: { telegramUserId: actorId, revokedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now, revokedReason: 'LOGOUT_ALL' } });
    await tx.adminAuditEvent.create({ data: { actorId, action: 'ADMIN_APP_LOGOUT_ALL', targetType: 'AdminSession', targetId: actorId, details: { closed: count } } });
    return count;
  });
}
