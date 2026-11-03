import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_POOL_CAP_SOM, cardLabelOf, isHumoCard, poolCapSom, preferHumo, rankCards, withinCap } from './pool.js';

test('poolCapSom: unset, blank and invalid values give the safe default; 0 is the only way to switch the cap off', () => {
  assert.equal(poolCapSom({}), DEFAULT_POOL_CAP_SOM);
  assert.equal(poolCapSom({ CARD_TURNOVER_CAP_SOM: '  ' }), DEFAULT_POOL_CAP_SOM);
  assert.equal(poolCapSom({ CARD_TURNOVER_CAP_SOM: 'abc' }), DEFAULT_POOL_CAP_SOM);
  assert.equal(poolCapSom({ CARD_TURNOVER_CAP_SOM: '-5' }), DEFAULT_POOL_CAP_SOM);
  assert.equal(poolCapSom({ CARD_TURNOVER_CAP_SOM: '999999' }), DEFAULT_POOL_CAP_SOM); // below the 1 000 000 floor: a typo must not cap everything
  assert.equal(poolCapSom({ CARD_TURNOVER_CAP_SOM: '99999999999999' }), DEFAULT_POOL_CAP_SOM);
  assert.equal(poolCapSom({ CARD_TURNOVER_CAP_SOM: '45000000' }), 45_000_000);
  assert.equal(poolCapSom({ CARD_TURNOVER_CAP_SOM: '0' }), 0);
});

test('withinCap: the cap is inclusive, 0 means unlimited', () => {
  assert.equal(withinCap(39_000_000, 1_000_000, 40_000_000), true);
  assert.equal(withinCap(39_000_001, 1_000_000, 40_000_000), false);
  assert.equal(withinCap(0, 41_000_000, 40_000_000), false);
  assert.equal(withinCap(900_000_000, 5_000_000, 0), true);
});

test('rankCards: fewest open payments, then lowest turnover, then longest unused, then last4', () => {
  const t = (s: string) => new Date(s);
  const cards = [
    { id: 'a', last4: '1111', lastAssignedAt: t('2026-10-30T10:00:00Z') },
    { id: 'b', last4: '2222', lastAssignedAt: t('2026-10-30T09:00:00Z') },
    { id: 'c', last4: '3333', lastAssignedAt: null },
    { id: 'd', last4: '4444', lastAssignedAt: null },
  ];
  // open payments dominate: c has one open payment, so it goes last even with the lowest turnover
  assert.deepEqual(rankCards(cards, new Map([['c', 1]]), new Map([['a', 5], ['b', 9], ['c', 0], ['d', 7]])).map(c => c.id), ['a', 'd', 'b', 'c']);
  // equal open counts: lowest turnover first
  assert.deepEqual(rankCards(cards, new Map(), new Map([['a', 30], ['b', 10], ['c', 20], ['d', 40]])).map(c => c.id), ['b', 'c', 'a', 'd']);
  // equal turnover: never-assigned first (null = epoch), then older assignment, then last4
  assert.deepEqual(rankCards(cards, new Map(), new Map()).map(c => c.id), ['c', 'd', 'b', 'a']);
  // does not reorder the caller's array
  assert.deepEqual(cards.map(c => c.id), ['a', 'b', 'c', 'd']);
});

test('Humocard first: a Humo card goes before any Uzcard, even one that is busier; with the switch off the old order returns', () => {
  const cards = [
    { id: 'u1', last4: '1111', lastAssignedAt: null, label: 'UZCARD', number: '8600123412341234' },
    { id: 'h1', last4: '2222', lastAssignedAt: null, label: 'HUMO', number: '9860123412341234' },
    { id: 'u2', last4: '3333', lastAssignedAt: null, label: 'UZCARD', number: null },
    { id: 'h2', last4: '4444', lastAssignedAt: null, label: 'UZCARD', number: '9860999999999999' }, // an older row: recognised by its number
  ];
  const busy = new Map([['h1', 3]]);
  assert.deepEqual(rankCards(cards, busy, new Map(), true).map(c => c.id), ['h2', 'h1', 'u1', 'u2'], 'Humo first, then the usual order inside each group');
  assert.deepEqual(rankCards(cards, busy, new Map(), false).map(c => c.id), ['u1', 'u2', 'h2', 'h1'], 'switch off: busier card last');
  assert.equal(preferHumo({}), true);
  assert.equal(preferHumo({ CARD_PREFER_HUMO: ' FALSE ' }), false);
  assert.equal(preferHumo({ CARD_PREFER_HUMO: 'nonsense' }), true);
});

test('cardLabelOf / isHumoCard: 9860 is Humo, everything else Uzcard', () => {
  assert.equal(cardLabelOf('9860123412341234'), 'HUMO');
  assert.equal(cardLabelOf('8600123412341234'), 'UZCARD');
  assert.equal(cardLabelOf(null), 'UZCARD');
  assert.equal(isHumoCard({ label: 'UZCARD', number: null }), false);
  assert.equal(isHumoCard({ label: 'HUMO' }), true);
});
