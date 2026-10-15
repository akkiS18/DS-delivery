import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutSummary, normalizeUzPhone } from './checkout.js';

test('O‘zbekiston telefon raqami normalizatsiyasi', () => {
  assert.equal(normalizeUzPhone('90 123 45 67'), '+998901234567');
  assert.equal(normalizeUzPhone('998901234567'), '+998901234567');
  assert.equal(normalizeUzPhone('+998 (90) 123-45-67'), '+998901234567');
});
test('noto‘g‘ri telefon rad etiladi', () => {
  assert.equal(normalizeUzPhone('901234'), null);
  assert.equal(normalizeUzPhone('+79201234567'), null);
  assert.equal(normalizeUzPhone('hello'), null);
});
test('checkout tasdig‘i mock rejimni ochiq belgilaydi', () => {
  const s = checkoutSummary({ restaurant: '<TEST>', phone: '+998901234567', address: 'Uy 3', taxi: 'Sinov', amountSom: 21000, mock: true });
  assert.match(s, /SINOV REJIMI/);
  assert.match(s, /&lt;TEST&gt;/);
  assert.match(s, /Taksi tarifi/);
});
