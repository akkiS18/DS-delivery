// Stage 7C-B1: PostgreSQL deployment validation. Run:  npm run build && node --env-file=.env scripts/validate-postgres.mjs
// SAFE BY CONSTRUCTION
//  * The source database MUST be ds_delivery_test; it is only READ (pg_dump). It is never written, reset or truncated.
//  * Everything else happens in NEW throw-away databases named ds_b1_<nonce>_*. Only those names are ever dropped, and only if this run created them.
//  * Passwords travel in PGPASSWORD / the child environment and are never printed.
// It checks: (1) `prisma migrate deploy` on an EMPTY database (what a fresh server does), (2) pg_dump -> pg_restore into a NEW database with
// per-table row-count comparison, (3) the compiled server against the restored copy, (4) readiness/liveness while the database becomes
// unreachable and again after it returns. It does NOT restart the PostgreSQL service and does NOT need Docker.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = process.env.DATABASE_URL;
if (!src) { console.error('DATABASE_URL missing (run with node --env-file=.env).'); process.exit(2); }
const u = new URL(src);
const sourceDb = u.pathname.replace(/^\//, '');
if (sourceDb !== 'ds_delivery_test') { console.error(`Refusing: source database is "${sourceDb}", expected ds_delivery_test.`); process.exit(2); }
const PGBIN = process.env.PGBIN ?? [ 'C:\\Program Files\\PostgreSQL\\18\\bin', '/usr/bin' ].find(d => existsSync(path.join(d, process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump'))) ?? '';
const exe = n => path.join(PGBIN, process.platform === 'win32' ? `${n}.exe` : n);
if (!PGBIN) { console.error('pg_dump not found (set PGBIN).'); process.exit(2); }
const nonce = randomBytes(3).toString('hex');
const names = { migrate: `ds_b1_${nonce}_migrate`, restore: `ds_b1_${nonce}_restore` };
const created = [];
const pgEnv = { ...process.env, PGPASSWORD: decodeURIComponent(u.password), PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username) };
const urlFor = db => { const x = new URL(src); x.pathname = `/${db}`; return x.toString(); };
const tmp = mkdtempSync(path.join(tmpdir(), 'ds-b1-'));
const dump = path.join(tmp, 'source.dump');

let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` (${extra})` : ''}`); if (!ok) failures++; };
const run = (cmd, args, env = pgEnv, cwd = root) => spawnSync(cmd, args, { env, cwd, encoding: 'utf8' });
const psql = (db, sql) => run(exe('psql'), ['-X', '-q', '-t', '-A', '-d', db, '-c', sql]);
const owned = db => created.includes(db) && /^ds_b1_[0-9a-f]{6}_(migrate|restore)$/.test(db);
function dropOwned(db) { // refuses anything this run did not create
  if (!owned(db)) throw new Error(`refusing to drop "${db}"`);
  psql('postgres', `select pg_terminate_backend(pid) from pg_stat_activity where datname='${db}' and pid<>pg_backend_pid()`);
  return run(exe('dropdb'), ['--if-exists', db]);
}
async function counts(dbUrl) {
  const c = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    const tables = await c.$queryRaw`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1`;
    const out = {};
    for (const { table_name } of tables) out[table_name] = Number((await c.$queryRawUnsafe(`select count(*)::int as n from "${table_name}"`))[0].n);
    return out;
  } finally { await c.$disconnect(); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function http(url) { try { const r = await fetch(url, { signal: AbortSignal.timeout(4000) }); return { status: r.status, body: await r.json().catch(() => null) }; } catch { return { status: 0, body: null }; } }

try {
  const ver = psql('postgres', 'show server_version').stdout.trim();
  console.log(`server_version=${ver}  pg_dump=${run(exe('pg_dump'), ['--version']).stdout.trim()}`);
  check('connect to the PostgreSQL server', Boolean(ver));

  // (1) migrate deploy on an EMPTY database
  created.push(names.migrate);
  check('create empty database for migration test', run(exe('createdb'), [names.migrate]).status === 0, names.migrate);
  const prisma = path.join(root, 'node_modules', 'prisma', 'build', 'index.js');
  const mEnv = { ...pgEnv, DATABASE_URL: urlFor(names.migrate) };
  const dep = run(process.execPath, [prisma, 'migrate', 'deploy'], mEnv);
  const onDisk = readdirSync(path.join(root, 'prisma', 'migrations'), { withFileTypes: true }).filter(e => e.isDirectory()).length;
  const found = Number(/(\d+) migrations? found/.exec(dep.stdout)?.[1] ?? -1);
  const tracked = Number(psql(names.migrate, "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null").stdout.trim());
  check('prisma migrate deploy applies every migration to an empty database', dep.status === 0 && found === onDisk && tracked === onDisk, `${onDisk} on disk, ${found} found, ${tracked} recorded as applied`);
  const st = run(process.execPath, [prisma, 'migrate', 'status'], mEnv);
  check('migrate status: database schema is up to date', st.status === 0 && /up to date/i.test(st.stdout), '');
  const again = run(process.execPath, [prisma, 'migrate', 'deploy'], mEnv);
  check('second migrate deploy is a no-op (idempotent)', again.status === 0 && /No pending migrations/i.test(again.stdout));
  const fresh = await counts(urlFor(names.migrate));
  check('fresh database has the schema and no data', Object.keys(fresh).length > 20 && Object.entries(fresh).every(([t, n]) => t === '_prisma_migrations' || n === 0), `${Object.keys(fresh).length} tables`);

  // (2) backup + restore into a NEW database
  const before = await counts(src);
  const d = run(exe('pg_dump'), ['-Fc', '--no-owner', '--no-privileges', '-f', dump, '-d', sourceDb]);
  check('pg_dump -Fc of ds_delivery_test (read-only)', d.status === 0 && existsSync(dump), existsSync(dump) ? `${(statSync(dump).size / 1024).toFixed(0)} KiB` : d.stderr.slice(0, 200));
  const listing = run(exe('pg_restore'), ['--list', dump]);
  check('dump is a readable archive', listing.status === 0 && /TABLE DATA/.test(listing.stdout));
  created.push(names.restore);
  check('create NEW database for restore', run(exe('createdb'), [names.restore]).status === 0, names.restore);
  const r = run(exe('pg_restore'), ['--no-owner', '--no-privileges', '--exit-on-error', '-d', names.restore, dump]);
  check('pg_restore into the new database', r.status === 0, r.status === 0 ? '' : r.stderr.slice(0, 300));
  const after = await counts(src);
  const restored = await counts(urlFor(names.restore));
  const stable = JSON.stringify(before) === JSON.stringify(after); // the dev server may write between the two reads
  const diffs = Object.keys(before).filter(t => before[t] !== restored[t]);
  const diffsAfter = Object.keys(after).filter(t => after[t] !== restored[t]);
  check('restored row counts equal the source for every table', diffs.length === 0 || diffsAfter.length === 0,
    `${Object.keys(restored).length} tables, ${Object.values(restored).reduce((a, b) => a + b, 0)} rows, source ${stable ? 'stable' : 'changed during the run'}${diffs.length && diffsAfter.length ? `, differing: ${diffs.join(',')}` : ''}`);
  const rs = run(process.execPath, [prisma, 'migrate', 'status'], { ...pgEnv, DATABASE_URL: urlFor(names.restore) });
  check('restored database passes migrate status', rs.status === 0 && /up to date/i.test(rs.stdout));
  const constraints = q => psql(q, "select count(*) from pg_constraint where connamespace='public'::regnamespace").stdout.trim();
  check('constraints and indexes survived the restore', constraints(sourceDb) === constraints(names.restore), `${constraints(names.restore)} constraints`);
  const idx = q => psql(q, "select count(*) from pg_indexes where schemaname='public'").stdout.trim();
  check('index count equal (incl. partial unique indexes)', idx(sourceDb) === idx(names.restore), idx(names.restore));

  // (3)+(4) compiled server against the restored copy, then outage and recovery
  const entry = path.join(root, 'dist', 'src', 'server.js');
  if (!existsSync(entry)) { console.log('SKIP  compiled server checks (run npm run build first)'); }
  else {
    const PORT = process.env.VALIDATE_PORT ?? '4031';
    const child = spawn(process.execPath, [entry], { stdio: ['ignore', 'pipe', 'pipe'], env: {
      PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', DATABASE_URL: urlFor(names.restore), INTERNAL_API_KEY: 'b1-' + 'x'.repeat(40),
      HOST: '127.0.0.1', PORT, NODE_ENV: 'staging', BOT_ENABLED: 'false', GMAIL_ENABLED: 'false' } });
    let log = ''; child.stdout.on('data', x => { log += x; }); child.stderr.on('data', x => { log += x; });
    const base = `http://127.0.0.1:${PORT}`;
    let ready = { status: 0 };
    for (let i = 0; i < 80 && ready.status !== 200; i++) { await sleep(250); ready = await http(`${base}/health/ready`); }
    check('compiled server starts on the restored database; /health/ready 200', ready.status === 200 && ready.body?.checks?.database === 'up');
    // block new connections and kill existing ones: the database is "down" for the app, the PostgreSQL service stays up
    psql('postgres', `alter database ${names.restore} with allow_connections false`);
    psql('postgres', `select pg_terminate_backend(pid) from pg_stat_activity where datname='${names.restore}'`);
    let down = { status: 200 };
    for (let i = 0; i < 12 && down.status !== 503; i++) { await sleep(500); down = await http(`${base}/health/ready`); }
    const live = await http(`${base}/health/live`);
    check('database unreachable: /health/ready 503 (database down), no secrets in body', down.status === 503 && down.body?.checks?.database === 'down' && !JSON.stringify(down.body).includes(decodeURIComponent(u.password)));
    check('database unreachable: /health/live stays 200 (process is not restarted for a DB blip)', live.status === 200);
    psql('postgres', `alter database ${names.restore} with allow_connections true`);
    let back = { status: 0 };
    for (let i = 0; i < 40 && back.status !== 200; i++) { await sleep(500); back = await http(`${base}/health/ready`); }
    check('database returns: /health/ready recovers to 200 without restarting the server', back.status === 200, child.exitCode === null ? 'process kept running' : `process exited ${child.exitCode}`);
    check('server logs contain no database password', !log.includes(decodeURIComponent(u.password) || '\u0000'));
    if (process.platform === 'win32') { console.log('SKIP  SIGTERM graceful shutdown (Windows cannot deliver SIGTERM to a child; needs Linux)'); child.kill(); }
    else {
      child.kill('SIGTERM');
      const code = await new Promise(res => { const t = setTimeout(() => { child.kill('SIGKILL'); res('killed'); }, 20000); child.on('exit', c => { clearTimeout(t); res(c); }); });
      check('SIGTERM exits cleanly with code 0 within 20 s', code === 0, String(code));
    }
    await sleep(500);
  }
} catch (err) {
  console.error('FAIL  unexpected error:', err instanceof Error ? err.message : err);
  failures++;
} finally {
  for (const db of [...created]) { const x = dropOwned(db); console.log(`${x.status === 0 ? 'clean' : 'WARN '} dropped ${db}`); }
  rmSync(tmp, { recursive: true, force: true });
  const left = psql('postgres', "select datname from pg_database where datname like 'ds_b1_%'").stdout.trim();
  console.log(left ? `NOTE  leftover ds_b1_* databases (from earlier aborted runs?): ${left.replace(/\n/g, ', ')}` : 'clean no ds_b1_* databases remain');
}
process.exitCode = failures ? 1 : 0;
