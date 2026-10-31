import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DEFAULT_FEE_CONFIG, feeRuleCode, nextMilestone, priceBasket, publicPricing, referenceUnitPrice, unitPrice, type FeeConfig,
} from './fee.js';

type Fixtures = { tiered: FeeConfig; percent: FeeConfig; cases: Array<{ cfg: 'tiered' | 'percent'; lines: Array<[number, number]>; units: number[]; totalSom: number; feeSom: number }> };
const fx = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8')) as Fixtures;
const TIERED = fx.tiered;

test('hand-checked baskets give the agreed prices (same fixtures run in the customer app)', () => {
  for (const c of fx.cases) {
    const r = priceBasket(c.lines.map(([baseUnitSom, quantity]) => ({ baseUnitSom, quantity })), fx[c.cfg]);
    assert.deepEqual(r.lines.map(l => l.unitSom), c.units, JSON.stringify(c.lines));
    assert.equal(r.totalSom, c.totalSom);
    assert.equal(r.feeSom, c.feeSom);
  }
});

test('the customer app fixture file is identical to the server one', () => {
  const server = readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../../../apps/customer-miniapp/tests/fee-fixtures.json', import.meta.url), 'utf8');
  assert.equal(client.replace(/\r\n/g, '\n'), server.replace(/\r\n/g, '\n'));
});

test('FLAT adds nothing: prices and total stay the restaurant menu prices', () => {
  const r = priceBasket([{ baseUnitSom: 12_345, quantity: 3 }, { baseUnitSom: 999, quantity: 1 }], DEFAULT_FEE_CONFIG);
  assert.deepEqual(r.lines.map(l => l.unitSom), [12_345, 999]);
  assert.equal(r.feeSom, 0);
  assert.equal(r.totalSom, r.baseTotalSom);
  assert.equal(unitPrice(5000, 0, TIERED), 5000);
  assert.equal(feeRuleCode(DEFAULT_FEE_CONFIG), null);
});

test('prices are multiples of 100, never below the restaurant price, and the fee is never negative', () => {
  let seed = 7;
  const rnd = (n: number) => { seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff; return seed % n; };
  for (let i = 0; i < 3000; i += 1) {
    const lines = Array.from({ length: 1 + rnd(8) }, () => ({ baseUnitSom: 100 + rnd(150_000), quantity: 1 + rnd(30) }));
    for (const cfg of [TIERED, fx.percent]) {
      const r = priceBasket(lines, cfg);
      for (const l of r.lines) {
        assert.equal(l.unitSom % 100, 0);
        assert.ok(l.unitSom >= l.baseUnitSom);
        assert.equal(l.subtotalSom, l.unitSom * l.quantity);
      }
      assert.ok(r.feeSom >= 0);
      assert.equal(r.totalSom, r.lines.reduce((s, l) => s + l.subtotalSom, 0));
    }
  }
});

test('growing a single-dish basket never makes it cheaper (60 000 is never dearer than 60 100)', () => {
  let previous = 0;
  for (let b = 100; b <= 400_000; b += 100) {
    const total = priceBasket([{ baseUnitSom: b, quantity: 1 }], TIERED).totalSom;
    assert.ok(total >= previous, `basket ${b}: ${total} < ${previous}`);
    previous = total;
  }
  assert.ok(priceBasket([{ baseUnitSom: 60_000, quantity: 1 }], TIERED).totalSom <= priceBasket([{ baseUnitSom: 60_100, quantity: 1 }], TIERED).totalSom);
});

test('adding one more portion of any dish never lowers the total (realistic menus: dishes from 3 000 so‘m)', () => {
  let seed = 99;
  const rnd = (n: number) => { seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff; return seed % n; };
  let worst = 0;
  for (let i = 0; i < 4000; i += 1) {
    const lines = Array.from({ length: 1 + rnd(6) }, () => ({ baseUnitSom: 3000 + 500 * rnd(160), quantity: 1 + rnd(6) }));
    const before = priceBasket(lines, TIERED).totalSom;
    for (let k = 0; k < lines.length; k += 1) {
      const more = lines.map((l, j) => (j === k ? { ...l, quantity: l.quantity + 1 } : l));
      const after = priceBasket(more, TIERED).totalSom;
      worst = Math.min(worst, after - before);
    }
  }
  assert.ok(worst >= 0, `a portion made the basket ${-worst} so‘m cheaper`);
});

test('a dish gets cheaper as the basket passes the knee, and the reference price is the first-rate price', () => {
  const dish = 10_000;
  assert.equal(referenceUnitPrice(dish, TIERED), 11_000);
  assert.equal(unitPrice(dish, 40_000, TIERED), 11_000);
  assert.equal(unitPrice(dish, 100_000, TIERED), 10_700);
  assert.equal(unitPrice(dish, 200_000, TIERED), 10_500);
  assert.equal(referenceUnitPrice(dish, DEFAULT_FEE_CONFIG), dish);
  assert.equal(referenceUnitPrice(dish, fx.percent), 10_800);
});

test('progress stations and the public config', () => {
  assert.equal(nextMilestone(0, TIERED), 50_000);
  assert.equal(nextMilestone(50_000, TIERED), 100_000);
  assert.equal(nextMilestone(199_999, TIERED), 200_000);
  assert.equal(nextMilestone(200_000, TIERED), null);
  assert.equal(nextMilestone(10_000, fx.percent), null);
  assert.deepEqual(publicPricing(TIERED).milestonesSom, [50_000, 100_000, 200_000]);
  assert.equal(feeRuleCode(TIERED), 'TIERED_50000_1000_300');
  assert.equal(feeRuleCode(fx.percent), 'PERCENT_800');
});

test('LINE: dish prices stay the menu prices, the platform line is added to the total; waived = nothing added; the public config carries the line', () => {
  const line = { ...DEFAULT_FEE_CONFIG, mode: 'LINE' as const, lineSom: 5000, lineWaived: false };
  const r = priceBasket([{ baseUnitSom: 12_345, quantity: 3 }, { baseUnitSom: 999, quantity: 1 }], line);
  assert.deepEqual(r.lines.map(l => l.unitSom), [12_345, 999]);
  assert.equal(r.baseTotalSom, 38_034);
  assert.equal(r.totalSom, 43_034);
  assert.equal(r.feeSom, 5000);
  assert.equal(feeRuleCode(line), 'LINE_5000');
  assert.deepEqual([publicPricing(line).lineSom, publicPricing(line).lineWaived], [5000, false]);

  const waived = { ...line, lineWaived: true };
  const w = priceBasket([{ baseUnitSom: 12_345, quantity: 3 }], waived);
  assert.equal(w.totalSom, 37_035);
  assert.equal(w.feeSom, 0);
  assert.equal(feeRuleCode(waived), 'LINE_FREE_5000');
  assert.equal(publicPricing(waived).lineWaived, true);
  assert.equal('lineSom' in publicPricing(DEFAULT_FEE_CONFIG), false, 'other modes publish no line');
});
