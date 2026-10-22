import assert from 'node:assert/strict';
import test from 'node:test';
import { availabilitySchema, categoryCreateSchema, categoryUpdateSchema, idSchema, productCreateSchema, productUpdateSchema } from './service.js';

test('product price must be an integer so\'m between 100 and 100,000,000', () => {
  const ok = { name: 'Burger', priceSom: 21_000 };
  assert.ok(productCreateSchema.safeParse(ok).success);
  for (const priceSom of [0, 99, -5, 21_000.5, 100_000_001, '21000', null, NaN, Infinity]) {
    assert.equal(productCreateSchema.safeParse({ ...ok, priceSom }).success, false, String(priceSom));
  }
  assert.ok(productCreateSchema.safeParse({ ...ok, priceSom: 100 }).success);
  assert.ok(productCreateSchema.safeParse({ ...ok, priceSom: 100_000_000 }).success);
});

test('names and descriptions are trimmed and bounded', () => {
  assert.equal(productCreateSchema.parse({ name: '  Burger  ', priceSom: 1000 }).name, 'Burger');
  for (const name of ['', ' ', 'a', ' a ', 'x'.repeat(101)]) assert.equal(productCreateSchema.safeParse({ name, priceSom: 1000 }).success, false, name);
  assert.equal(productCreateSchema.safeParse({ name: 'Burger', priceSom: 1000, description: 'x'.repeat(1001) }).success, false);
  assert.ok(productCreateSchema.safeParse({ name: 'Burger', priceSom: 1000, description: null }).success);
  assert.equal(categoryCreateSchema.safeParse({ name: 'x'.repeat(61) }).success, false);
  assert.ok(categoryCreateSchema.safeParse({ name: 'A' }).success);
});

test('client-controlled identity and unsupported fields are rejected (strict bodies)', () => {
  const base = { name: 'Burger', priceSom: 1000 };
  for (const extra of [{ restaurantId: 'r1' }, { imageUrl: 'https://evil.example/x.png' }, { archivedAt: '2020-01-01' }, { id: 'x' }, { version: 3 }]) {
    assert.equal(productCreateSchema.safeParse({ ...base, ...extra }).success, false, JSON.stringify(extra));
  }
  assert.equal(availabilitySchema.safeParse({ isAvailable: true, restaurantId: 'r1' }).success, false);
  assert.equal(categoryCreateSchema.safeParse({ name: 'A', restaurantId: 'r1' }).success, false);
});

test('updates require the version; positions and versions are bounded integers', () => {
  const full = { name: 'Burger', description: null, priceSom: 1000, categoryId: null, version: 0 };
  assert.ok(productUpdateSchema.safeParse(full).success);
  const { version: _v, ...noVersion } = full;
  assert.equal(productUpdateSchema.safeParse(noVersion).success, false);
  assert.equal(productUpdateSchema.safeParse({ ...full, version: -1 }).success, false);
  assert.equal(productUpdateSchema.safeParse({ ...full, categoryId: '../etc/passwd' }).success, false);
  assert.ok(categoryUpdateSchema.safeParse({ name: 'A', position: 10_000, version: 1 }).success);
  for (const position of [-1, 10_001, 1.5, '1']) assert.equal(categoryUpdateSchema.safeParse({ name: 'A', position, version: 1 }).success, false);
  assert.equal(availabilitySchema.safeParse({}).success, false);
  assert.equal(availabilitySchema.safeParse({ isAvailable: 'yes' }).success, false);
});

test('path ids accept only a safe character set', () => {
  assert.ok(idSchema.safeParse('ckx0abc_-9').success);
  for (const bad of ['', 'a/b', '..', 'a b', 'a'.repeat(65), 'x;drop', '%00']) assert.equal(idSchema.safeParse(bad).success, false, bad);
});

test('product update contract: description and categoryId keys must be present (explicit null is valid, omitted is not)', () => {
  const base = { name: 'Burger', priceSom: 1000, version: 2 };
  assert.ok(productUpdateSchema.safeParse({ ...base, description: null, categoryId: null }).success);
  assert.equal(productUpdateSchema.safeParse(base).success, false); // what a null-omitting client (Gson default) sends
  assert.equal(productUpdateSchema.safeParse({ ...base, description: null }).success, false);
  assert.equal(productUpdateSchema.safeParse({ ...base, categoryId: null }).success, false);
});
