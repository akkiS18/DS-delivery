import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { setAdminMessenger } from '../modules/admin-auth/messenger.js';
import { attemptKey, requestCode, verifyCode } from '../modules/admin-auth/service.js';

// DS Admin app sign-in (A0). Needs a *_test database (the repo's DB guard). Uses only uniquely named rows and removes only them (AdminAuditEvent is append-only: its rows stay, under unique actor ids).
const db = new PrismaClient();
const app = buildApp(new PaymentEngineV3(db, defaultOptions, () => {}));
const newId = (): string => `9${randomInt(100_000_000, 999_999_999)}${randomInt(100, 999)}`;
const ipSeq = (() => { let n = randomInt(1, 200); const base = randomInt(1, 250); return () => `10.${base}.${n++ % 250}.${randomInt(1, 250)}`; })();

const sent: Array<{ to: string; text: string }> = [];
let failSends = false;
setAdminMessenger(async (to, text) => { if (failSends) throw new Error('telegram down'); sent.push({ to, text }); });
const codeFor = (id: string): string | undefined => {
  const m = [...sent].reverse().find(s => s.to === id && /<code>\d{6}<\/code>/.test(s.text));
  return /<code>(\d{6})<\/code>/.exec(m?.text ?? '')?.[1];
};
const until = async (cond: () => boolean): Promise<void> => { for (let i = 0; i < 100 && !cond(); i++) await new Promise(r => setTimeout(r, 20)); };

const touchedIds = new Set<string>();
const touchedIps = new Set<string>();
const admin = (): string => { const id = newId(); touchedIds.add(id); process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = id; return id; };
const post = (url: string, payload: unknown, ip = ipSeq(), token?: string) => {
  touchedIps.add(ip);
  return app.inject({ method: 'POST', url: `/api/v1/admin${url}`, payload: payload as object, remoteAddress: ip, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) });
};
const get = (url: string, token?: string) => app.inject({ method: 'GET', url: `/api/v1/admin${url}`, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) });
async function signIn(id: string, device = 'Test telefon'): Promise<string> {
  for (let i = sent.length - 1; i >= 0; i--) if (sent[i]!.to === id) sent.splice(i, 1); // never pick up an older code
  assert.equal((await post('/auth/request-code', { telegramUserId: id })).statusCode, 202);
  await until(() => codeFor(id) !== undefined);
  const r = await post('/auth/verify', { telegramUserId: id, code: codeFor(id), deviceName: device });
  assert.equal(r.statusCode, 200);
  return r.json().accessToken as string;
}

const savedEnv = { ...process.env };
before(async () => { await db.$connect(); process.env.ADMIN_APP_ENABLED = 'true'; });
after(async () => {
  const ids = [...touchedIds];
  const keys = [...ids.map(i => attemptKey('tg', i)), ...[...touchedIps].map(i => attemptKey('ip', i))];
  await db.adminAuthAttempt.deleteMany({ where: { keyHash: { in: keys } } });
  await db.adminLoginCode.deleteMany({ where: { telegramUserId: { in: ids } } });
  await db.adminSession.deleteMany({ where: { telegramUserId: { in: ids } } });
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
  setAdminMessenger(null);
  await app.close();
  await db.$disconnect();
});

test('the admin API answers 404 until ADMIN_APP_ENABLED=true', async () => {
  const id = admin();
  process.env.ADMIN_APP_ENABLED = 'false';
  try {
    assert.equal((await post('/auth/request-code', { telegramUserId: id })).statusCode, 404);
    assert.equal((await get('/auth/me')).statusCode, 404);
  } finally { process.env.ADMIN_APP_ENABLED = 'true'; }
  assert.equal(await db.adminLoginCode.count({ where: { telegramUserId: id } }), 0);
});

test('a stranger gets the identical answer, receives nothing, and no code exists', async () => {
  const id = admin();
  const stranger = newId(); touchedIds.add(stranger);
  const a = await post('/auth/request-code', { telegramUserId: id });
  const s = await post('/auth/request-code', { telegramUserId: stranger });
  assert.equal(s.statusCode, a.statusCode);
  assert.deepEqual(s.json(), a.json());
  await until(() => codeFor(id) !== undefined);
  assert.equal(sent.some(m => m.to === stranger), false);
  assert.equal(await db.adminLoginCode.count({ where: { telegramUserId: stranger } }), 0);
  // The real code does not work for the stranger, and any code fails the same way as a wrong one.
  const bad = await post('/auth/verify', { telegramUserId: stranger, code: codeFor(id) });
  assert.equal(bad.statusCode, 401);
  assert.deepEqual(bad.json(), { error: 'INVALID_CODE' });
});

test('malformed bodies are rejected before anything is stored', async () => {
  assert.equal((await post('/auth/request-code', { telegramUserId: 'abc' })).statusCode, 400);
  assert.equal((await post('/auth/request-code', { telegramUserId: '1', extra: 1 })).statusCode, 400);
  assert.equal((await post('/auth/verify', { telegramUserId: '1', code: '12345' })).statusCode, 400);
});

test('sign-in: code works once, session works, notice is sent, audit is written, logout closes it', async () => {
  const id = admin();
  assert.equal((await post('/auth/request-code', { telegramUserId: id })).statusCode, 202);
  await until(() => codeFor(id) !== undefined);
  const code = codeFor(id)!;
  const stored = await db.adminLoginCode.findFirstOrThrow({ where: { telegramUserId: id } });
  assert.ok(!JSON.stringify(stored).includes(code), 'only a hash of the code is stored');

  const wrong = await post('/auth/verify', { telegramUserId: id, code: code === '000000' ? '000001' : '000000' });
  assert.equal(wrong.statusCode, 401);
  const ok = await post('/auth/verify', { telegramUserId: id, code, deviceName: '<b>Samsung</b> A14' });
  assert.equal(ok.statusCode, 200);
  const token = ok.json().accessToken as string;
  assert.equal(ok.headers['cache-control'], 'no-store');
  const again = await post('/auth/verify', { telegramUserId: id, code });
  assert.equal(again.statusCode, 401, 'a used code never works again');

  const me = await get('/auth/me', token);
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().admin.telegramUserId, id);
  assert.equal(me.json().session.deviceName, 'b Samsung /b A14');
  await until(() => sent.some(m => m.to === id && m.text.includes('ilovasiga kirildi')));
  assert.ok(sent.some(m => m.to === id && m.text.includes('/logoutall')));
  assert.equal(await db.adminAuditEvent.count({ where: { actorId: id, action: 'ADMIN_APP_LOGIN' } }), 1);

  assert.equal((await get('/auth/me')).statusCode, 401);
  assert.equal((await get('/auth/me', 'x'.repeat(43))).statusCode, 401);
  assert.equal((await post('/auth/logout', {}, undefined, token)).statusCode, 204);
  assert.equal((await get('/auth/me', token)).statusCode, 401);
  assert.equal(await db.adminAuditEvent.count({ where: { actorId: id, action: 'ADMIN_APP_LOGOUT' } }), 1);
  assert.equal((await post('/auth/logout', {}, undefined, token)).statusCode, 401);
});

test('a code runs out of tries, and a newer code replaces the older one', async () => {
  const id = admin();
  process.env.ADMIN_CODE_MAX_TRIES = '3';
  try {
    await post('/auth/request-code', { telegramUserId: id });
    await until(() => codeFor(id) !== undefined);
    const first = codeFor(id)!;
    const wrong = first === '111111' ? '222222' : '111111';
    for (let i = 0; i < 3; i++) assert.equal((await post('/auth/verify', { telegramUserId: id, code: wrong })).statusCode, 401);
    assert.equal((await post('/auth/verify', { telegramUserId: id, code: first })).statusCode, 401, 'the right code is useless once the tries are spent');

    sent.length = 0;
    await post('/auth/request-code', { telegramUserId: id });
    await until(() => codeFor(id) !== undefined);
    const second = codeFor(id)!;
    sent.length = 0;
    await post('/auth/request-code', { telegramUserId: id });
    await until(() => codeFor(id) !== undefined);
    const third = codeFor(id)!;
    if (second !== third) assert.equal((await post('/auth/verify', { telegramUserId: id, code: second })).statusCode, 401, 'an older code stops working');
    assert.equal((await post('/auth/verify', { telegramUserId: id, code: third })).statusCode, 200);
  } finally { delete process.env.ADMIN_CODE_MAX_TRIES; }
});

test('an expired code is refused', async () => {
  const id = admin();
  const r = await requestCode({ telegramUserId: id, ip: ipSeq() });
  assert.equal(r.result, 'ACCEPTED');
  if (r.result === 'ACCEPTED') await r.delivery;
  const code = codeFor(id)!;
  const late = await verifyCode({ telegramUserId: id, code, ip: ipSeq() }, new Date(Date.now() + 6 * 60_000));
  assert.equal(late.result, 'INVALID');
  const inTime = await verifyCode({ telegramUserId: id, code, ip: ipSeq() }, new Date(Date.now() + 60_000));
  assert.equal(inTime.result, 'OK');
});

test('the same code used in parallel creates exactly one session', async () => {
  const id = admin();
  const r = await requestCode({ telegramUserId: id, ip: ipSeq() });
  if (r.result === 'ACCEPTED') await r.delivery;
  const code = codeFor(id)!;
  const results = await Promise.all(Array.from({ length: 6 }, () => verifyCode({ telegramUserId: id, code, ip: ipSeq() })));
  assert.equal(results.filter(x => x.result === 'OK').length, 1);
  assert.equal(await db.adminSession.count({ where: { telegramUserId: id } }), 1);
  assert.equal(await db.adminAuditEvent.count({ where: { actorId: id, action: 'ADMIN_APP_LOGIN' } }), 1);
});

test('throttling: code requests and wrong guesses lock the same way for admins and strangers', async () => {
  const id = admin();
  const codes = [] as number[];
  for (let i = 0; i < 6; i++) codes.push((await post('/auth/request-code', { telegramUserId: id })).statusCode);
  assert.deepEqual(codes, [202, 202, 202, 202, 202, 429]);
  const stranger = newId(); touchedIds.add(stranger);
  const sc = [] as number[];
  for (let i = 0; i < 6; i++) sc.push((await post('/auth/request-code', { telegramUserId: stranger })).statusCode);
  assert.deepEqual(sc, codes);

  const id2 = admin();
  process.env.ADMIN_VERIFY_MAX_FAILURES = '3';
  try {
    await post('/auth/request-code', { telegramUserId: id2 });
    await until(() => codeFor(id2) !== undefined);
    const real = codeFor(id2)!;
    const wrong = real === '123456' ? '654321' : '123456';
    const out = [] as number[];
    for (let i = 0; i < 3; i++) out.push((await post('/auth/verify', { telegramUserId: id2, code: wrong })).statusCode);
    assert.deepEqual(out, [401, 401, 401]);
    const locked = await post('/auth/verify', { telegramUserId: id2, code: real });
    assert.equal(locked.statusCode, 429, 'even the right code waits once the guess limit is hit');
    assert.ok(Number(locked.headers['retry-after']) > 0);
  } finally { delete process.env.ADMIN_VERIFY_MAX_FAILURES; }
});

test('a failed Telegram send burns the code', async () => {
  const id = admin();
  failSends = true;
  try {
    const r = await requestCode({ telegramUserId: id, ip: ipSeq() });
    assert.equal(r.result, 'ACCEPTED');
    if (r.result === 'ACCEPTED') await r.delivery;
  } finally { failSends = false; }
  const row = await db.adminLoginCode.findFirstOrThrow({ where: { telegramUserId: id } });
  assert.ok(row.usedAt, 'an undelivered code must not stay usable');
});

test('sessions: logout-all closes every phone, the cap closes the oldest, losing admin rights cuts a phone off', async () => {
  const id = admin();
  process.env.ADMIN_CODE_REQUESTS_PER_ID = '50';
  const t1 = await signIn(id, 'A');
  const t2 = await signIn(id, 'B');
  assert.equal((await get('/auth/me', t1)).statusCode, 200);
  assert.equal((await get('/auth/me', t2)).statusCode, 200);
  const all = await post('/auth/logout-all', {}, undefined, t1);
  assert.deepEqual(all.json(), { closed: 2 });
  assert.equal((await get('/auth/me', t1)).statusCode, 401);
  assert.equal((await get('/auth/me', t2)).statusCode, 401);
  assert.equal(await db.adminAuditEvent.count({ where: { actorId: id, action: 'ADMIN_APP_LOGOUT_ALL' } }), 1);

  process.env.ADMIN_MAX_SESSIONS = '2';
  try {
    const a = await signIn(id, 'one'); const b = await signIn(id, 'two'); const c = await signIn(id, 'three');
    assert.equal((await get('/auth/me', a)).statusCode, 401, 'the oldest session is closed by the cap');
    assert.equal((await get('/auth/me', b)).statusCode, 200);
    assert.equal((await get('/auth/me', c)).statusCode, 200);
    // The id is removed from the environment: the phone is cut off at once, no revoke needed.
    process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = newId();
    delete process.env.SUPPORT_ADMIN_2_TELEGRAM_ID;
    assert.equal((await get('/auth/me', c)).statusCode, 401);
    process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = id;
    assert.equal((await get('/auth/me', c)).statusCode, 200);
  } finally { delete process.env.ADMIN_MAX_SESSIONS; }

  // An expired session is refused.
  const oldToken = await signIn(id, 'soon expired');
  await db.adminSession.updateMany({ where: { telegramUserId: id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await get('/auth/me', oldToken)).statusCode, 401);
  const t4 = await signIn(id, 'fresh');
  assert.equal((await get('/auth/me', t4)).statusCode, 200);
  delete process.env.ADMIN_CODE_REQUESTS_PER_ID;
});
