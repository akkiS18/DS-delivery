import Fastify from 'fastify';
import { Prisma } from '@prisma/client';
import { db } from './lib/db.js';
import { parseTrustProxy } from './lib/config-check.js';
import { healthRoutes } from './lib/health.js';
import { ZodError } from 'zod';
import { catalogRoutes } from './modules/catalog/routes.js';
import { internalRoutes } from './modules/orders/routes.js';
import { CheckoutError } from './modules/orders/service.js';
import { miniAppRoutes } from './modules/miniapp/routes.js';
import { registerMiniAppStatic } from './modules/miniapp/static.js';
import type { PaymentEngineV3 } from './modules/payment/engine.js';
import { restaurantAuthRoutes } from './modules/restaurant-auth/routes.js';
import { restaurantCatalogRoutes } from './modules/restaurant-catalog/routes.js';
import { restaurantOrdersRoutes } from './modules/restaurant-orders/routes.js';
import { restaurantOperationsRoutes } from './modules/restaurant-operations/routes.js';
import { restaurantCardsRoutes } from './modules/restaurant-cards/routes.js';
import { restaurantFinanceRoutes } from './modules/restaurant-finance/routes.js';

/** Fastify's typings take a hop-count only as a function: trust the first N proxies in front of us. */
function trustProxySetting(): boolean | ((address: string, hop: number) => boolean) {
  const t = parseTrustProxy(process.env.TRUST_PROXY);
  return typeof t === 'number' ? (_address, hop) => hop < t : t ?? false;
}

export function buildApp(engine: PaymentEngineV3, deps: { pingDatabase?: () => Promise<void> } = {}) {
  const app = Fastify({ logger: true, bodyLimit: 32 * 1024, trustProxy: trustProxySetting() });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Validation failed', details: error.issues });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return reply.code(409).send({ error: 'Record already exists' });
    }
    if (error instanceof CheckoutError) {
      return reply.code(error.statusCode).send({ error: error.message, ...(error.details ? { details: error.details } : {}) });
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
  app.register(async health => { await healthRoutes(health, { pingDatabase: deps.pingDatabase ?? (async () => { await db.$queryRaw`SELECT 1`; }) }); });
  app.register(catalogRoutes, { prefix: '/api/v1' });
  app.register(restaurantAuthRoutes, { prefix: '/api/v1/restaurant' });
  app.register(restaurantCatalogRoutes, { prefix: '/api/v1/restaurant' });
  app.register(restaurantFinanceRoutes, { prefix: '/api/v1/restaurant' });
  app.register(restaurantOperationsRoutes, { prefix: '/api/v1/restaurant' });
  app.register(restaurantCardsRoutes, { prefix: '/api/v1/restaurant' });
  app.register(async orders => { await restaurantOrdersRoutes(orders, engine); }, { prefix: '/api/v1/restaurant' });
  app.register(async internal => { await internalRoutes(internal, engine); }, { prefix: '/api/v1/internal' });
  // Telegram Mini App (customer). Off unless MINIAPP_ENABLED=true; every route needs verified Telegram initData.
  app.register(async mini => { await miniAppRoutes(mini, engine); }, { prefix: '/api/v1/miniapp' });
  app.register(async scope => { await registerMiniAppStatic(scope); });
  return app;
}
