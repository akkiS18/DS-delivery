import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createShutdown } from './shutdown.js';

describe('createShutdown', () => {
  it('runs steps in order and only once, even when called twice', async () => {
    const order: string[] = [];
    const sd = createShutdown(() => [{ name: 'a', run: () => { order.push('a'); } }, { name: 'b', run: async () => { await new Promise(r => setTimeout(r, 5)); order.push('b'); } }]);
    const [r1, r2] = await Promise.all([sd('SIGTERM'), sd('SIGTERM')]);
    assert.deepEqual(order, ['a', 'b']);
    assert.equal(r1, r2);
    assert.deepEqual(r1, { timedOut: false, failed: [] });
  });
  it('keeps going after a failing step and reports it', async () => {
    const order: string[] = [];
    const sd = createShutdown(() => [{ name: 'bad', run: () => { throw new Error('x'); } }, { name: 'db', run: () => { order.push('db'); } }]);
    const r = await sd('t');
    assert.deepEqual(order, ['db']);
    assert.deepEqual(r.failed, ['bad']);
  });
  it('gives up after the timeout instead of hanging', async () => {
    const sd = createShutdown(() => [{ name: 'stuck', run: () => new Promise<void>(() => undefined) }], { timeoutMs: 30 });
    const t = Date.now();
    const r = await sd('t');
    assert.equal(r.timedOut, true);
    assert.ok(Date.now() - t < 1000);
  });
});
