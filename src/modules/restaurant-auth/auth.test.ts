import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPasswordPolicy, hashPassword, verifyPassword } from './password.js';
import { attemptKey, authConfig, bearerToken, hashToken, isThrottled } from './service.js';

test('password hashing: Argon2id PHC string, salted, verifies only the right password', async () => {
  const pw = 'correct horse battery staple';
  const [a, b] = await Promise.all([hashPassword(pw), hashPassword(pw)]);
  assert.match(a, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
  assert.notEqual(a, b); // random salt
  assert.ok(!a.includes(pw));
  assert.equal(await verifyPassword(pw, a), true);
  assert.equal(await verifyPassword(pw, b), true);
  assert.equal(await verifyPassword(pw + 'x', a), false);
  assert.equal(await verifyPassword('', a), false);
});

test('malformed, foreign or over-expensive stored hashes fail closed without work', async () => {
  for (const bad of ['', 'plaintext', '$argon2i$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA',
    '$argon2id$v=19$m=99999999,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA',
    '$argon2id$v=19$m=19456,t=99,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA',
    '$argon2id$v=19$m=19456,t=2,p=1$YQ$aGFzaGhhc2hoYXNoaGFzaA']) {
    assert.equal(await verifyPassword('anything-long-enough', bad), false, bad);
  }
});

test('provisioning policy: length, variety and no slug inside the password', () => {
  assert.doesNotThrow(() => assertPasswordPolicy('Tr0ub4dor&3-long', 'pizza'));
  assert.throws(() => assertPasswordPolicy('short', 'pizza'), /PAROL_UZUNLIGI/);
  assert.throws(() => assertPasswordPolicy('x'.repeat(201), 'pizza'), /PAROL_UZUNLIGI/);
  assert.throws(() => assertPasswordPolicy('aaaaaaaaaaaaaaaa', 'pizza'), /PAROL_OSON/);
  assert.throws(() => assertPasswordPolicy('my-PIZZA-password-1', 'pizza'), /PAROL_OSON/);
});

test('bearer header parsing accepts exactly one well-formed token', () => {
  const t = 'A'.repeat(43);
  assert.equal(bearerToken(`Bearer ${t}`), t);
  for (const bad of [undefined, '', t, `bearer ${t}`, `Bearer ${t} `, `Bearer ${t}x`, `Bearer ${'A'.repeat(42)}`, `Basic ${t}`, `Bearer ${t}, Bearer ${t}`, 5, ['x']]) {
    assert.equal(bearerToken(bad), undefined, String(bad));
  }
});

test('stored identifiers are hashes: tokens and attempt keys are not reversible plaintext', () => {
  const t = 'B'.repeat(43);
  assert.match(hashToken(t), /^[0-9a-f]{64}$/);
  assert.notEqual(hashToken(t), t);
  assert.notEqual(attemptKey('slug', 'a'), attemptKey('ip', 'a'));
  assert.equal(attemptKey('ip', '1.2.3.4'), attemptKey('ip', '1.2.3.4'));
});

test('throttle decision: the (max+1)-th failure is blocked, per slug and per IP', () => {
  const cfg = { maxFailures: 5, ipMaxFailures: 30 };
  assert.equal(isThrottled(5, 5, cfg), false);
  assert.equal(isThrottled(6, 1, cfg), true);
  assert.equal(isThrottled(1, 30, cfg), false);
  assert.equal(isThrottled(1, 31, cfg), true);
});

test('auth configuration has safe defaults and rejects nonsense', () => {
  const d = authConfig({});
  assert.deepEqual([d.sessionMs, d.maxSessions, d.maxFailures, d.ipMaxFailures, d.windowMs], [12 * 3_600_000, 10, 5, 30, 15 * 60_000]);
  for (const [k, v] of [['RESTAURANT_SESSION_HOURS', '0'], ['RESTAURANT_SESSION_HOURS', '721'], ['RESTAURANT_MAX_SESSIONS', 'x'],
    ['RESTAURANT_LOGIN_MAX_FAILURES', '0'], ['RESTAURANT_LOGIN_WINDOW_MINUTES', '1.5']] as const) {
    assert.throws(() => authConfig({ [k]: v }), new RegExp(k));
  }
});
