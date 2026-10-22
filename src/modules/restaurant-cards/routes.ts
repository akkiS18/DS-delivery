import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import { requireRestaurantSession } from '../restaurant-auth/routes.js';
import { verifyPassword } from '../restaurant-auth/password.js';
import { addCard, cardNumberSchema, listCards, setCardActive } from './service.js';

const httpError = (statusCode: number, message: string): Error => Object.assign(new Error(message), { statusCode });
const addSchema = z.object({ number: cardNumberSchema, password: z.string().min(1).max(200) }).strict();
const idSchema = z.object({ id: z.string().min(1).max(40) });

/**
 * Restaurant payee cards. The restaurant id comes from the Bearer session only. Adding a card re-asks for the password (a stolen
 * session alone cannot redirect customers' money) and still needs an administrator's approval before the card can be used.
 */
export async function restaurantCardsRoutes(app: FastifyInstance, options: { limiter?: RateLimiter } = {}): Promise<void> {
  const limiter = options.limiter ?? new RateLimiter();
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  app.get('/cards', async request => {
    const s = await requireRestaurantSession(request);
    return { cards: await listCards(s.restaurant.id) };
  });

  app.post('/cards', async (request, reply) => {
    const s = await requireRestaurantSession(request);
    // Few attempts: this is a rare action, and it re-checks the password.
    if (!limiter.allow(`cardadd:${s.restaurant.id}`, Number(process.env.CARD_ADD_PER_15MIN ?? 5), 15 * 60_000).allowed) throw httpError(429, 'TOO_MANY_REQUESTS');
    const parsed = addSchema.safeParse(request.body);
    if (!parsed.success) throw httpError(400, 'CARD_NUMBER_INVALID');
    const credential = await db.restaurantCredential.findUnique({ where: { restaurantId: s.restaurant.id } });
    // 403 (not 401): a wrong confirmation password must not make the app drop the session.
    if (!credential || !(await verifyPassword(parsed.data.password, credential.passwordHash))) throw httpError(403, 'PASSWORD_INVALID');
    const r = await addCard(s.restaurant.id, parsed.data.number, `restaurant:${s.restaurant.slug}`);
    if (!r.ok) throw httpError(409, r.code);
    return reply.code(201).send({ card: r.card });
  });

  for (const [path, active] of [['disable', false], ['enable', true]] as const) {
    app.post(`/cards/:id/${path}`, async request => {
      const s = await requireRestaurantSession(request);
      if (!limiter.allow(`cardtoggle:${s.restaurant.id}`, 30, 15 * 60_000).allowed) throw httpError(429, 'TOO_MANY_REQUESTS');
      const { id } = idSchema.parse(request.params);
      const r = await setCardActive(s.restaurant.id, id, active, `restaurant:${s.restaurant.slug}`);
      if (!r.ok) throw httpError(r.code === 'NOT_FOUND' ? 404 : 409, r.code);
      return { card: r.card };
    });
  }
}
