import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkConfig, parseTrustProxy } from './config-check.js';

const KEY = 'k'.repeat(40);
const TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const base = { DATABASE_URL: 'postgresql://u:pw@db:5432/ds_delivery?schema=public', INTERNAL_API_KEY: KEY };
const errs = (env: Record<string, string>) => checkConfig({ ...env } as NodeJS.ProcessEnv).errors;
const has = (list: string[], text: string) => list.some(e => e.includes(text));

describe('checkConfig', () => {
  it('accepts a minimal local development config', () => {
    assert.deepEqual(checkConfig({ ...base } as NodeJS.ProcessEnv).errors, []);
  });
  it('rejects missing/invalid database and weak key', () => {
    assert.ok(has(errs({ INTERNAL_API_KEY: KEY }), 'DATABASE_URL is required'));
    assert.ok(has(errs({ ...base, DATABASE_URL: 'mysql://x/y' }), 'postgresql://'));
    assert.ok(has(errs({ ...base, DATABASE_URL: 'not a url' }), 'not a valid URL'));
    assert.ok(has(errs({ ...base, INTERNAL_API_KEY: 'short' }), 'INTERNAL_API_KEY'));
  });
  it('production refuses placeholders, test databases and MOCK payments', () => {
    const prod = { ...base, NODE_ENV: 'production', BOT_PAYMENT_MODE: 'REAL' };
    assert.ok(has(errs({ ...prod, INTERNAL_API_KEY: 'CHANGE_ME_TO_LONG_RANDOM_VALUE_123456789' }), 'placeholder'));
    assert.ok(has(errs({ ...prod, DATABASE_URL: 'postgresql://u:YOUR_PASSWORD@db/ds' }), 'placeholder password'));
    assert.ok(has(errs({ ...prod, DATABASE_URL: 'postgresql://u:pw@db/ds_delivery_test' }), '"test"'));
    assert.ok(has(errs({ ...base, NODE_ENV: 'production' }), 'MOCK'));
  });
  it('staging with MOCK is allowed', () => {
    assert.deepEqual(errs({ ...base, NODE_ENV: 'staging', BOT_PAYMENT_MODE: 'MOCK' }), []);
  });
  it('staging MOCK with open guest sign-up on a reachable host needs an explicit edge-gate confirmation', () => {
    const open = { ...base, NODE_ENV: 'staging', BOT_PAYMENT_MODE: 'MOCK', ANDROID_GUEST_ENABLED: 'true', HOST: '0.0.0.0' };
    assert.ok(has(errs(open), 'STAGING_ACCESS_GATE=edge'));
    assert.deepEqual(errs({ ...open, STAGING_ACCESS_GATE: 'edge' }), []);
    assert.ok(has(errs({ ...open, STAGING_ACCESS_GATE: 'yes' }), 'STAGING_ACCESS_GATE=edge'));
    // not enforced where it does not apply: loopback host, guest sign-up off, or a non-staging environment (local development)
    assert.deepEqual(errs({ ...open, HOST: '127.0.0.1' }), []);
    assert.deepEqual(errs({ ...open, ANDROID_GUEST_ENABLED: 'false' }), []);
    assert.deepEqual(errs({ ...open, NODE_ENV: 'development' }), []);
    assert.ok(!JSON.stringify(checkConfig({ ...open, INTERNAL_API_KEY: 'x'.repeat(30) + 'SECRET' } as NodeJS.ProcessEnv)).includes('SECRET'));
  });
  it('REAL payments need gmail, cards, a non-test database and an explicit production confirmation', () => {
    const real = { ...base, BOT_PAYMENT_MODE: 'REAL' };
    const e = errs(real);
    assert.ok(has(e, 'GMAIL_ENABLED=true'));
    assert.ok(!has(e, 'BOT_REAL_CARD_NUMBERS_JSON'), 'cards come from the restaurant app now; the JSON is only a legacy fallback');
    const okReal = { ...real, GMAIL_ENABLED: 'true' };
    assert.deepEqual(errs(okReal), []);
    assert.deepEqual(errs({ ...okReal, BOT_REAL_CARD_NUMBERS_JSON: '{"8167":"8600123456788167"}' }), []);
    assert.ok(has(errs({ ...okReal, BOT_REAL_CARD_NUMBERS_JSON: '{"1111":"8600123456788167"}' }), 'BOT_REAL_CARD_NUMBERS_JSON'));
    assert.ok(has(errs({ ...okReal, BOT_REAL_CARD_NUMBERS_JSON: 'not json' }), 'BOT_REAL_CARD_NUMBERS_JSON'));
    assert.ok(has(errs({ ...okReal, DATABASE_URL: 'postgresql://u:pw@db/ds_delivery_test' }), 'test database'));
    assert.ok(has(errs({ ...okReal, NODE_ENV: 'production' }), 'CONFIRM_REAL_PAYMENTS'));
    assert.deepEqual(errs({ ...okReal, NODE_ENV: 'production', CONFIRM_REAL_PAYMENTS: 'yes', INTERNAL_API_KEY: 'r4nd0m'.repeat(8) }), []);
  });
  it('validates telegram tokens and never reuses one for both bots', () => {
    assert.ok(has(errs({ ...base, BOT_ENABLED: 'true' }), 'BOT_TOKEN'));
    assert.ok(has(errs({ ...base, MINIAPP_ENABLED: 'true' }), 'BOT_TOKEN'));
    assert.ok(has(errs({ ...base, BOT_ENABLED: 'true', BOT_TOKEN: TOKEN, TAXI_BOT_TOKEN: TOKEN }), 'must differ'));
    assert.deepEqual(errs({ ...base, BOT_ENABLED: 'true', BOT_TOKEN: TOKEN }), []);
  });
  it('error text never contains secret values', () => {
    const r = checkConfig({ ...base, BOT_ENABLED: 'true', BOT_TOKEN: 'bad-token-SECRET', TAXI_BOT_TOKEN: 'taxi-SECRET', INTERNAL_API_KEY: 'short-SECRET' } as NodeJS.ProcessEnv);
    assert.ok(r.errors.length > 0);
    assert.ok(!JSON.stringify(r).includes('SECRET'));
  });
  it('validates numeric intervals and PORT', () => {
    assert.ok(has(errs({ ...base, MAINTENANCE_SECONDS: '0' }), 'MAINTENANCE_SECONDS'));
    assert.ok(has(errs({ ...base, PORT: '70000' }), 'PORT'));
  });
});

describe('parseTrustProxy', () => {
  it('parses off / on / hop count and rejects typos', () => {
    assert.equal(parseTrustProxy(undefined), false);
    assert.equal(parseTrustProxy('false'), false);
    assert.equal(parseTrustProxy('TRUE'), true);
    assert.equal(parseTrustProxy('1'), 1);
    assert.equal(parseTrustProxy('yes'), null);
    assert.equal(parseTrustProxy('0'), null);
  });
});
