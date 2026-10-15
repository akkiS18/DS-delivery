import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import { parseUzcardEmail } from './uzcard.js';
import type { PaymentEngineV3 } from './engine.js';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const CREDS_FILE = 'credentials.json';
const TOKEN_FILE = 'gmail-token.json';
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
  const config = JSON.parse(await fs.readFile(CREDS_FILE, 'utf8')) as { installed?: OAuthConfig };
  if (!config.installed?.client_id || !config.installed?.client_secret) {
    throw new Error('credentials.json: Google OAuth Client turi Desktop app bo‘lishi kerak.');
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
    await fs.writeFile(TOKEN_FILE, JSON.stringify(token, null, 2), { mode: 0o600 });
    return token;
  } finally { server.close(); }
}
async function createAccessToken(): Promise<() => Promise<string>> {
  const config = await readOAuth();
  let token: OAuthToken;
  try { token = JSON.parse(await fs.readFile(TOKEN_FILE, 'utf8')) as OAuthToken; }
  catch { token = await authorize(config); }
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
    await fs.writeFile(TOKEN_FILE, JSON.stringify(token, null, 2), { mode: 0o600 });
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

export async function startGmail(engine: PaymentEngineV3): Promise<() => void> {
  const from = (process.env.GMAIL_FROM ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) throw new Error('GMAIL_FROM haqiqiy UZCARD yuboruvchi e-mail bo‘lsin.');
  const pollSeconds = positiveIntegerEnv('GMAIL_POLL_SECONDS', 12, 5);
  const lookback = positiveIntegerEnv('GMAIL_LOOKBACK_SECONDS', 86400, 120);
  const accessToken = await createAccessToken();
  const gmailGet = async <T>(uri: string): Promise<T> => {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${uri}`, {
      headers: { Authorization: `Bearer ${await accessToken()}` },
    });
    if (!res.ok) throw new Error(`Gmail ${res.status}: ${(await res.text()).slice(0, 250)}`);
    return await res.json() as T;
  };
  let busy = false;
  let stopped = false;
  const poll = async (): Promise<void> => {
    if (busy || stopped) return;
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
          await engine.ingestGmail(id, {
            cardLast4: parsed.cardLast4, amountTiyin: parsed.amountTiyin,
            occurredAt: parsed.occurredAt, minutePrecision: true,
            emailReceivedAt: new Date(emailReceivedAt),
            trustedSender: authenticatedMail(message.payload, from.split('@')[1]),
          });
        }
        pageToken = list.nextPageToken;
        pages++;
      } while (pageToken && pages < 100 && !stopped);
      if (pageToken) console.log('[⚠ GMAIL] Juda ko‘p xat: 100 sahifa limiti; keyingi poll davom ettiradi.');
    } catch (error) { console.error(`[GMAIL ERROR] ${error instanceof Error ? error.message : String(error)}`); }
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
