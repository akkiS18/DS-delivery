import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRestaurantSession } from '../restaurant-auth/routes.js';
import {
  archiveProduct, availabilitySchema, categoryCreateSchema, categoryUpdateSchema, createCategory, createProduct,
  deleteCategory, idSchema, listCategories, listProducts, productCreateSchema, productUpdateSchema, setAvailability,
  updateCategory, updateProduct,
} from './service.js';

type IdParams = { Params: { id: string } };

/** Every handler starts with requireRestaurantSession: the restaurant id comes from the Bearer session only
 *  (bodies are strict, so a client-sent restaurantId is a 400, and query/headers are never consulted for identity). */
export async function restaurantCatalogRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  // ---- products ----
  app.get('/products', async request => {
    const s = await requireRestaurantSession(request);
    const q = z.object({ includeArchived: z.enum(['true', 'false']).optional() }).parse(request.query);
    return { products: await listProducts(s.restaurant.id, q.includeArchived === 'true') };
  });

  app.post('/products', async (request, reply) => {
    const s = await requireRestaurantSession(request);
    const body = productCreateSchema.parse(request.body);
    return reply.code(201).send(await createProduct(s.restaurant.id, s.sessionId, body));
  });

  app.put<IdParams>('/products/:id', async request => {
    const s = await requireRestaurantSession(request);
    return updateProduct(s.restaurant.id, s.sessionId, idSchema.parse(request.params.id), productUpdateSchema.parse(request.body));
  });

  app.patch<IdParams>('/products/:id/availability', async request => {
    const s = await requireRestaurantSession(request);
    const body = availabilitySchema.parse(request.body);
    return setAvailability(s.restaurant.id, s.sessionId, idSchema.parse(request.params.id), body.isAvailable, body.version);
  });

  app.delete<IdParams>('/products/:id', async (request, reply) => {
    const s = await requireRestaurantSession(request);
    await archiveProduct(s.restaurant.id, s.sessionId, idSchema.parse(request.params.id));
    return reply.code(204).send();
  });

  // ---- categories ----
  app.get('/categories', async request => {
    const s = await requireRestaurantSession(request);
    return { categories: await listCategories(s.restaurant.id) };
  });

  app.post('/categories', async (request, reply) => {
    const s = await requireRestaurantSession(request);
    return reply.code(201).send(await createCategory(s.restaurant.id, s.sessionId, categoryCreateSchema.parse(request.body)));
  });

  app.put<IdParams>('/categories/:id', async request => {
    const s = await requireRestaurantSession(request);
    return updateCategory(s.restaurant.id, s.sessionId, idSchema.parse(request.params.id), categoryUpdateSchema.parse(request.body));
  });

  app.delete<IdParams>('/categories/:id', async (request, reply) => {
    const s = await requireRestaurantSession(request);
    const q = z.object({ reassignTo: z.union([z.literal('none'), idSchema]).optional() }).strict().parse(request.query);
    await deleteCategory(s.restaurant.id, s.sessionId, idSchema.parse(request.params.id), q.reassignTo);
    return reply.code(204).send();
  });
}
