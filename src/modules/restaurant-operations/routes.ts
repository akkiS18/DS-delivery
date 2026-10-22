import type { FastifyInstance } from 'fastify';
import { requireRestaurantSession } from '../restaurant-auth/routes.js';
import { getOperations, prepSchema, setDefaultPrep, setPaused, setTimezone, setWorkingHours, statusSchema, timezoneSchema, workingHoursSchema } from './service.js';

/** The restaurant id comes from the Bearer session only; bodies are strict so a client-sent restaurantId is a 400. */
export async function restaurantOperationsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  app.get('/operations', async request => {
    const s = await requireRestaurantSession(request);
    return getOperations(s.restaurant.id);
  });

  app.patch('/operations/status', async request => {
    const s = await requireRestaurantSession(request);
    return setPaused(s.restaurant.id, statusSchema.parse(request.body).isPaused);
  });

  app.put('/operations/working-hours', async request => {
    const s = await requireRestaurantSession(request);
    return setWorkingHours(s.restaurant.id, workingHoursSchema.parse(request.body).days);
  });

  // Working hours are evaluated in this IANA zone for new checkouts.
  app.patch('/operations/timezone', async request => {
    const s = await requireRestaurantSession(request);
    return setTimezone(s.restaurant.id, timezoneSchema.parse(request.body).timezone);
  });

  app.patch('/operations/prep-time', async request => {
    const s = await requireRestaurantSession(request);
    return setDefaultPrep(s.restaurant.id, prepSchema.parse(request.body).defaultPrepMinutes);
  });
}
