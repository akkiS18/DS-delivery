import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RateLimiter } from '../../lib/rate-limit.js';
import { requireRestaurantSession } from '../restaurant-auth/routes.js';
import { addCard, cardNumberSchema, cardSelfAddAllowed, holderNameSchema, listCards, setCardActive } from './service.js';

const httpError = (statusCode: number, message: string): Error => Object.assign(new Error(message), { statusCode });
const addSchema = z.object({ number: cardNumberSchema, password: z.string().max(200).optional(), holderName: holderNameSchema.optional() }).strict();
const idSchema = z.object({ id: z.string().min(1).max(40) });

/**
 * Restaurant payee cards. The restaurant id comes from the Bearer session only. Adding a card does not ask for the password again (the owner's
 * decision); a stolen session still cannot redirect customers' money, because a new card needs an administrator's approval before it is used.
 * `password` is accepted and ignored so that apps released before this change keep working.
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
    // RESTAURANT_CARD_SELF_ADD=false: cards are added by an administrator (/restocard). The app shows its "Karta qo'shish" button regardless, so
    // the refusal uses the code whose app text already says "Administrator bilan bog'laning".
    if (!cardSelfAddAllowed()) throw httpError(409, 'CARD_TAKEN');
    // Few attempts: this is a rare action.
    if (!limiter.allow(`cardadd:${s.restaurant.id}`, Number(process.env.CARD_ADD_PER_15MIN ?? 5), 15 * 60_000).allowed) throw httpError(429, 'TOO_MANY_REQUESTS');
    const parsed = addSchema.safeParse(request.body);
    if (!parsed.success) throw httpError(400, 'CARD_NUMBER_INVALID');
    const r = await addCard(s.restaurant.id, parsed.data.number, `restaurant:${s.restaurant.slug}`, process.env, parsed.data.holderName ?? null);
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
