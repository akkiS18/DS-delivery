import assert from 'node:assert/strict';
import test from 'node:test';
import { assertTestDatabase, databaseName } from './test-db-guard.js';

const inTest = (url: string | undefined) => ({ NODE_TEST_CONTEXT: 'child-v8', DATABASE_URL: url }) as NodeJS.ProcessEnv;

test('database name is read from the URL path', () => {
  assert.equal(databaseName('postgresql://u:p@localhost:5432/ds_delivery_test?schema=public'), 'ds_delivery_test');
  assert.equal(databaseName('not a url'), null);
  assert.equal(databaseName(undefined), null);
});

test('a test process refuses a database that is not a *_test one', () => {
  assert.throws(() => assertTestDatabase(inTest('postgresql://u:p@db:5432/ds_prod?schema=public')), /not a \*_test database/);
  assert.throws(() => assertTestDatabase(inTest('postgresql://u:p@db:5432/ds_prod_test_backup')), /ds_prod_test_backup/);
});

test('a test process accepts ds_delivery_test', () => {
  assert.doesNotThrow(() => assertTestDatabase(inTest('postgresql://u:p@localhost:5432/ds_delivery_test?schema=public')));
});

test('outside the test runner (production, dev server) the guard does nothing', () => {
  assert.doesNotThrow(() => assertTestDatabase({ DATABASE_URL: 'postgresql://u:p@db:5432/ds_prod' } as NodeJS.ProcessEnv));
});
