import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHumoMessage, sampleHumoMessage } from './humo.js';

const OBSERVED = `🎉 To'ldirish
➕ 5.000,00 UZS
📍 PAYME P2P UZCARD NA
💳 HUMOCARD *6062
🕓 15:39 27.10.2026
💰 5.000,00 UZS`;

test('the observed message parses: amount from the plus line, card, Tashkent time', () => {
  const p = parseHumoMessage(OBSERVED)!;
  assert.equal(p.cardLast4, '6062');
  assert.equal(p.amountTiyin, 500_000n);
  assert.equal(p.occurredAt.toISOString(), '2026-10-27T10:39:00.000Z');
  assert.equal(p.operation, 'PAYME P2P UZCARD NA');
  assert.equal(p.minutePrecision, true);
});

test('the balance line is never taken for the amount', () => {
  const p = parseHumoMessage(sampleHumoMessage('6062', 2_100_000n, new Date('2026-10-27T10:39:00Z'), 98_765_400n))!;
  assert.equal(p.amountTiyin, 2_100_000n);
});

test('thousands, decimals and spaces', () => {
  const amount = (s: string) => parseHumoMessage(OBSERVED.replace('5.000,00', s))?.amountTiyin;
  assert.equal(amount('21.000,00'), 2_100_000n);
  assert.equal(amount('1.234.567,50'), 123_456_750n);
  assert.equal(amount('150,5'), 15_050n);
  assert.equal(amount('300'), 30_000n);
  assert.equal(amount('21 000,00'), 2_100_000n);
});

test('anything that is not an unambiguous credit is refused', () => {
  const swap = (a: string, b: string) => parseHumoMessage(OBSERVED.replace(a, b));
  assert.equal(swap('➕', '➖'), null, 'a debit');
  assert.equal(parseHumoMessage(OBSERVED.replace('➕ 5.000,00 UZS', '➕ 5.000,00 UZS\n➖ 1.000,00 UZS')), null, 'mixed');
  assert.equal(swap('5.000,00 UZS\n📍', '0,00 UZS\n📍'), null, 'zero');
  assert.equal(swap('➕ 5.000,00 UZS', '➕ 5,000.00 UZS'), null, 'other number style is not guessed');
  assert.equal(swap('➕ 5.000,00 UZS', '➕ 5.00 UZS'), null);
  assert.equal(swap('➕ 5.000,00 UZS', '➕ 5.000,00 USD'), null, 'other currency');
  assert.equal(swap('*6062', '*60'), null, 'card digits');
  assert.equal(swap('15:39 27.10.2026', '25:39 27.10.2026'), null, 'impossible hour');
  assert.equal(swap('15:39 27.10.2026', '15:39 31.02.2026'), null, 'impossible date');
  assert.equal(swap('🕓', '⏰'), null, 'no time');
  assert.equal(parseHumoMessage('Salom! Bu oddiy xabar'), null);
  assert.equal(parseHumoMessage(''), null);
});

test('sampleHumoMessage round-trips', () => {
  const at = new Date('2026-01-02T03:04:00Z');
  const p = parseHumoMessage(sampleHumoMessage('1234', 12_345_600n, at))!;
  assert.equal(p.cardLast4, '1234');
  assert.equal(p.amountTiyin, 12_345_600n);
  assert.equal(p.occurredAt.getTime(), at.getTime());
});
