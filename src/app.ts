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
import { taxiAppRoutes } from './modules/taxi-app/routes.js';
import { restaurantCatalogRoutes } from './modules/restaurant-catalog/routes.js';
import { restaurantOrdersRoutes } from './modules/restaurant-orders/routes.js';
import { restaurantOperationsRoutes } from './modules/restaurant-operations/routes.js';
import { restaurantReservationRoutes } from './modules/reservations/routes.js';
import { restaurantCardsRoutes } from './modules/restaurant-cards/routes.js';
import { legalRoutes } from './modules/legal/routes.js';
import { restaurantFinanceRoutes } from './modules/restaurant-finance/routes.js';
import { restaurantRatingsRoutes } from './modules/ratings/routes.js';
import { adminAuthRoutes } from './modules/admin-auth/routes.js';
import { adminAttentionRoutes } from './modules/admin-attention/routes.js';
import { adminMoneyRoutes } from './modules/admin-money/routes.js';
import { adminPlatformRoutes } from './modules/admin-platform/routes.js';
import { adminProvisionRoutes } from './modules/admin-platform/provision-routes.js';
import { adminSupportRoutes } from './modules/admin-support/routes.js';
import { adminTaxiRoutes } from './modules/admin-taxi/routes.js';
import { adminRefundsRoutes } from './modules/admin-refunds/routes.js';
import { adminPayoutsRoutes } from './modules/admin-payouts/routes.js';

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
  app.register(taxiAppRoutes, { prefix: '/api/v1/taxi' }); // DS Taxi app: operators sign in per company
  app.register(restaurantCatalogRoutes, { prefix: '/api/v1/restaurant' });
  app.register(restaurantFinanceRoutes, { prefix: '/api/v1/restaurant' });
  app.register(restaurantRatingsRoutes, { prefix: '/api/v1/restaurant' });
  app.register(restaurantOperationsRoutes, { prefix: '/api/v1/restaurant' });
  app.register(restaurantReservationRoutes, { prefix: '/api/v1/restaurant' });
  app.register(restaurantCardsRoutes, { prefix: '/api/v1/restaurant' });
  app.register(adminAuthRoutes, { prefix: '/api/v1/admin' }); // DS Admin app: off (404) unless ADMIN_APP_ENABLED=true
  app.register(adminAttentionRoutes, { prefix: '/api/v1/admin' }); // DS Admin "Diqqat" list + acknowledgements
  app.register(adminMoneyRoutes, { prefix: '/api/v1/admin' }); // DS Admin A2: money review, card approval, platform card pool
  app.register(adminPlatformRoutes, { prefix: '/api/v1/admin' }); // DS Admin A3: platform settings, restaurants on/off, commission
  app.register(adminProvisionRoutes, { prefix: '/api/v1/admin' }); // DS Admin A3b: add restaurant, password, staff link, photo, delete/archive
  app.register(adminSupportRoutes, { prefix: '/api/v1/admin' }); // DS Admin A4a: support inbox, conversation, ticket actions
  app.register(adminTaxiRoutes, { prefix: '/api/v1/admin' }); // DS Admin A4b: taxi problems and taxi companies
  app.register(adminRefundsRoutes, { prefix: '/api/v1/admin' }); // DS Admin A4c: refunds (read + confirm with a note)
  app.register(adminPayoutsRoutes, { prefix: '/api/v1/admin' }); // DS Admin A5a: daily payout report for restaurants paid on platform cards (read only)
  app.register(legalRoutes);
  app.register(async orders => { await restaurantOrdersRoutes(orders, engine); }, { prefix: '/api/v1/restaurant' });
  app.register(async internal => { await internalRoutes(internal, engine); }, { prefix: '/api/v1/internal' });
  // Telegram Mini App (customer). Off unless MINIAPP_ENABLED=true; every route needs verified Telegram initData.
  app.register(async mini => { await miniAppRoutes(mini, engine); }, { prefix: '/api/v1/miniapp' });
  app.register(async scope => { await registerMiniAppStatic(scope); });
  return app;
}
