import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { parseUzcardEmail } from './uzcard.js';
import type { PaymentEngineV3, MatchResult } from './engine.js';
import { backoffMs, classifyGmailError, gmailHealth, isFreshIncoming, type GmailFailure } from './gmail-health.js';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
// Defaults keep the local layout (files next to package.json). On a server the files live on a writable volume (Stage 8A):
// GMAIL_CREDENTIALS_FILE / GMAIL_TOKEN_FILE. The token file is rewritten on every refresh, so its directory must be writable.
const credsFile = (): string => process.env.GMAIL_CREDENTIALS_FILE?.trim() || 'credentials.json';
const tokenFile = (): string => process.env.GMAIL_TOKEN_FILE?.trim() || 'gmail-token.json';

/** Events the host can turn into admin messages. Contents are already secret-free (amounts, last4, reason codes). */
export type GmailAlert =
  | { type: 'DOWN'; failure: GmailFailure }
  | { type: 'RECOVERED' }
  | { type: 'REVIEW'; reason: string; amountTiyin: bigint; cardLast4: string };
export type GmailHooks = { onAlert?: (alert: GmailAlert) => void | Promise<void> };

/** Atomic and private: a crash while writing must never leave a half-written token that blocks every later start. */
async function writeTokenFile(token: unknown): Promise<void> {
  const file = tokenFile();
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(token, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
}
type OAuthConfig = { client_id: string; client_secret: string };
type OAuthToken = {
  access_token?: string; refresh_token?: string; expires_in?: number; expires_at?: number;
};
type GooglePayload = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GooglePayload[];
  headers?: Array<{ name: string; value: string }>;
};
type GmailMessage = { id?: string; internalDate?: string; payload?: GooglePayload };

async function tokenRequest(params: Record<string, string>): Promise<OAuthToken> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const json = await response.json() as OAuthToken & { error?: string };
  if (!response.ok) throw new Error(`Google OAuth: ${json.error || response.status}`);
  return json;
}
async function readOAuth(): Promise<OAuthConfig> {
  let config: { installed?: OAuthConfig };
  try { config = JSON.parse(await fs.readFile(credsFile(), 'utf8')) as { installed?: OAuthConfig }; }
  catch { throw new Error('GMAIL_CREDENTIALS_FILE o‘qilmadi (fayl yo‘q yoki JSON emas).'); }
  if (!config.installed?.client_id || !config.installed?.client_secret) {
    throw new Error('GMAIL_CREDENTIALS_FILE: Google OAuth Client turi Desktop app bo‘lishi kerak.');
  }
  return config.installed;
}
async function authorize(config: OAuthConfig): Promise<OAuthToken> {
  const state = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  let resolveCode!: (value: string) => void;
  let rejectCode!: (reason: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/oauth2callback' || url.searchParams.get('state') !== state) {
      res.writeHead(400).end('OAuth state/path xatosi'); return;
    }
    if (url.searchParams.has('error')) {
      rejectCode(new Error(`Google: ${url.searchParams.get('error')}`));
      res.writeHead(400).end('Ruxsat berilmadi'); return;
    }
    const code = url.searchParams.get('code');
    if (!code) { res.writeHead(400).end('OAuth code yo‘q'); return; }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('DS Delivery Gmail: ruxsat olindi. Terminalga qayting.');
    resolveCode(code);
  });
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  try {
    const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}/oauth2callback`;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for (const [k, v] of Object.entries({
      client_id: config.client_id, redirect_uri: redirectUri, response_type: 'code',
      scope: SCOPE, access_type: 'offline', prompt: 'consent',
      code_challenge_method: 'S256', code_challenge: challenge, state,
    })) url.searchParams.set(k, v);
    console.log('\n[GMAIL AUTH] Bir marta brauzerda ochib, Google ruxsatini bering:\n' + url + '\n');
    let timeoutId: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('OAuth 3 daqiqa ichida yakunlanmadi')), 180_000);
    });
    let code: string;
    try { code = await Promise.race([codePromise, timeout]); }
    finally { if (timeoutId) clearTimeout(timeoutId); }
    const token = await tokenRequest({
      code, client_id: config.client_id, client_secret: config.client_secret,
      redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier,
    });
    token.expires_at = Date.now() + (token.expires_in ?? 3600) * 1000;
    await writeTokenFile(token);
    return token;
  } finally { server.close(); }
}
async function createAccessToken(): Promise<() => Promise<string>> {
  const config = await readOAuth();
  let token: OAuthToken;
  try { token = JSON.parse(await fs.readFile(tokenFile(), 'utf8')) as OAuthToken; }
  catch (err) {
    // The browser consent flow needs a person at a terminal. A server (no TTY) must never sit waiting for it: fail at once with a clear reason.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('GMAIL_TOKEN_FILE o‘qilmadi yoki buzilgan; zaxiradan tiklang yoki lokal kompyuterda qayta ruxsat bering.');
    if (!process.stdin.isTTY) throw new Error('GMAIL_TOKEN_FILE yo‘q: ruxsatni lokal kompyuterda bering va tokenni serverga xavfsiz joylashtiring.');
    token = await authorize(config);
  }
  return async () => {
    if (token.access_token && (token.expires_at ?? 0) > Date.now() + 90_000) return token.access_token;
    if (!token.refresh_token) throw new Error('Refresh token yo‘q; gmail-token.json ni zaxiralab qayta OAuth qiling.');
    const updated = await tokenRequest({
      refresh_token: token.refresh_token, client_id: config.client_id,
      client_secret: config.client_secret, grant_type: 'refresh_token',
    });
    token = {
      ...token, ...updated, refresh_token: updated.refresh_token ?? token.refresh_token,
      expires_at: Date.now() + (updated.expires_in ?? 3600) * 1000,
    };
    await writeTokenFile(token);
    if (!token.access_token) throw new Error('Google access token yo‘q');
    return token.access_token;
  };
}

function getHeader(payload: GooglePayload | undefined, name: string): string {
  return payload?.headers?.find(h => h.name.toLowerCase() === name)?.value ?? '';
}
function extractText(payload: GooglePayload | undefined): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  }
  for (const part of payload.parts ?? []) {
    const text = extractText(part);
    if (text) return text;
  }
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf8')
      .replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  }
  return '';
}
function authenticatedMail(payload: GooglePayload | undefined, senderDomain: string): boolean {
  // Gmail's Authentication-Results header is a useful heuristic, not a bank signature.
  const auth = (payload?.headers ?? []).filter(h => h.name.toLowerCase() === 'authentication-results')
    .map(h => h.value).join(' ');
  const dmarc = /\bdmarc=pass\b/i.test(auth) && auth.toLowerCase().includes(`header.from=${senderDomain}`);
  const escaped = senderDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const dkim = new RegExp(`\\bdkim=pass\\b[^;]*header\\.d=${escaped}(?:\\s|;|$)`, 'i').test(auth);
  return dmarc || dkim;
}
function positiveIntegerEnv(name: string, fallback: number, minimum: number): number {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(n) || n < minimum) throw new Error(`${name} ${minimum} dan kam bo‘lmasligi kerak`);
  return n;
}

export async function startGmail(engine: PaymentEngineV3, hooks: GmailHooks = {}): Promise<() => void> {
  const alert = async (a: GmailAlert): Promise<void> => {
    try { await hooks.onAlert?.(a); } catch { /* an alert that cannot be delivered must never stop the reader */ }
  };
  const transition = (t: 'DOWN' | 'RECOVERED' | null, failure: GmailFailure | null): void => {
    if (t === 'DOWN') void alert({ type: 'DOWN', failure: failure ?? 'api' });
    else if (t === 'RECOVERED') void alert({ type: 'RECOVERED' });
  };
  let pollMs = 12_000;
  let accessToken: () => Promise<string>;
  let from: string; let pollSeconds: number; let lookback: number;
  try {
    from = (process.env.GMAIL_FROM ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) throw new Error('GMAIL_FROM haqiqiy UZCARD yuboruvchi e-mail bo‘lsin.');
    pollSeconds = positiveIntegerEnv('GMAIL_POLL_SECONDS', 12, 5);
    lookback = positiveIntegerEnv('GMAIL_LOOKBACK_SECONDS', 86400, 120);
    pollMs = pollSeconds * 1000;
    gmailHealth.enable(pollMs);
    accessToken = await createAccessToken();
  } catch (err) {
    // Startup problems (missing token, bad settings) are reported like any other outage instead of only being logged.
    gmailHealth.enable(pollMs);
    const message = err instanceof Error ? err.message : String(err);
    transition(gmailHealth.failed(classifyGmailError(message)), gmailHealth.failure);
    throw err;
  }
  const gmailGet = async <T>(uri: string): Promise<T> => {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${uri}`, {
      headers: { Authorization: `Bearer ${await accessToken()}` },
    });
    if (!res.ok) throw new Error(`Gmail ${res.status}: ${(await res.text()).slice(0, 250)}`);
    return await res.json() as T;
  };
  let busy = false;
  let stopped = false;
  let nextAllowedAt = 0;
  const poll = async (): Promise<void> => {
    if (busy || stopped || Date.now() < nextAllowedAt) return;
    busy = true;
    try {
      const after = Math.floor(Date.now() / 1000) - lookback;
      let pageToken: string | undefined;
      let pages = 0;
      do {
        const q = new URLSearchParams({ q: `after:${after} from:${from}`, maxResults: '100' });
        if (pageToken) q.set('pageToken', pageToken);
        const list = await gmailGet<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(`messages?${q.toString()}`);
        const ids = (list.messages ?? []).map(m => m.id);
        const seen = await engine.seenGmail(ids);
        for (const id of ids.reverse()) {
          if (stopped || seen.has(id)) continue;
          const message = await gmailGet<GmailMessage>(`messages/${encodeURIComponent(id)}?format=full`);
          const rawFrom = getHeader(message.payload, 'from');
          const fromAddress = (rawFrom.match(/<([^<>]+)>/)?.[1] ?? rawFrom).trim().toLowerCase();
          if (fromAddress !== from) { await engine.markGmailIgnored(id, 'FROM_MISMATCH'); continue; }
          const parsed = parseUzcardEmail(extractText(message.payload));
          if (!parsed) { await engine.markGmailIgnored(id, 'NOT_UZCARD_INCOMING_FORMAT'); continue; }
          const emailReceivedAt = Number(message.internalDate);
          if (!Number.isFinite(emailReceivedAt)) { await engine.markGmailIgnored(id, 'INVALID_EMAIL_DATE'); continue; }
          const result: MatchResult = await engine.ingestGmail(id, {
            cardLast4: parsed.cardLast4, amountTiyin: parsed.amountTiyin,
            occurredAt: parsed.occurredAt, minutePrecision: true,
            emailReceivedAt: new Date(emailReceivedAt),
            trustedSender: authenticatedMail(message.payload, from.split('@')[1]),
          });
          // Money arrived that no payment accepted (late, wrong amount, unknown card...): somebody has to look at it now, not later.
          if (result.status === 'REVIEW_REQUIRED' && isFreshIncoming(emailReceivedAt, Date.now())) {
            void alert({ type: 'REVIEW', reason: result.reason ?? 'UNKNOWN', amountTiyin: parsed.amountTiyin, cardLast4: parsed.cardLast4 });
          }
        }
        pageToken = list.nextPageToken;
        pages++;
      } while (pageToken && pages < 100 && !stopped);
      if (pageToken) console.log('[⚠ GMAIL] Juda ko‘p xat: 100 sahifa limiti; keyingi poll davom ettiradi.');
      nextAllowedAt = 0;
      transition(gmailHealth.succeeded(), null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[GMAIL ERROR] ${message}`);
      transition(gmailHealth.failed(classifyGmailError(message)), gmailHealth.failure);
      nextAllowedAt = Date.now() + backoffMs(gmailHealth.consecutiveFailures, pollMs);
    }
    finally { busy = false; }
  };
  const timer = setInterval(() => void poll(), pollSeconds * 1000);
  void poll();
  console.log(`[GMAIL ON] ${from} | har ${pollSeconds}s | so‘nggi ${Math.round(lookback / 60)} daqiqa qayta ko‘riladi`);
  return () => {
    stopped = true;
    clearInterval(timer);
    console.log('[GMAIL OFF]');
  };
}
