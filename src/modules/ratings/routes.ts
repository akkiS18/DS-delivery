import type { FastifyInstance } from 'fastify';
import { requireRestaurantSession } from '../restaurant-auth/routes.js';
import { REASON_LABEL, restaurantReport } from './service.js';

/** Read-only. The restaurant sees only its own ratings (identity comes from the Bearer session) and never who gave them. */
export async function restaurantRatingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  app.get('/ratings', async request => {
    const s = await requireRestaurantSession(request);
    const report = await restaurantReport(s.restaurant.id);
    return { ...report, reasonLabels: REASON_LABEL };
  });
}
