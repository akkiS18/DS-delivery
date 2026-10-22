import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import { healthRoutes, type Phase } from './health.js';

async function build(phase: Phase, ping: () => Promise<void>, timeoutMs = 50) {
  const app = Fastify();
  await app.register(async a => { await healthRoutes(a, { pingDatabase: ping, state: { phase, customerBot: 'polling', taxiBot: 'disabled' }, timeoutMs }); });
  return app;
}

describe('health routes', () => {
  it('live never touches the database', async () => {
    const app = await build('starting', async () => { throw new Error('db down'); });
    const res = await app.inject('/health/live');
    assert.equal(res.statusCode, 200);
    await app.close();
  });
  it('ready is 200 only when started and the database answers', async () => {
    const app = await build('ready', async () => undefined);
    const res = await app.inject('/health/ready');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true, phase: 'ready', checks: { database: 'up', customerBot: 'polling', taxiBot: 'disabled' } });
    await app.close();
  });
  it('ready is 503 while starting, stopping, or when the database fails or hangs; errors are not leaked', async () => {
    const cases: Array<[Phase, () => Promise<void>]> = [
      ['starting', async () => undefined],
      ['stopping', async () => undefined],
      ['ready', async () => { throw new Error('postgres://user:secret@host/db refused'); }],
      ['ready', () => new Promise<void>(() => undefined)],
    ];
    for (const [phase, ping] of cases) {
      const app = await build(phase, ping);
      const res = await app.inject('/health/ready');
      assert.equal(res.statusCode, 503);
      assert.ok(!res.body.includes('secret'));
      await app.close();
    }
  });
});
