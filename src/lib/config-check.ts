/**
 * Startup configuration validation. Pure (takes an env object, returns a report) so it is unit-tested without starting anything.
 * Errors stop the server before it connects to anything; warnings are logged. Values are never echoed: only variable NAMES appear
 * in messages, so the report is safe to log.
 */
export interface ConfigReport { errors: string[]; warnings: string[] }

const TOKEN = /^\d+:[a-zA-Z0-9_-]{20,}$/;
const PLACEHOLDER = /change[_-]?me|your[_-]?password|replace[_-]?with|example|placeholder|xxxx/i;
const POSITIVE_INTS = ['PAYMENT_WINDOW_SECONDS', 'QUEUE_WINDOW_SECONDS', 'CARD_COOLDOWN_SECONDS', 'AMBIGUITY_WINDOW_SECONDS', 'MAINTENANCE_SECONDS',
  'TAXI_WORKER_INTERVAL_SECONDS', 'TAXI_OPERATOR_RESPONSE_SECONDS', 'SUPPORT_WORKER_INTERVAL_SECONDS'] as const;

const isLoopback = (host: string) => host === '127.0.0.1' || host === 'localhost' || host === '::1';
const flag = (v: string | undefined) => v?.trim().toLowerCase() === 'true';

/** TRUST_PROXY: unset/false = off, true = trust every hop, N = trust N proxy hops. Anything else is a typo and is rejected. */
export function parseTrustProxy(raw: string | undefined): boolean | number | null {
  const v = raw?.trim().toLowerCase();
  if (!v || v === 'false') return false;
  if (v === 'true') return true;
  if (/^\d{1,2}$/.test(v) && Number(v) >= 1) return Number(v);
  return null;
}

export function checkConfig(env: NodeJS.ProcessEnv): ConfigReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const production = env.NODE_ENV === 'production';

  // ---- database
  let dbName = '';
  const dbUrl = env.DATABASE_URL?.trim();
  if (!dbUrl) errors.push('DATABASE_URL is required.');
  else {
    try {
      const u = new URL(dbUrl);
      dbName = u.pathname.replace(/^\//, '');
      if (!['postgres:', 'postgresql:'].includes(u.protocol)) errors.push('DATABASE_URL must be a postgresql:// URL.');
      else if (!dbName) errors.push('DATABASE_URL must name a database.');
      if (production && PLACEHOLDER.test(decodeURIComponent(u.password))) errors.push('DATABASE_URL still contains a placeholder password.');
      if (production && /test/i.test(dbName)) errors.push('NODE_ENV=production must not use a database whose name contains "test".');
    } catch { errors.push('DATABASE_URL is not a valid URL.'); }
  }

  // ---- internal key
  const key = env.INTERNAL_API_KEY ?? '';
  if (key.length < 20) errors.push('INTERNAL_API_KEY must be at least 20 characters.');
  else if (production && (key.length < 32 || PLACEHOLDER.test(key))) errors.push('INTERNAL_API_KEY must be a random value of at least 32 characters in production (not a placeholder).');

  // ---- listener
  const port = Number(env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('PORT must be an integer between 1 and 65535.');
  const host = env.HOST?.trim() || '127.0.0.1';
  const trust = parseTrustProxy(env.TRUST_PROXY);
  if (trust === null) errors.push('TRUST_PROXY must be unset, "true", "false" or a hop count such as "1".');
  if (production && !isLoopback(host) && trust === false) {
    warnings.push('HOST is not loopback but TRUST_PROXY is off: behind a reverse proxy every client will share the proxy IP (rate limits become global). Set TRUST_PROXY=1 when exactly one proxy is in front.');
  }
  if (trust === true) warnings.push('TRUST_PROXY=true trusts X-Forwarded-For from any peer; only use it when the port is reachable solely through your proxy. Prefer a hop count (TRUST_PROXY=1).');

  // ---- intervals
  for (const name of POSITIVE_INTS) {
    const raw = env[name];
    if (raw !== undefined && raw.trim() !== '' && !(Number.isSafeInteger(Number(raw)) && Number(raw) > 0)) errors.push(`${name} must be a positive integer.`);
  }

  // ---- telegram
  const botEnabled = env.BOT_ENABLED === 'true';
  if (env.BOT_ENABLED !== undefined && !['true', 'false'].includes(env.BOT_ENABLED)) errors.push('BOT_ENABLED must be "true" or "false".');
  if (env.GMAIL_ENABLED !== undefined && !['true', 'false'].includes(env.GMAIL_ENABLED)) errors.push('GMAIL_ENABLED must be "true" or "false".');
  const botToken = env.BOT_TOKEN?.trim() ?? '';
  const taxiToken = env.TAXI_BOT_TOKEN?.trim() ?? '';
  if (botEnabled && !TOKEN.test(botToken)) errors.push('BOT_ENABLED=true requires a valid BOT_TOKEN.');
  if (flag(env.MINIAPP_ENABLED) && !TOKEN.test(botToken)) errors.push('MINIAPP_ENABLED=true requires a valid BOT_TOKEN (it verifies Telegram initData signatures).');
  if (taxiToken) {
    if (!TOKEN.test(taxiToken)) errors.push('TAXI_BOT_TOKEN has an invalid format.');
    if (taxiToken === botToken) errors.push('TAXI_BOT_TOKEN must differ from BOT_TOKEN (one token cannot be polled twice).');
    if (!botEnabled) warnings.push('TAXI_BOT_TOKEN is set but BOT_ENABLED is not true: the taxi bot will not start.');
  }
  if (production && !botEnabled) warnings.push('BOT_ENABLED is not true: no Telegram bot, notifications or taxi dispatch worker will run in this process.');

  // ---- payment mode separation
  const mode = env.BOT_PAYMENT_MODE?.trim() || 'MOCK';
  if (!['MOCK', 'REAL'].includes(mode)) errors.push('BOT_PAYMENT_MODE must be "MOCK" or "REAL".');
  if (mode === 'MOCK' && production) {
    errors.push('NODE_ENV=production with BOT_PAYMENT_MODE=MOCK: the backend refuses MOCK orders in production, so every checkout would fail. Use NODE_ENV=staging for MOCK testing, or REAL when approved.');
  }
  if (mode === 'MOCK' && !production && !isLoopback(host)) {
    warnings.push('MOCK payments are enabled and HOST is not loopback: any authenticated Telegram user can mark test orders paid. Fine for a short staging test, never for customers.');
  }
  // Explicit staging: MOCK checkout plus anonymous guest sign-up on a network-reachable host lets anyone who finds the URL create test orders.
  // The app cannot restrict that itself (an APK-embedded secret is no protection), so the operator must confirm an edge gate (proxy IP allowlist, VPN)
  // in front of it by setting STAGING_ACCESS_GATE=edge. Only enforced for NODE_ENV=staging; local development is unaffected.
  if (mode === 'MOCK' && env.NODE_ENV === 'staging' && !isLoopback(host) && flag(env.ANDROID_GUEST_ENABLED) && env.STAGING_ACCESS_GATE !== 'edge') {
    errors.push('NODE_ENV=staging with BOT_PAYMENT_MODE=MOCK and ANDROID_GUEST_ENABLED=true on a non-loopback HOST needs STAGING_ACCESS_GATE=edge, confirming that a reverse-proxy access restriction (IP allowlist or VPN) is in front. Otherwise anyone can create guest sessions and MOCK orders.');
  }
  if (mode === 'REAL') {
    if (env.GMAIL_ENABLED !== 'true') errors.push('BOT_PAYMENT_MODE=REAL requires GMAIL_ENABLED=true (payments are confirmed from the bank e-mail).');
    if (/test/i.test(dbName)) errors.push('BOT_PAYMENT_MODE=REAL is not allowed on a test database.');
    try {
      const cards = JSON.parse(env.BOT_REAL_CARD_NUMBERS_JSON ?? '') as unknown;
      const ok = typeof cards === 'object' && cards !== null && !Array.isArray(cards) && Object.keys(cards).length > 0
        && Object.entries(cards).every(([last4, n]) => /^\d{4}$/.test(last4) && typeof n === 'string' && /^\d{16}$/.test(n) && n.endsWith(last4));
      if (!ok) errors.push('BOT_REAL_CARD_NUMBERS_JSON must map each 4-digit suffix to the matching 16-digit card number.');
    } catch { errors.push('BOT_REAL_CARD_NUMBERS_JSON is required for REAL payments and must be valid JSON.'); }
    if (production && env.CONFIRM_REAL_PAYMENTS !== 'yes') {
      errors.push('REAL payments in production need an explicit CONFIRM_REAL_PAYMENTS=yes. This is a deliberate extra switch so they cannot be enabled by accident.');
    }
  }

  // ---- production hygiene
  if (production && env.MINIAPP_CSP === 'off') warnings.push('MINIAPP_CSP=off disables the Mini App Content-Security-Policy.');
  if (production && env.RESTAURANT_TELEGRAM_ENABLED === 'true') warnings.push('RESTAURANT_TELEGRAM_ENABLED=true re-enables the legacy Telegram restaurant panel.');
  if (production && !(env.TAXI_OPERATOR_ALLOWLIST ?? '').trim()) warnings.push('TAXI_OPERATOR_ALLOWLIST is empty: any linked taxi operator account is accepted.');

  return { errors, warnings };
}
