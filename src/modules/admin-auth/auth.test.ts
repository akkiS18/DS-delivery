import assert from 'node:assert/strict';
import test from 'node:test';
import { adminAuthConfig, attemptKey, bearerToken, cleanDeviceName, generateCode, hashCode, hashToken, isThrottled } from './service.js';
import { adminAppEnabled } from '../../lib/features.js';

test('adminAppEnabled: off unless exactly "true"', () => {
  assert.equal(adminAppEnabled({}), false);
  assert.equal(adminAppEnabled({ ADMIN_APP_ENABLED: '' }), false);
  assert.equal(adminAppEnabled({ ADMIN_APP_ENABLED: 'yes' }), false);
  assert.equal(adminAppEnabled({ ADMIN_APP_ENABLED: ' TRUE ' }), true);
});

test('adminAuthConfig: safe defaults, out-of-range values are refused', () => {
  const c = adminAuthConfig({});
  assert.equal(c.codeMs, 5 * 60_000);
  assert.equal(c.codeMaxTries, 5);
  assert.equal(c.maxSessions, 5);
  assert.equal(c.sessionMs, 90 * 86_400_000);
  assert.throws(() => adminAuthConfig({ ADMIN_CODE_MINUTES: '0' }));
  assert.throws(() => adminAuthConfig({ ADMIN_CODE_MAX_TRIES: 'x' }));
  assert.throws(() => adminAuthConfig({ ADMIN_SESSION_DAYS: '9999' }));
});

test('generateCode: always six digits, leading zeros kept', () => {
  for (let i = 0; i < 500; i++) assert.match(generateCode(), /^\d{6}$/);
});

test('hashes: deterministic, bound to the admin id / purpose, never the plain value', () => {
  assert.equal(hashCode('1', '123456'), hashCode('1', '123456'));
  assert.notEqual(hashCode('1', '123456'), hashCode('2', '123456'));
  assert.notEqual(hashCode('1', '123456'), hashCode('1', '123457'));
  assert.ok(!hashCode('1', '123456').includes('123456'));
  assert.notEqual(hashToken('abc'), attemptKey('tg', 'abc'));
  assert.notEqual(attemptKey('tg', '1'), attemptKey('ip', '1'));
});

test('bearerToken: only a well-formed 43-char token', () => {
  const t = 'A'.repeat(43);
  assert.equal(bearerToken(`Bearer ${t}`), t);
  assert.equal(bearerToken(`bearer ${t}`), undefined);
  assert.equal(bearerToken(`Bearer ${t}x`), undefined);
  assert.equal(bearerToken(undefined), undefined);
  assert.equal(bearerToken(['Bearer ' + t]), undefined);
});

test('isThrottled: counts include the current attempt, either key can lock', () => {
  assert.equal(isThrottled(5, 1, { id: 5, ip: 20 }), false);
  assert.equal(isThrottled(6, 1, { id: 5, ip: 20 }), true);
  assert.equal(isThrottled(1, 21, { id: 5, ip: 20 }), true);
});

test('cleanDeviceName: control characters and markup are removed, length is capped, blank becomes null', () => {
  assert.equal(cleanDeviceName('  Samsung   A14 '), 'Samsung A14');
  assert.equal(cleanDeviceName('<b>x</b>&\n\u0000y'), 'b x /b y');
  assert.equal(cleanDeviceName('a'.repeat(200))!.length, 60);
  assert.equal(cleanDeviceName('   '), null);
  assert.equal(cleanDeviceName(42), null);
});
