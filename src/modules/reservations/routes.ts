import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRestaurantSession } from '../restaurant-auth/routes.js';
import {
  ReservationError, cancelBodySchema, cancelReservationByRestaurant, confirmReservationPayment, listRestaurantReservations,
  markReservationSeen, reservationSettingsSchema, setReservationSettings,
} from './service.js';

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
type IdParams = { Params: { id: string } };

const fail = (err: unknown): never => {
  if (err instanceof ReservationError) throw Object.assign(new Error(err.message), { statusCode: err.statusCode });
  throw err;
};

/** The restaurant's side of table reservations. The restaurant id comes from the Bearer session only; bodies are strict. */
export async function restaurantReservationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  app.get('/reservations', async request => {
    const s = await requireRestaurantSession(request);
    return listRestaurantReservations(s.restaurant.id);
  });

  // "I have seen it" (silences the new-reservation marker). Another restaurant's id is the same 204 and changes nothing.
  app.post<IdParams>('/reservations/:id/seen', async (request, reply) => {
    const s = await requireRestaurantSession(request);
    await markReservationSeen(s.restaurant.id, idSchema.parse(request.params.id));
    return reply.code(204).send();
  });

  // The deposit arrived but no automatic actor confirmed it (its kill switch is off, or the signal is not one we confirm): the restaurant books the table.
  app.post<IdParams>('/reservations/:id/confirm-payment', async request => {
    const s = await requireRestaurantSession(request);
    z.object({}).strict().parse(request.body ?? {});
    const label = `restaurant-app:${s.sessionId}`;
    let result: Awaited<ReturnType<typeof confirmReservationPayment>>;
    try { result = await confirmReservationPayment(idSchema.parse(request.params.id), { kind: 'STAFF', restaurantId: s.restaurant.id, label }); } catch (err) { return fail(err); }
    if (result === 'NOT_FOUND') throw Object.assign(new Error('NOT_FOUND'), { statusCode: 404 });
    if (result === 'STALE') throw Object.assign(new Error('INVALID_STATE'), { statusCode: 409 });
    return { result };
  });

  app.post<IdParams>('/reservations/:id/cancel', async request => {
    const s = await requireRestaurantSession(request);
    const body = cancelBodySchema.parse(request.body ?? {});
    const result = await cancelReservationByRestaurant(s.restaurant.id, idSchema.parse(request.params.id), body.reason, `restaurant-app:${s.sessionId}`);
    if (result === 'NOT_FOUND') throw Object.assign(new Error('NOT_FOUND'), { statusCode: 404 });
    if (result === 'STALE') throw Object.assign(new Error('INVALID_STATE'), { statusCode: 409 });
    return { result };
  });

  // Settings: on/off and the deposit amount (default 100 000 so'm).
  app.put('/reservations/settings', async request => {
    const s = await requireRestaurantSession(request);
    try { return await setReservationSettings(s.restaurant.id, reservationSettingsSchema.parse(request.body)); } catch (err) { return fail(err); }
  });
}
