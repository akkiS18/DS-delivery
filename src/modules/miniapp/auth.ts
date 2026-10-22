import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Telegram Mini App authentication: verification of `initData` (https://core.telegram.org/bots/webapps#validating-data-received-via-a-mini-app).
 *
 *   secret_key = HMAC_SHA256(key = "WebAppData", message = BOT_TOKEN)
 *   hash       = HMAC_SHA256(key = secret_key,  message = data_check_string)
 *   data_check_string = every received field except `hash`, sorted by key, as "key=value" lines joined by "\n"
 *
 * Only a request whose signature verifies AND whose `auth_date` is recent is accepted; the user id comes from the SIGNED `user` field.
 * `initDataUnsafe` (the parsed object the browser exposes) is never used, and no customer id is ever read from a request body.
 */
export type InitDataUser = { id: string; firstName: string | null; lastName: string | null; username: string | null; languageCode: string | null };
export type InitDataResult =
  | { ok: true; user: InitDataUser; authDate: number }
  | { ok: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'FUTURE' | 'NO_USER' };

const MAX_FUTURE_SKEW_SECONDS = 60;

export function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()].filter(([k]) => k !== 'hash').sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
}

export function computeInitDataHash(params: URLSearchParams, botToken: string): string {
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secret).update(dataCheckString(params)).digest('hex');
}

/** Builds a correctly signed initData string. Used by tests and by the local development tool - never by the server's request path. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  params.set('hash', computeInitDataHash(params, botToken));
  return params.toString();
}

export function verifyInitData(raw: string, botToken: string, opts: { maxAgeSeconds: number; nowSeconds?: number }): InitDataResult {
  if (!raw || raw.length > 4096 || !botToken) return { ok: false, reason: 'MALFORMED' };
  let params: URLSearchParams;
  try { params = new URLSearchParams(raw); } catch { return { ok: false, reason: 'MALFORMED' }; }
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return { ok: false, reason: 'MALFORMED' };
  const expected = Buffer.from(computeInitDataHash(params, botToken), 'hex');
  const given = Buffer.from(hash, 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'BAD_SIGNATURE' };

  const authDate = Number(params.get('auth_date'));
  if (!Number.isSafeInteger(authDate) || authDate <= 0) return { ok: false, reason: 'MALFORMED' };
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (authDate > now + MAX_FUTURE_SKEW_SECONDS) return { ok: false, reason: 'FUTURE' };
  if (now - authDate > opts.maxAgeSeconds) return { ok: false, reason: 'EXPIRED' };

  let user: unknown;
  try { user = JSON.parse(params.get('user') ?? ''); } catch { return { ok: false, reason: 'NO_USER' }; }
  const u = user as { id?: unknown; first_name?: unknown; last_name?: unknown; username?: unknown; language_code?: unknown; is_bot?: unknown };
  if (!u || typeof u.id !== 'number' || !Number.isSafeInteger(u.id) || u.id <= 0 || u.is_bot === true) return { ok: false, reason: 'NO_USER' };
  const str = (v: unknown): string | null => (typeof v === 'string' && v.length <= 128 ? v : null);
  return { ok: true, authDate, user: { id: String(u.id), firstName: str(u.first_name), lastName: str(u.last_name), username: str(u.username), languageCode: str(u.language_code) } };
}

/** `Authorization: tma <initData>` -> the raw initData, or null. */
export function initDataFromHeader(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^tma\s+(.+)$/i.exec(header.trim());
  return m ? m[1]! : null;
}
