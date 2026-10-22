import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRestaurantSession } from '../restaurant-auth/routes.js';
import { financeCommissions, financeOrders, financeRefunds, financeSummary } from './service.js';

const dateParam = z.string().trim().min(10).max(40);
const range = { from: dateParam.optional(), to: dateParam.optional() };
const page = {
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.coerce.number().int().min(1).max(2_147_483_647).optional(),
};
// Strict: an unknown parameter (including a client-sent restaurantId) is a 400. Identity comes only from the Bearer session.
const summaryQuery = z.object(range).strict();
const ordersQuery = z.object({ ...range, ...page, status: z.enum(['completed', 'cancelled', 'in_progress']).optional() }).strict();
const commissionsQuery = z.object({ ...range, ...page }).strict();
const refundsQuery = z.object({ ...range, ...page, status: z.enum(['REQUESTED', 'APPROVED', 'REJECTED', 'SENT', 'CONFIRMED', 'DISPUTED']).optional() }).strict();

/** Read-only. Every handler starts with requireRestaurantSession and passes ONLY the session's restaurant id to the queries. */
export async function restaurantFinanceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  app.get('/finance/summary', async request => {
    const s = await requireRestaurantSession(request);
    return financeSummary(s.restaurant.id, summaryQuery.parse(request.query));
  });
  app.get('/finance/orders', async request => {
    const s = await requireRestaurantSession(request);
    const q = ordersQuery.parse(request.query);
    return financeOrders(s.restaurant.id, { ...q, bucket: q.status });
  });
  app.get('/finance/commissions', async request => {
    const s = await requireRestaurantSession(request);
    return financeCommissions(s.restaurant.id, commissionsQuery.parse(request.query));
  });
  app.get('/finance/refunds', async request => {
    const s = await requireRestaurantSession(request);
    return financeRefunds(s.restaurant.id, refundsQuery.parse(request.query));
  });
}
