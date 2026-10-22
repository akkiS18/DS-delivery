import type { FastifyInstance } from 'fastify';
import { gmailHealth, type GmailStatus } from '../modules/payment/gmail-health.js';

/**
 * Process state shown by /health/ready. Only coarse states: no tokens, no URLs, no database names.
 * `starting` until server.ts has finished launching everything it was configured to launch; `stopping` once shutdown begins.
 */
export type Phase = 'starting' | 'ready' | 'stopping';
export type BotState = 'disabled' | 'polling';
export const runtime: { phase: Phase; customerBot: BotState; taxiBot: BotState } = { phase: 'starting', customerBot: 'disabled', taxiBot: 'disabled' };

export interface HealthDeps {
  /** Resolves when the database answers a trivial query; rejects otherwise. */
  pingDatabase: () => Promise<void>;
  state?: typeof runtime;
  timeoutMs?: number;
  /** Gmail reader state (Stage 8A). Reported only: a Gmail outage does not make the API unready (orders and bots keep working),
   *  but the watchdog alerts on it because customers' payments would stop matching. */
  gmailStatus?: () => GmailStatus;
}

/**
 * /health      legacy liveness (unchanged payload, existing monitors keep working)
 * /health/live liveness: the event loop answers. Never touches the database, so a database blip does not restart the container.
 * /health/ready readiness: 200 only when startup completed AND the database answers within the timeout. 503 otherwise.
 */
export async function healthRoutes(app: FastifyInstance, deps: HealthDeps): Promise<void> {
  const state = deps.state ?? runtime;
  const timeoutMs = deps.timeoutMs ?? 2000;
  app.get('/health/live', async () => ({ ok: true }));
  app.get('/health/ready', async (_req, reply) => {
    let database: 'up' | 'down' = 'down';
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        deps.pingDatabase(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
      ]);
      database = 'up';
    } catch { /* reported as down; the error text may contain connection details, so it is not returned */ }
    finally { clearTimeout(timer); }
    const ok = state.phase === 'ready' && database === 'up';
    return reply.code(ok ? 200 : 503).header('Cache-Control', 'no-store')
      .send({ ok, phase: state.phase, checks: { database, customerBot: state.customerBot, taxiBot: state.taxiBot, gmail: (deps.gmailStatus ?? (() => gmailHealth.status()))() } });
  });
}
