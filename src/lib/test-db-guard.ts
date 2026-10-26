/**
 * Safety net for the test suite. node:test marks every test process (NODE_TEST_CONTEXT); in such a process the database named in
 * DATABASE_URL must be a throw-away one (name ends with `_test`, e.g. ds_delivery_test). A mis-pointed .env then stops the run at import time,
 * before any test can insert or delete a row in a real database. Production and the normal dev server never set NODE_TEST_CONTEXT.
 */
export function databaseName(url: string | undefined): string | null {
  if (!url) return null;
  try { return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) || null; } catch { return null; }
}

export function assertTestDatabase(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.NODE_TEST_CONTEXT) return;
  const name = databaseName(env.DATABASE_URL);
  if (name !== null && !name.endsWith('_test')) {
    throw new Error(`Refusing to run tests: DATABASE_URL points at "${name}", not a *_test database. Fix .env (tests must use ds_delivery_test).`);
  }
}
