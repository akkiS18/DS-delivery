import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRevision, consentTimeoutMs } from './price-consent.js';

test('price consent timeout: default 5 min, bounded, garbage rejected', () => {
  assert.equal(consentTimeoutMs({}), 300_000);
  assert.equal(consentTimeoutMs({ PRICE_CONSENT_SECONDS: '3600' }), 3_600_000);
  for (const bad of ['29', '3601', 'x']) assert.throws(() => consentTimeoutMs({ PRICE_CONSENT_SECONDS: bad }), /PRICE_CONSENT_SECONDS/);
});

test('a revision is built only when the sole problem is a changed price', () => {
  const menu = new Map([
    ['a', { restaurantId: 'r', isAvailable: true, priceSom: 12_000 }],
    ['b', { restaurantId: 'r', isAvailable: true, priceSom: 5_000 }],
    ['c', { restaurantId: 'r', isAvailable: false, priceSom: 5_000 }],
  ]);
  const l = (productId: string, unitSom: number, quantity: number) => ({ productId, name: productId, unitSom, quantity, subtotalSom: unitSom * quantity });
  const ok = buildRevision([l('a', 10_000, 2), l('b', 5_000, 1)], menu, 'r');
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.oldTotal, 25_000);
    assert.equal(ok.newTotal, 29_000);
    assert.equal(ok.lines[0]!.subtotalSom, 24_000);
  }
  assert.equal(buildRevision([l('a', 10_000, 1), l('c', 5_000, 1)], menu, 'r').ok, false); // unavailable item: reject instead
  assert.equal(buildRevision([l('b', 5_000, 1)], menu, 'r').ok, false); // nothing changed: nothing to propose
  assert.equal(buildRevision([l('zzz', 1, 1)], menu, 'r').ok, false);
});
