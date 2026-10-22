import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import test from 'node:test';

// Stage 7C-QA, Phase 7: the COMPILED server (dist/src/server.js) as a real process. No database is contacted successfully and no Telegram
// token is passed. Run `npm run build` first; without dist the tests are reported as skipped, not passed.
const entry = path.resolve(process.cwd(), 'dist', 'src', 'server.js');
const skip = existsSync(entry) ? false : 'dist/ not built (npm run build)';
const SECRET_PW = 'Sup3rSecretPw-QA-7c';
const baseEnv = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', HOST: '127.0.0.1', NODE_ENV: 'staging', BOT_ENABLED: 'false', GMAIL_ENABLED: 'false',
  INTERNAL_API_KEY: 'qa-internal-key-' + 'x'.repeat(30) };

function run(env: Record<string, string>, ms: number) {
  const child = spawn(process.execPath, [entry], { env: { ...baseEnv, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), ms);
  return once(child, 'exit').then(([code, signal]) => { clearTimeout(timer); return { code: code as number | null, signal: signal as string | null, out }; });
}

test('database unreachable at start: exits non-zero promptly, never listens, never prints the password', { skip }, async () => {
  const started = Date.now();
  const r = await run({ DATABASE_URL: `postgresql://ds:${SECRET_PW}@127.0.0.1:1/ds_delivery_test?schema=public&connect_timeout=3`, PORT: '4021' }, 40_000);
  assert.equal(r.signal, null, 'exited by itself, was not killed by the watchdog');
  assert.equal(r.code, 1);
  assert.ok(Date.now() - started < 35_000);
  assert.ok(!r.out.includes(SECRET_PW), 'password must not appear in logs');
  assert.ok(!/listening at/i.test(r.out), 'must not start serving without a database');
});

test('unsafe production configuration is refused before anything connects, without echoing values', { skip }, async () => {
  const r = await run({ DATABASE_URL: `postgresql://ds:${SECRET_PW}@127.0.0.1:1/ds_delivery?schema=public`, PORT: '4022', NODE_ENV: 'production', INTERNAL_API_KEY: 'short' }, 20_000);
  assert.equal(r.code, 1);
  assert.match(r.out, /INTERNAL_API_KEY/);
  assert.match(r.out, /BOT_PAYMENT_MODE=MOCK/);
  assert.ok(!r.out.includes(SECRET_PW));
  assert.ok(!/Prisma|connect/i.test(r.out.replace(/DATABASE_URL/g, '')), 'failed before touching the database');
});

test('REAL payments cannot be enabled by accident: test database, missing Gmail and missing confirmation are all refused', { skip }, async () => {
  const r = await run({ DATABASE_URL: 'postgresql://ds:pw12345678@127.0.0.1:1/ds_delivery_test', PORT: '4023', BOT_PAYMENT_MODE: 'REAL' }, 20_000);
  assert.equal(r.code, 1);
  assert.match(r.out, /GMAIL_ENABLED=true/);
  assert.match(r.out, /test database/);
  assert.match(r.out, /BOT_REAL_CARD_NUMBERS_JSON/);
});
