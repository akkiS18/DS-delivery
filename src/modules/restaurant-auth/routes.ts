import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate, bearerToken, login, logout, type PublicRestaurant } from './service.js';

const loginSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  password: z.string().min(1).max(200),
}).strict();

type Session = { sessionId: string; expiresAt: Date; restaurant: PublicRestaurant };

function httpError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}

/** Preflight for every protected restaurant route. The restaurant identity returned here is the ONLY one routes may
 *  use: request bodies, query strings and headers never choose a restaurant. */
export async function requireRestaurantSession(request: FastifyRequest): Promise<Session> {
  const auth = await authenticate(bearerToken(request.headers.authorization));
  if (auth.ok) return auth;
  throw httpError(auth.reason === 'RESTAURANT_INACTIVE' ? 403 : 401, auth.reason);
}

const iso = (d: Date): string => d.toISOString();

export async function restaurantAuthRoutes(app: FastifyInstance): Promise<void> {
  // Tokens and credentials must never be cached by proxies or logged.
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  app.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const r = await login({ slug: body.slug, password: body.password, ip: request.ip });
    if (r.result === 'OK') {
      return reply.send({
        accessToken: r.token, tokenType: 'Bearer', expiresAt: iso(r.expiresAt),
        restaurant: r.restaurant,
      });
    }
    if (r.result === 'LOCKED') {
      return reply.code(429).header('Retry-After', String(r.retryAfterSeconds))
        .send({ error: 'TOO_MANY_ATTEMPTS', retryAfterSeconds: r.retryAfterSeconds });
    }
    if (r.result === 'INACTIVE') return reply.code(403).send({ error: 'RESTAURANT_INACTIVE' });
    return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
  });

  app.post('/auth/logout', async (request, reply) => {
    const session = await requireRestaurantSession(request);
    await logout(session.sessionId);
    return reply.code(204).send();
  });

  app.get('/auth/me', async request => {
    const session = await requireRestaurantSession(request);
    return { restaurant: session.restaurant, session: { expiresAt: iso(session.expiresAt) } };
  });

  // Order list/detail and the order actions live in modules/restaurant-orders.
}
