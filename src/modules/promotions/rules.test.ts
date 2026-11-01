import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { freeUnits, packagingUnits, type PromoDef, type PromoLine } from './rules.js';

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
