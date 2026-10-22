import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptanceRequired, responseTimeoutMs, validateSnapshot } from './acceptance.js';

test('Stage 6F: no routine manual acceptance; the legacy waiting flow needs RESTAURANT_MANUAL_ACCEPTANCE=true', () => {
  for (const mode of ['REAL', 'MOCK'] as const) {
    assert.equal(acceptanceRequired(mode, {}), false);
    assert.equal(acceptanceRequired(mode, { RESTAURANT_MANUAL_ACCEPTANCE: 'false' }), false);
    assert.equal(acceptanceRequired(mode, { RESTAURANT_ACCEPTANCE_MOCK: 'true' }), false); // retired flag is ignored
    assert.equal(acceptanceRequired(mode, { RESTAURANT_MANUAL_ACCEPTANCE: 'true' }), true);
  }
});
test('response timeout: default 10 min, bounded 30s..24h, garbage rejected', () => {
  assert.equal(responseTimeoutMs({}), 600_000);
  assert.equal(responseTimeoutMs({ RESTAURANT_RESPONSE_SECONDS: '30' }), 30_000);
  for (const bad of ['29', '86401', 'abc', '1.5', '-5']) {
    assert.throws(() => responseTimeoutMs({ RESTAURANT_RESPONSE_SECONDS: bad }), /RESTAURANT_RESPONSE_SECONDS/);
  }
});
test('snapshot validation: unavailable, repriced, missing and foreign products block acceptance', () => {
  const menu = new Map([
    ['a', { restaurantId: 'r', isAvailable: true, priceSom: 10_000 }],
    ['b', { restaurantId: 'r', isAvailable: false, priceSom: 5_000 }],
    ['c', { restaurantId: 'r', isAvailable: true, priceSom: 9_000 }],
    ['d', { restaurantId: 'other', isAvailable: true, priceSom: 1_000 }],
  ]);
  const line = (productId: string | null, unitSom: number) => ({ productId, name: `p-${productId}`, unitSom });
  assert.deepEqual(validateSnapshot([line('a', 10_000)], menu, 'r'), []);
  assert.deepEqual(validateSnapshot([line('b', 5_000)], menu, 'r').map(p => p.kind), ['UNAVAILABLE']);
  assert.deepEqual(validateSnapshot([line('c', 8_000)], menu, 'r'),
    [{ kind: 'PRICE_CHANGED', name: 'p-c', snapshotSom: 8_000, currentSom: 9_000 }]);
  assert.deepEqual(validateSnapshot([line(null, 1), line('zzz', 1), line('d', 1_000)], menu, 'r').map(p => p.kind),
    ['MISSING', 'MISSING', 'MISSING']);
});
