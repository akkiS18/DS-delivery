import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { containersFor, freeUnits, headlineSize, packagingUnits, type PackSize, type PromoDef, type PromoLine } from './rules.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8')) as Array<{ name: string; promos: PromoDef[]; lines: PromoLine[]; free: Record<string, number> }>;

for (const f of fixtures) {
  test(`1+1: ${f.name}`, () => {
    assert.deepEqual(Object.fromEntries(freeUnits(f.lines, f.promos)), f.free);
  });
}

test('packaging: one unit per dish unit, shared packaging is summed, dishes without packaging add nothing', () => {
  const m = packagingUnits([{ quantity: 2, packagingProductId: 'box' }, { quantity: 3, packagingProductId: 'box' }, { quantity: 4, packagingProductId: null }]);
  assert.deepEqual(Object.fromEntries(m), { box: 5 });
});

const packFixtures = JSON.parse(readFileSync(new URL('./packaging-fixtures.json', import.meta.url), 'utf8')) as Array<{ name: string; portions: number; sizes: PackSize[]; units: Record<string, number> }>;
for (const f of packFixtures) {
  test(`packaging sizes: ${f.name}`, () => {
    assert.deepEqual(Object.fromEntries([...containersFor(f.portions, f.sizes)].sort()), Object.fromEntries(Object.entries(f.units).sort()));
  });
}

test('packaging sizes, Bobosher (3 = 5 000, 6 = 10 000): the cost is ceil(n / 3) x 5 000 and the containers hold every osh, for 1..60 osh', () => {
  const sizes: PackSize[] = [{ id: 'small', capacity: 3, priceSom: 5000 }, { id: 'big', capacity: 6, priceSom: 10_000 }];
  for (let n = 1; n <= 60; n++) {
    const u = containersFor(n, sizes);
    const small = u.get('small') ?? 0;
    const big = u.get('big') ?? 0;
    assert.equal(small * 5000 + big * 10_000, Math.ceil(n / 3) * 5000, `cost for ${n}`);
    assert.ok(small * 3 + big * 6 >= n, `room for ${n}`);
    assert.ok(small <= 1, `at most one small container for ${n}`);
    assert.equal(big, Math.floor(n / 6) + (n % 6 >= 4 ? 1 : 0), `big containers for ${n}`);
  }
});

test('packaging units with sizes: dishes sharing a base are summed, a base without sizes keeps one per unit, an empty size list adds nothing', () => {
  const sizes = new Map<string, PackSize[]>([
    ['oshBox', [{ id: 'oshBox', capacity: 3, priceSom: 5000 }, { id: 'oshBig', capacity: 6, priceSom: 10_000 }]],
    ['off', []],
  ]);
  const m = packagingUnits([
    { quantity: 3, packagingProductId: 'oshBox' }, { quantity: 2, packagingProductId: 'oshBox' }, // 5 osh -> one big
    { quantity: 2, packagingProductId: 'cup' }, // no sizes known -> one per unit
    { quantity: 4, packagingProductId: 'off' }, // nothing on sale
    { quantity: 9, packagingProductId: null },
  ], sizes);
  assert.deepEqual(Object.fromEntries(m), { oshBig: 1, cup: 2 });
});

test('packaging headline: the base while on sale, else the smallest size on sale', () => {
  const small = { id: 'small', capacity: 3, priceSom: 5000 };
  const big = { id: 'big', capacity: 6, priceSom: 10_000 };
  assert.equal(headlineSize('small', [big, small]), small);
  assert.equal(headlineSize('small', [big]), big);
  assert.equal(headlineSize('small', []), null);
});
