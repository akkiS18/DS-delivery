import Fastify from 'fastify';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { catalogRoutes } from './modules/catalog/routes.js';
import { internalRoutes } from './modules/orders/routes.js';
import type { PaymentEngineV3 } from './modules/payment/engine.js';

export function buildApp(engine: PaymentEngineV3) {
  const app = Fastify({ logger: true, bodyLimit: 32 * 1024 });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Validation failed', details: error.issues });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return reply.code(409).send({ error: 'Record already exists' });
    }
    if (error instanceof Error) {
      if (['RESTORAN_BUYURTMA_QABUL_QILMAYDI', 'MAHSULOT_MAVJUD_EMAS'].includes(error.message)) {
        return reply.code(409).send({ error: error.message });
      }
      if (error.message === 'BUYURTMA_SUMMASI_JUDA_KATTA') {
        return reply.code(400).send({ error: error.message });
      }
      const statusCode = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : undefined;
      if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
        return reply.code(statusCode).send({ error: error.message });
      }
    }
    app.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
  });
  app.get('/health', async () => ({ ok: true, app: 'DS Delivery Backend', version: '0.4.0' }));
  app.register(catalogRoutes, { prefix: '/api/v1' });
  app.register(async internal => { await internalRoutes(internal, engine); }, { prefix: '/api/v1/internal' });
  return app;
}
