import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRestaurantSession } from '../restaurant-auth/routes.js';
import { RECEIPT_TYPES } from '../refunds/receipts.js';
import { PRODUCT_IMAGE_MAX_BYTES, deleteCategoryImage, deleteProductImage, setCategoryImage, setProductImage } from './images.js';
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

  // The dish photo is the raw request body (image/jpeg|png|webp, <= 4 MB; the app shrinks it first). The type is decided from the file's magic bytes.
  // Authentication runs BEFORE the body is read, so an anonymous caller cannot make the server buffer 4 MB.
  app.addContentTypeParser([...RECEIPT_TYPES], { parseAs: 'buffer', bodyLimit: PRODUCT_IMAGE_MAX_BYTES }, (_request, body, done) => done(null, body));
  app.put<IdParams>('/products/:id/image', {
    bodyLimit: PRODUCT_IMAGE_MAX_BYTES,
    onRequest: async request => { await requireRestaurantSession(request); },
  }, async request => {
    const s = await requireRestaurantSession(request);
    return setProductImage(s.restaurant.id, s.sessionId, idSchema.parse(request.params.id), request.body as Buffer);
  });

  app.delete<IdParams>('/products/:id/image', async (request, reply) => {
    const s = await requireRestaurantSession(request);
    await deleteProductImage(s.restaurant.id, s.sessionId, idSchema.parse(request.params.id));
    return reply.code(204).send();
  });

  app.delete<IdParams>('/products/:id', async (request, reply) => {
    const s = await requireRestaurantSession(request);
    await archiveProduct(s.restaurant.id, s.sessionId, idSchema.parse(request.params.id));
    return reply.code(204).send();
  });

  // ---- categories ----
  // The category photo: same raw-body rules as the dish photo (the content-type parser above covers this route too).
  app.put<IdParams>('/categories/:id/image', {
    bodyLimit: PRODUCT_IMAGE_MAX_BYTES,
    onRequest: async request => { await requireRestaurantSession(request); },
  }, async request => {
    const s = await requireRestaurantSession(request);
    return setCategoryImage(s.restaurant.id, s.sessionId, idSchema.parse(request.params.id), request.body as Buffer);
  });

  app.delete<IdParams>('/categories/:id/image', async (request, reply) => {
    const s = await requireRestaurantSession(request);
    await deleteCategoryImage(s.restaurant.id, s.sessionId, idSchema.parse(request.params.id));
    return reply.code(204).send();
  });

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
