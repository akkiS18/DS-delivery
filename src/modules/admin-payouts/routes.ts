import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { adminAppEnabled } from '../../lib/features.js';
import { requireAdminSession } from '../admin-auth/routes.js';
import { MAX_DAYS, isDateKey, payoutDayDetail, payoutReport } from './service.js';

const listQuery = z.object({ days: z.coerce.number().int().min(1).max(MAX_DAYS).default(7) }).strict();
const dayParams = z.object({
  date: z.string().refine(isDateKey),
  restaurantId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
}).strict();

/** DS Admin app, A5a: the daily payout report. Read only: it tells the administrator what to transfer to each restaurant, it never moves money. */
export async function adminPayoutsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (_request, reply) => {
    if (!adminAppEnabled()) return reply.code(404).send({ error: 'NOT_FOUND' });
  });
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  app.get('/payouts', async request => {
    await requireAdminSession(request);
    const q = listQuery.parse(request.query);
    return payoutReport(q.days);
  });

  app.get('/payouts/:date/:restaurantId', async (request, reply) => {
    await requireAdminSession(request);
    const p = dayParams.parse(request.params);
    const d = await payoutDayDetail(p.date, p.restaurantId);
    if (!d) return reply.code(404).send({ error: 'NOT_FOUND' });
    return d;
  });
}
