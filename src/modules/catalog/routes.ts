import type { FastifyInstance } from 'fastify';
import { db } from '../../lib/db.js';
export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  app.get('/taxis', async () => db.taxiCompany.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }));
  app.get('/restaurants', async () => {
    return db.restaurant.findMany({
      where: { isActive: true }, select: { id: true, slug: true, name: true, isPaused: true }, orderBy: { name: 'asc' },
    });
  });
  app.get<{ Params: { slug: string } }>('/restaurants/:slug/menu', async (request, reply) => {
    const restaurant = await db.restaurant.findUnique({
      where: { slug: request.params.slug },
      include: { products: { where: { isAvailable: true }, select: { id: true, name: true, description: true, priceSom: true, imageUrl: true, categoryId: true } }, categories: { orderBy: { position: 'asc' }, select: { id: true, name: true, position: true } } },
    });
    if (!restaurant?.isActive) return reply.code(404).send({ error: 'Restaurant not found' });
    return { id: restaurant.id, slug: restaurant.slug, name: restaurant.name, isPaused: restaurant.isPaused, categories: restaurant.categories, products: restaurant.products };
  });
}
