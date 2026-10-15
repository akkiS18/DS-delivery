import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { orderSchema, orderDetails, placeOrder, paymentView } from './service.js';
import { requireInternal } from '../../lib/auth.js';
import { db } from '../../lib/db.js';
import type { PaymentEngineV3 } from '../payment/engine.js';

const cardSchema = z.object({ restaurantId: z.string(), last4: z.string().regex(/^\d{4}$/), isTest: z.boolean() });
const restaurantSchema = z.object({ slug: z.string().regex(/^[a-z0-9-]{2,40}$/), name: z.string().trim().min(2).max(100) });
const productSchema = z.object({ name: z.string().trim().min(2).max(100), priceSom: z.number().int().min(100).max(100_000_000), description: z.string().max(1000).optional() });

function moneyFromTiyin(amount: bigint) { return Number(amount / 100n); }

export async function internalRoutes(app: FastifyInstance, engine: PaymentEngineV3): Promise<void> {
  app.addHook('onRequest', async (request) => { requireInternal(request); });

  app.post('/restaurants', async (request, reply) => {
    const payload = restaurantSchema.parse(request.body);
    const result = await db.restaurant.create({ data: payload });
    return reply.code(201).send({ id: result.id, slug: result.slug, name: result.name });
  });

  app.post<{ Params: { restaurantId: string } }>('/restaurants/:restaurantId/products', async (request, reply) => {
    const input = productSchema.parse(request.body);
    const restaurant = await db.restaurant.findUnique({ where: { id: request.params.restaurantId } });
    if (!restaurant) return reply.code(404).send({ error: 'Restaurant not found' });
    const product = await db.product.create({ data: { restaurantId: restaurant.id, ...input } });
    return reply.code(201).send(product);
  });

  app.post('/taxis', async (request, reply) => {
    const input = z.object({ name: z.string().trim().min(2).max(80) }).parse(request.body);
    const taxi = await db.taxiCompany.create({ data: input });
    return reply.code(201).send(taxi);
  });

  app.patch<{ Params: { id: string } }>('/taxis/:id', async (request, reply) => {
    const input = z.object({ isActive: z.boolean() }).parse(request.body);
    const found = await db.taxiCompany.findUnique({ where: { id: request.params.id } });
    if (!found) return reply.code(404).send({ error: 'Taxi not found' });
    return db.taxiCompany.update({ where: { id: found.id }, data: input });
  });

  app.post('/cards', async (request, reply) => {
    const input = cardSchema.parse(request.body);
    const restaurant = await db.restaurant.findUnique({ where: { id: input.restaurantId } });
    if (!restaurant) return reply.code(404).send({ error: 'Restaurant not found' });
    const card = await engine.addCard(input.last4, input.isTest, input.restaurantId);
    return reply.code(201).send({ id: card.id, restaurantId: card.restaurantId, last4: card.last4, isTest: card.isTest });
  });

  app.get('/cards', async () => db.card.findMany({
    select: { id: true, restaurantId: true, last4: true, isTest: true, active: true },
    orderBy: { createdAt: 'asc' },
  }));

  app.post('/orders', async (request, reply) => {
    const input = orderSchema.parse(request.body);
    const order = await placeOrder(engine, input);
    return reply.code(201).send({
      orderId: order?.id, orderNumber: order?.number, status: order?.status,
      totalSom: order?.totalSom, payment: order?.payment,
    });
  });

  app.get<{ Params: { id: string } }>('/orders/:id', async (request, reply) => {
    const order = await orderDetails(request.params.id);
    if (!order) return reply.code(404).send({ error: 'Order not found' });
    return order;
  });

  app.get('/orders', async () => {
    const orders = await db.order.findMany({
      orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, number: true, restaurantId: true, status: true, totalSom: true, createdAt: true, payment: { select: { status: true, card: { select: { last4: true } } } } },
    });
    return orders;
  });

  app.get('/payments/reviews', async () => (await engine.listReviews(50)).map(x => ({
    id: x.id, source: x.source, sourceId: x.sourceId, cardLast4: x.cardLast4,
    amountSom: moneyFromTiyin(x.amountTiyin), status: x.status, reason: x.reason, receivedAt: x.receivedAt,
  })));

  app.post('/payments/mock-incoming', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') return reply.code(404).send({ error: 'Not found' });
    const data = z.object({ amountSom: z.number().int().positive(), last4: z.string().regex(/^\d{4}$/), secondsAgo: z.number().int().min(0).max(86400).default(0) }).parse(request.body);
    const card = await db.card.findUnique({ where: { last4: data.last4 } });
    if (!card?.isTest) return reply.code(400).send({ error: 'Mock incoming only for MOCK cards' });
    const result = await engine.ingestMock(BigInt(data.amountSom) * 100n, data.last4, data.secondsAgo);
    return result;
  });

  app.get('/payments/status', async () => {
    const status = await engine.status();
    return { byStatus: status.byStatus, cards: status.cards.map(c => ({ id: c.id, last4: c.last4, isTest: c.isTest, restaurantId: c.restaurantId })), reviews: status.reviews };
  });
}
