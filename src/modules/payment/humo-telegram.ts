import fs from 'node:fs/promises';
import type { PaymentEngineV3, MatchResult } from './engine.js';
import { parseHumoMessage } from './humo.js';
import { isFreshIncoming } from './gmail-health.js';

/**
 * Reads the Humocard bot chat of ONE Telegram user account (MTProto, api_id/api_hash from my.telegram.org) and feeds every credit into the same
 * payment engine as the bank e-mail. It is a signal like the mail: the engine ends in MATCHED_UNVERIFIED (never an automatic confirmation here).
 *
 * Trust: a message counts only when it comes from the configured bot account (HUMO_TG_BOT, resolved to its numeric id at start, and it must be
 * a bot). Messages from anybody else, in any chat, are dropped before their text is even looked at, so a customer cannot fake a payment by
 * sending a lookalike message to the card owner. The session string is the login of that account: it lives in HUMO_TG_SESSION or in a 0600 file
 * (HUMO_TG_SESSION_FILE, default humo-session.txt), never in git.
 *
 * Speed: the live handler reacts to a new message at once; a short poll of the chat's recent history (HUMO_TG_POLL_SECONDS) is the safety net for a
 * dropped update and for messages that arrived while this process was down (HUMO_TG_LOOKBACK_SECONDS). Both paths are idempotent: the key
 * `<botId>:<messageId>` is the IncomingTransaction.sourceId.
 *
 * The `telegram` (gramjs) package is imported only when this feature is switched on, so a server without it still starts.
 */
export type HumoAlert =
  | { type: 'DOWN'; failure: 'auth' | 'bot' | 'network' | 'config' }
  | { type: 'RECOVERED' }
  | { type: 'REVIEW'; reason: string; amountTiyin: bigint; cardLast4: string };
export type HumoHooks = {
  onAlert?: (alert: HumoAlert) => void | Promise<void>;
  /** A credit just matched an open payment: the host runs the automatic confirmation right away instead of waiting for its next sweep. */
  onMatched?: () => void | Promise<void>;
};

// The few gramjs members used here. Declared locally so this file type-checks without the package present.
type TgId = { toString(): string };
export type TgMessage = { id: number; date: number; message?: string; out?: boolean; senderId?: TgId };
type TgEntity = { id: TgId; bot?: boolean; username?: string };
type TgClient = {
  connect(): Promise<unknown>;
  checkAuthorization(): Promise<boolean>;
  getEntity(entity: string): Promise<TgEntity>;
  getMessages(entity: TgEntity, params: { limit: number }): Promise<TgMessage[]>;
  addEventHandler(callback: (event: { message: TgMessage }) => unknown, event: unknown): unknown;
  setLogLevel(level: string): void;
  disconnect(): Promise<unknown>;
};

export const humoSessionFile = (): string => process.env.HUMO_TG_SESSION_FILE?.trim() || 'humo-session.txt';

export async function readHumoSession(): Promise<string> {
  const inline = process.env.HUMO_TG_SESSION?.trim();
  if (inline) return inline;
  try { return (await fs.readFile(humoSessionFile(), 'utf8')).trim(); } catch { return ''; }
}

function positiveInt(name: string, fallback: number, minimum: number): number {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(n) || n < minimum) throw new Error(`${name} ${minimum} dan kam bo‘lmasligi kerak`);
  return n;
}

export type HumoSettings = { apiId: number; apiHash: string; session: string; bot: string; pollSeconds: number; lookbackSeconds: number };

export async function humoSettings(): Promise<HumoSettings> {
  const apiId = Number(process.env.HUMO_TG_API_ID);
  const apiHash = process.env.HUMO_TG_API_HASH?.trim() ?? '';
  const bot = (process.env.HUMO_TG_BOT ?? '').trim().replace(/^@/, '');
  if (!Number.isSafeInteger(apiId) || apiId <= 0) throw new Error('HUMO_TG_API_ID (my.telegram.org dagi raqam) kerak.');
  if (!/^[0-9a-f]{32}$/i.test(apiHash)) throw new Error('HUMO_TG_API_HASH (my.telegram.org dagi 32 belgili matn) kerak.');
  if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(bot)) throw new Error('HUMO_TG_BOT: Humocard botning username‘i (masalan humocardbot) kerak.');
  const session = await readHumoSession();
  if (!session) throw new Error('Telegram session yo‘q: avval `npm run humo:login` ni ishga tushiring.');
  return { apiId, apiHash, session, bot, pollSeconds: positiveInt('HUMO_TG_POLL_SECONDS', 30, 5), lookbackSeconds: positiveInt('HUMO_TG_LOOKBACK_SECONDS', 1800, 120) };
}

/** Pure part of message handling (also what the tests drive): one message from the verified bot -> engine result, or null when not a credit. */
export async function ingestHumoMessage(
  engine: PaymentEngineV3, botId: string, message: TgMessage, nowMs = Date.now(), lookbackMs = 1_800_000,
): Promise<{ result: MatchResult; cardLast4: string; amountTiyin: bigint } | null> {
  // Authority check first, before the text is read: only the verified bot account, never our own outgoing messages.
  if (message.out || message.senderId?.toString() !== botId) return null;
  const messageMs = message.date * 1000;
  if (!Number.isFinite(messageMs) || nowMs - messageMs > lookbackMs) return null;
  const parsed = parseHumoMessage(message.message ?? '');
  if (!parsed) return null;
  const result = await engine.ingestHumo(`${botId}:${message.id}`, {
    cardLast4: parsed.cardLast4, amountTiyin: parsed.amountTiyin, occurredAt: parsed.occurredAt, minutePrecision: true,
    messageDate: new Date(messageMs), trustedSender: true,
  });
  return { result, cardLast4: parsed.cardLast4, amountTiyin: parsed.amountTiyin };
}

export async function startHumoTelegram(engine: PaymentEngineV3, hooks: HumoHooks = {}): Promise<() => void> {
  const alert = async (a: HumoAlert): Promise<void> => {
    try { await hooks.onAlert?.(a); } catch { /* an alert that cannot be delivered must never stop the reader */ }
  };
  let settings: HumoSettings;
  try { settings = await humoSettings(); }
  catch (err) { void alert({ type: 'DOWN', failure: 'config' }); throw err; }

  // Variable specifier: the package is optional at install time and typed above.
  const pkg = 'telegram';
  const gram = await import(pkg) as { TelegramClient: new (session: unknown, apiId: number, apiHash: string, params: Record<string, unknown>) => TgClient };
  const sessions = await import(`${pkg}/sessions/index.js`) as { StringSession: new (s: string) => unknown };
  const events = await import(`${pkg}/events/index.js`) as { NewMessage: new (o: Record<string, unknown>) => unknown };
  const client = new gram.TelegramClient(new sessions.StringSession(settings.session), settings.apiId, settings.apiHash, { connectionRetries: 10, autoReconnect: true });
  client.setLogLevel('error');

  let down = false;
  let failures = 0;
  const failed = (failure: 'auth' | 'bot' | 'network'): void => {
    failures++;
    if (failures >= 3 && !down) { down = true; void alert({ type: 'DOWN', failure }); }
  };
  const succeeded = (): void => {
    failures = 0;
    if (down) { down = false; void alert({ type: 'RECOVERED' }); }
  };

  let botEntity: TgEntity;
  try {
    await client.connect();
    if (!(await client.checkAuthorization())) throw Object.assign(new Error('Telegram session yaroqsiz (akkauntdan chiqarilgan bo‘lishi mumkin).'), { failure: 'auth' });
    botEntity = await client.getEntity(settings.bot);
    if (!botEntity.bot) throw Object.assign(new Error(`@${settings.bot} bot emas: HUMO_TG_BOT ni tekshiring.`), { failure: 'bot' });
  } catch (err) {
    const failure = (err as { failure?: 'auth' | 'bot' }).failure ?? 'network';
    void alert({ type: 'DOWN', failure });
    try { await client.disconnect(); } catch { /* already down */ }
    throw err;
  }
  const botId = botEntity.id.toString();
  const lookbackMs = settings.lookbackSeconds * 1000;

  const handle = async (message: TgMessage): Promise<void> => {
    try {
      const r = await ingestHumoMessage(engine, botId, message, Date.now(), lookbackMs);
      if (r?.result.status === 'MATCHED_UNVERIFIED') { try { await hooks.onMatched?.(); } catch (err) { console.error(`[HUMO] onMatched: ${err instanceof Error ? err.message.slice(0, 120) : 'error'}`); } }
      if (r && r.result.status === 'REVIEW_REQUIRED' && isFreshIncoming(message.date * 1000, Date.now())) {
        void alert({ type: 'REVIEW', reason: r.result.reason ?? 'UNKNOWN', amountTiyin: r.amountTiyin, cardLast4: r.cardLast4 });
      }
    } catch (err) {
      console.error(`[HUMO ERROR] ${err instanceof Error ? err.message.slice(0, 200) : 'error'}`);
    }
  };

  // Live: every incoming message of this account passes through here; anything not from the verified bot is dropped unread (see ingestHumoMessage).
  client.addEventHandler(event => { void handle(event.message); }, new events.NewMessage({ incoming: true }));

  let stopped = false;
  let busy = false;
  const poll = async (): Promise<void> => {
    if (busy || stopped) return;
    busy = true;
    try {
      const recent = await client.getMessages(botEntity, { limit: 30 });
      const fresh = recent.filter(m => !m.out && Date.now() - m.date * 1000 <= lookbackMs);
      const seen = await engine.seenHumo(fresh.map(m => `${botId}:${m.id}`));
      for (const m of fresh.reverse()) if (!stopped && !seen.has(`${botId}:${m.id}`)) await handle(m);
      succeeded();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[HUMO ERROR] ${message.slice(0, 200)}`);
      failed(/AUTH_KEY|SESSION_REVOKED|USER_DEACTIVATED/i.test(message) ? 'auth' : 'network');
    } finally { busy = false; }
  };
  const timer = setInterval(() => void poll(), settings.pollSeconds * 1000);
  void poll();
  console.log(`[HUMO TG ON] @${settings.bot} | har ${settings.pollSeconds}s tekshiriladi | so‘nggi ${Math.round(settings.lookbackSeconds / 60)} daqiqa qayta ko‘riladi`);
  return () => {
    stopped = true;
    clearInterval(timer);
    void client.disconnect().catch(() => undefined);
    console.log('[HUMO TG OFF]');
  };
}
