// Production-build smoke test. Run: npm run build && node --env-file=.env scripts/smoke-prod.mjs
// Starts dist/src/server.js on a spare port with Telegram, Gmail and Mini App OFF (no polling, no bot tokens passed), against the
// database named in DATABASE_URL, which MUST be ds_delivery_test (override the name with SMOKE_DB_NAME for a throw-away CI database).
// It only calls GET endpoints and writes nothing to the database.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL missing (run with node --env-file=.env).'); process.exit(2); }
const dbName = new URL(url).pathname.replace(/^\//, '');
const allowed = process.env.SMOKE_DB_NAME ?? 'ds_delivery_test';
if (dbName !== allowed) { console.error(`Refusing: database is "${dbName}", expected "${allowed}".`); process.exit(2); }

const entry = fileURLToPath(new URL('../dist/src/server.js', import.meta.url));
const PORT = process.env.SMOKE_PORT ?? '4010';
const KEY = 'smoke-' + 'x'.repeat(40);
const baseEnv = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', DATABASE_URL: url, INTERNAL_API_KEY: KEY, HOST: '127.0.0.1', PORT, NODE_ENV: 'staging', BOT_ENABLED: 'false', GMAIL_ENABLED: 'false' };

let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };

function start(env) {
  const child = spawn(process.execPath, [entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  return { child, output: () => out };
}

async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const r = await fn(); if (r) return r; } catch { /* retry */ } await new Promise(r => setTimeout(r, 250)); }
  return null;
}

// 1. unsafe configuration must fail fast, before listening
{
  const bad = start({ ...baseEnv, BOT_ENABLED: 'true' });
  const [code] = await once(bad.child, 'exit');
  check('unsafe config (BOT_ENABLED without token) exits non-zero before listening', code === 1 && /BOT_TOKEN/.test(bad.output()) && !bad.output().includes('listening'), `exit ${code}`);
}

// 2. normal start
const { child, output } = start(baseEnv);
const base = `http://127.0.0.1:${PORT}`;
const ready = await waitFor(async () => { const r = await fetch(`${base}/health/ready`); return r.status === 200 ? r : null; }, 30000);
check('GET /health/ready becomes 200', Boolean(ready));
if (ready) {
  const body = await ready.json();
  check('ready reports database up and bots disabled', body.checks?.database === 'up' && body.checks.customerBot === 'disabled', JSON.stringify(body));
  check('GET /health/live is 200', (await fetch(`${base}/health/live`)).status === 200);
  check('legacy GET /health unchanged', (await (await fetch(`${base}/health`)).json()).ok === true);
  check('internal API rejects requests without the key', [401, 403, 404].includes((await fetch(`${base}/api/v1/internal/orders`)).status));
  { const s = (await fetch(`${base}/api/v1/miniapp/config`)).status; check('Mini App API refuses unauthenticated calls', [401, 404].includes(s), String(s)); }
}
check('logs contain no secrets', !output().includes(KEY) && !output().includes(new URL(url).password || '\u0000'));

// 3. graceful shutdown (POSIX only: Windows cannot deliver SIGTERM to a child, it would just kill it)
if (process.platform === 'win32') {
  console.log('SKIP  graceful shutdown via SIGTERM (not testable on Windows; covered by src/lib/shutdown.test.ts, run it in Docker/Linux)');
  child.kill();
} else {
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
  const [code, signal] = await once(child, 'exit');
  clearTimeout(timer);
  check('SIGTERM exits cleanly with code 0', code === 0 && !signal, `code ${code} signal ${signal}`);
}
process.exitCode = failures ? 1 : 0;
