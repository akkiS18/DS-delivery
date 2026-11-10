import type { FastifyInstance } from 'fastify';
import { adminAppEnabled } from '../../lib/features.js';
import { requireAdminSession } from '../admin-auth/routes.js';
import { todaySummary } from './service.js';

/** DS Admin app: today's numbers for the home screen. Same switch and sessions as the other admin routes (404 unless ADMIN_APP_ENABLED=true). */
export async function adminTodayRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (_request, reply) => {
    if (!adminAppEnabled()) return reply.code(404).send({ error: 'NOT_FOUND' });
  });
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  app.get('/today', async request => {
    await requireAdminSession(request);
    return todaySummary();
  });
}
