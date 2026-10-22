import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSupportAdmin, supportAdminIds } from './service.js';

test('two admins are read from environment', () => {
  const env = { SUPPORT_ADMIN_1_TELEGRAM_ID: '111', SUPPORT_ADMIN_2_TELEGRAM_ID: ' 222 ' };
  assert.deepEqual(supportAdminIds(env), ['111', '222']);
  assert.equal(isSupportAdmin('222', env), true);
});
test('unknown, empty and look-alike ids are not admins', () => {
  const env = { SUPPORT_ADMIN_1_TELEGRAM_ID: '111', SUPPORT_ADMIN_2_TELEGRAM_ID: '222' };
  for (const id of ['', '333', '1111', '11', ' 111']) assert.equal(isSupportAdmin(id, env), false);
});
test('no configuration means nobody is admin', () => {
  assert.deepEqual(supportAdminIds({}), []);
  assert.equal(isSupportAdmin('111', {}), false);
});
test('duplicate ids collapse and malformed ids are rejected', () => {
  assert.deepEqual(supportAdminIds({ SUPPORT_ADMIN_1_TELEGRAM_ID: '5', SUPPORT_ADMIN_2_TELEGRAM_ID: '5' }), ['5']);
  assert.throws(() => supportAdminIds({ SUPPORT_ADMIN_1_TELEGRAM_ID: '@admin' }));
});

import { MAX_FOLLOWUP, retryDelayMs, validateText } from './conversation.js';

test('retry delay grows exponentially and is capped at one hour', () => {
  assert.equal(retryDelayMs(1), 5_000);
  assert.equal(retryDelayMs(2), 10_000);
  assert.equal(retryDelayMs(4), 40_000);
  assert.equal(retryDelayMs(50), 3_600_000);
  assert.equal(retryDelayMs(0), 5_000);
});
test('follow-up text is trimmed, non-empty and length-limited', () => {
  assert.equal(validateText('  salom  '), 'salom');
  assert.throws(() => validateText('   '), /UZUNLIGI/);
  assert.throws(() => validateText('x'.repeat(MAX_FOLLOWUP + 1)), /UZUNLIGI/);
  assert.equal(validateText('x'.repeat(MAX_FOLLOWUP)).length, MAX_FOLLOWUP);
});
