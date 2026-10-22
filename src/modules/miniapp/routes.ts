import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import { checkoutRequestSchema, customerCancelRequestSchema, quoteCheckout, quoteRequestSchema, toPlaceOrderInput } from '../orders/contract.js';
import { placeOrder } from '../orders/service.js';
import type { PaymentEngineV3 } from '../payment/engine.js';
import { paymentMode } from '../payment/requisites.js';
import { cancelUnpaidOrder, requestCancellation } from '../refunds/service.js';
import { advanceMockOrder } from '../restaurant-orders/auto.js';
import { actorLabel, type CustomerOwner } from '../../lib/customer-owner.js';
import { initDataFromHeader, verifyInitData, type InitDataUser } from './auth.js';
import { createGuest, guestAuthEnabled, guestTokenFromHeader, installationIdSchemaRe, resolveGuestSession, revokeSession } from './guest.js';
import { cancelLink, completeLink, createLinkAttempt, LinkError, linkStatus } from './telegram-link.js';
import {
  addressInputSchema, addressUpdateSchema, createAddress, deleteAddress, ensureCustomer, getProfile, ownedAddress, phoneBodySchema,
  ProfileError, setDefaultAddress, setPhone, touchAddress, updateAddress,
} from './profile.js';
import { customerOrderView, listCustomerOrders, listRestaurants, loadCustomerOrder, restaurantMenu } from './views.js';

/** Who is calling. Exactly one credential type per request: `tma <initData>` (Telegram) or `Bearer dsg_...` (Android guest session). No fallback between them. */
export type Principal = { kind: 'telegram'; user: InitDataUser } | { kind: 'guest'; customerId: string; sessionId: string };

declare module 'fastify' {
  interface FastifyRequest { principal?: Principal }
  interface FastifyContextConfig { public?: boolean }
}

const idParam = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const httpError = (statusCode: number, message: string): Error => Object.assign(new Error(message), { statusCode });

export interface MiniAppOptions {
  /** Defaults to process.env.BOT_TOKEN. The token is only used server-side to verify signatures; it is never sent to the browser. */
  botToken?: string | undefined;
  maxAgeSeconds?: number;
  limiter?: RateLimiter;
  now?: () => number;
}

/** True when the Mini App API should be served at all (MINIAPP_ENABLED=true). Off = every /miniapp route is a plain 404. */
export const miniAppEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.MINIAPP_ENABLED?.trim().toLowerCase() === 'true';

/**
 * Authenticated customer API for the Telegram Mini App. Identity = the Telegram user inside VERIFIED initData
 * (`Authorization: tma <initData>`); no route accepts a customer id from the client. All business logic is the existing services
 * (placeOrder / validateCheckout / cancel / refunds / MOCK auto-advance) - this file only authenticates, authorizes and maps.
 */
export async function miniAppRoutes(app: FastifyInstance, engine: PaymentEngineV3, options: MiniAppOptions = {}): Promise<void> {
  const limiter = options.limiter ?? new RateLimiter(options.now);
  limiter.startSweeper();
  app.addHook('onClose', async () => limiter.stop());
  const maxAge = options.maxAgeSeconds ?? Number(process.env.MINIAPP_AUTH_MAX_AGE_SECONDS ?? 86_400);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!miniAppEnabled()) throw httpError(404, 'NOT_FOUND');
    // cheap per-IP guard first (covers unauthenticated floods), then the per-user limits below
    const ip = limiter.allow(`ip:${request.ip}`, 240, 60_000);
    if (!ip.allowed) { reply.header('Retry-After', String(ip.retryAfterSeconds)); throw httpError(429, 'TOO_MANY_REQUESTS'); }
  });

  const authFailed = (request: FastifyRequest, reply: FastifyReply, reason: string): never => {
    const bad = limiter.allow(`authfail:${request.ip}`, 20, 60_000);
    if (!bad.allowed) { reply.header('Retry-After', String(bad.retryAfterSeconds)); throw httpError(429, 'TOO_MANY_REQUESTS'); }
    // Same body for "missing", "bad signature", "expired", "revoked": no oracle for an attacker. The reason is logged, not returned.
    request.log.warn({ reason }, 'miniapp auth rejected');
    throw httpError(401, 'UNAUTHENTICATED');
  };

  app.addHook('preHandler', async (request, reply) => {
    if (request.routeOptions.config.public) return; // guest bootstrap: nothing to authenticate yet
    const header = request.headers.authorization;
    if (/^bearer\s/i.test(header ?? '')) {
      // Android guest session. A failed guest token never turns into anything else, and a failed Telegram header never falls back to a guest.
      if (!guestAuthEnabled()) throw httpError(404, 'NOT_FOUND');
      const token = guestTokenFromHeader(header);
      const session = token ? await resolveGuestSession(token) : null;
      if (!session) return authFailed(request, reply, token ? 'GUEST_SESSION_INVALID' : 'GUEST_TOKEN_MALFORMED');
      request.principal = { kind: 'guest', ...session };
    } else {
      const botToken = options.botToken ?? process.env.BOT_TOKEN?.trim();
      if (!botToken) throw httpError(503, 'MINIAPP_NOT_CONFIGURED');
      const raw = initDataFromHeader(header);
      const result = raw ? verifyInitData(raw, botToken, { maxAgeSeconds: maxAge, ...(options.now ? { nowSeconds: Math.floor(options.now() / 1000) } : {}) }) : null;
      if (!result || !result.ok) return authFailed(request, reply, result ? result.reason : 'MISSING');
      request.principal = { kind: 'telegram', user: result.user };
    }
    const user = limiter.allow(`user:${rateId(request)}`, 120, 60_000);
    if (!user.allowed) { reply.header('Retry-After', String(user.retryAfterSeconds)); throw httpError(429, 'TOO_MANY_REQUESTS'); }
  });

  const rateId = (request: FastifyRequest): string => { const p = request.principal!; return p.kind === 'telegram' ? p.user.id : `g${p.customerId}`; };
  const owner = (request: FastifyRequest): CustomerOwner => { const p = request.principal!; return p.kind === 'telegram' ? p.user.id : { customerId: p.customerId }; };
  const audit = (request: FastifyRequest): string => actorLabel(owner(request));
  const strict = (request: FastifyRequest, bucket: string, max: number, windowMs = 60_000): void => {
    const r = limiter.allow(`${bucket}:${rateId(request)}`, max, windowMs);
    if (!r.allowed) throw httpError(429, 'TOO_MANY_REQUESTS');
  };
  const displayName = (u: InitDataUser): string | null => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;
  const callerName = (request: FastifyRequest): string | null => { const p = request.principal!; return p.kind === 'telegram' ? displayName(p.user) : null; };
  const ownedView = async (request: FastifyRequest, orderId: string) => {
    const order = await loadCustomerOrder(owner(request), orderId);
    return order ? customerOrderView(order) : null;
  };
  const guestOnly = (request: FastifyRequest): { customerId: string; sessionId: string } => {
    const p = request.principal!;
    if (p.kind !== 'guest') throw httpError(403, 'GUEST_ONLY');
    return p;
  };
  const linkErrors = (err: unknown): never => {
    if (err instanceof LinkError) throw httpError(err.statusCode, err.message);
    throw err;
  };

  /** The caller's Customer row, created on first write for a Telegram user; a guest's row already exists (made at bootstrap). */
  const customerRow = async (request: FastifyRequest) => {
    const p = request.principal!;
    return p.kind === 'telegram' ? ensureCustomer(p.user.id, displayName(p.user)) : db.customer.findUniqueOrThrow({ where: { id: p.customerId } });
  };

  // ------------------------------------------------------------------ guest bootstrap (Android)
  app.post('/guest/session', { config: { public: true } }, async (request, reply) => {
    if (!guestAuthEnabled()) throw httpError(404, 'NOT_FOUND');
    const ip = limiter.allow(`guestboot:${request.ip}`, Number(process.env.GUEST_BOOTSTRAP_PER_IP_HOUR ?? 20), 3_600_000);
    if (!ip.allowed) { reply.header('Retry-After', String(ip.retryAfterSeconds)); throw httpError(429, 'TOO_MANY_REQUESTS'); }
    const body = z.object({ installationId: z.string().regex(installationIdSchemaRe).optional() }).strict().parse(request.body ?? {});
    if (body.installationId) {
      const inst = limiter.allow(`guestinst:${body.installationId}`, 5, 3_600_000);
      if (!inst.allowed) throw httpError(429, 'TOO_MANY_REQUESTS');
    }
    const g = await createGuest(body.installationId ?? null);
    return reply.code(201).send({ token: g.token, expiresAt: g.expiresAt.toISOString() });
  });

  app.delete('/guest/session', async (request, reply) => {
    await revokeSession(guestOnly(request).sessionId, 'LOGOUT');
    return reply.code(204).send();
  });

  // ------------------------------------------------------------------ config & profile
  app.get('/config', async () => {
    const mode = paymentMode();
    return { paymentMode: mode, mockPaymentAvailable: mode === 'MOCK' && process.env.NODE_ENV !== 'production', currency: 'UZS' };
  });

  app.get('/me', async request => getProfile(owner(request)));

  app.put('/me/phone', async request => {
    strict(request, 'profile', 30);
    const customer = await customerRow(request);
    return setPhone(customer.id, phoneBodySchema.parse(request.body).phone);
  });

  app.get('/me/addresses', async request => (await getProfile(owner(request))).addresses);

  app.post('/me/addresses', async (request, reply) => {
    strict(request, 'profile', 30);
    const customer = await customerRow(request);
    return reply.code(201).send(await createAddress(customer.id, addressInputSchema.parse(request.body)));
  });

  const customerId = async (request: FastifyRequest): Promise<string> => {
    const p = request.principal!;
    if (p.kind === 'guest') return p.customerId;
    const c = await db.customer.findUnique({ where: { telegramUserId: p.user.id }, select: { id: true } });
    if (!c) throw httpError(404, 'NOT_FOUND');
    return c.id;
  };

  app.put<{ Params: { id: string } }>('/me/addresses/:id', async request => {
    strict(request, 'profile', 30);
    return updateAddress(await customerId(request), idParam.parse(request.params.id), addressUpdateSchema.parse(request.body));
  });
  app.post<{ Params: { id: string } }>('/me/addresses/:id/default', async request => {
    strict(request, 'profile', 30);
    return setDefaultAddress(await customerId(request), idParam.parse(request.params.id));
  });
  app.delete<{ Params: { id: string } }>('/me/addresses/:id', async (request, reply) => {
    strict(request, 'profile', 30);
    await deleteAddress(await customerId(request), idParam.parse(request.params.id));
    return reply.code(204).send();
  });

  // ------------------------------------------------------------------ optional Telegram link (guest sessions only)
  app.post('/me/telegram-link', async request => {
    const g = guestOnly(request);
    strict(request, 'linkstart', 5, 10 * 60_000);
    return createLinkAttempt(g).catch(linkErrors);
  });
  app.get<{ Params: { id: string } }>('/me/telegram-link/:id', async request => {
    const g = guestOnly(request);
    strict(request, 'linkpoll', 40); // bounded polling: the app asks every few seconds
    return linkStatus(g, idParam.parse(request.params.id)).catch(linkErrors);
  });
  app.post<{ Params: { id: string } }>('/me/telegram-link/:id/confirm', async request => {
    const g = guestOnly(request);
    strict(request, 'linkconfirm', 10);
    const r = await completeLink(g, idParam.parse(request.params.id)).catch(linkErrors);
    if (r.result === 'ALREADY_COMPLETED') return { status: 'COMPLETED', merged: null, session: null };
    return { status: 'COMPLETED', merged: r.merged, summary: r.summary, session: { token: r.session.token, expiresAt: r.session.expiresAt.toISOString() } };
  });
  app.post<{ Params: { id: string } }>('/me/telegram-link/:id/cancel', async request => {
    const g = guestOnly(request);
    strict(request, 'linkcancel', 20);
    return cancelLink(g, idParam.parse(request.params.id)).catch(linkErrors);
  });

  // ------------------------------------------------------------------ catalog & quote
  app.get('/restaurants', async request => ({ restaurants: await listRestaurants(z.object({ q: z.string().trim().max(60).optional() }).parse(request.query).q) }));
  app.get<{ Params: { id: string } }>('/restaurants/:id/menu', async request => {
    const menu = await restaurantMenu(idParam.parse(request.params.id));
    if (!menu) throw httpError(404, 'NOT_FOUND');
    return menu;
  });
  app.post('/quote', async request => {
    strict(request, 'quote', 60);
    return quoteCheckout(quoteRequestSchema.parse(request.body));
  });

  // ------------------------------------------------------------------ orders
  app.post('/orders', async (request, reply) => {
    strict(request, 'order', Number(process.env.MINIAPP_ORDER_RATE_PER_MINUTE ?? 10)); // creating orders is the expensive, abusable action
    const body = checkoutRequestSchema.parse(request.body);
    const customer = await customerRow(request);

    // A retry of the same checkoutKey (double tap, lost response) returns the first order untouched.
    const existing = await db.order.findUnique({ where: { checkoutKey: body.checkoutKey }, select: { id: true, customerId: true } });
    if (existing) {
      if (existing.customerId !== customer.id) throw httpError(409, 'CHECKOUT_KEY_BEGONA');
      const view = await ownedView(request, existing.id);
      return reply.code(200).send({ order: view, replayed: true });
    }

    const phone = body.phone ?? customer.phone;
    if (!phone) throw httpError(400, 'PHONE_REQUIRED');
    let addressText: string; let lat: number | null = null; let lng: number | null = null;
    if (body.addressId) {
      const a = await ownedAddress(customer.id, body.addressId); // another customer's address id is "not found"
      addressText = a.addressText; lat = a.lat; lng = a.lng;
    } else {
      addressText = body.address!.addressText; lat = body.address!.lat ?? null; lng = body.address!.lng ?? null;
    }

    const placed = await placeOrder(engine, toPlaceOrderInput(owner(request), callerName(request) ?? undefined, { phone, addressText, lat, lng }, body, paymentMode()));
    if (!placed) throw httpError(500, 'ORDER_NOT_CREATED');

    // Remember what the customer entered, only after the order exists (a refused checkout stores nothing).
    if (body.phone && body.phone !== customer.phone) await setPhone(customer.id, body.phone);
    if (body.addressId) await touchAddress(customer.id, body.addressId);
    else if (body.address?.save) {
      await createAddress(customer.id, { label: body.address.label ?? 'Manzil', addressText, ...(lat !== null ? { lat, lng: lng! } : {}) }).catch(err => {
        if (!(err instanceof ProfileError)) throw err; // the address limit must not fail an order that already exists
      });
    }
    return reply.code(201).send({ order: await ownedView(request, placed.id), replayed: false });
  });

  app.get('/orders', async request => ({ orders: await listCustomerOrders(owner(request)) }));

  app.get<{ Params: { id: string } }>('/orders/:id', async request => {
    const view = await ownedView(request, idParam.parse(request.params.id));
    if (!view) throw httpError(404, 'NOT_FOUND');
    return { order: view };
  });

  app.post<{ Params: { id: string } }>('/orders/:id/cancel', async request => {
    strict(request, 'cancel', 10);
    const id = idParam.parse(request.params.id);
    const body = customerCancelRequestSchema.parse(request.body ?? {}); // reason code only: no bank data is ever accepted
    const order = await loadCustomerOrder(owner(request), id);
    if (!order) throw httpError(404, 'NOT_FOUND');
    const view = customerOrderView(order);
    if (view.cancel.kind === 'UNPAID') {
      const r = await cancelUnpaidOrder(engine, { telegramUserId: audit(request), orderId: id, ...(request.principal!.kind === 'guest' ? { customerId: await customerId(request) } : {}) });
      if (r.result === 'NOT_FOUND') throw httpError(404, 'NOT_FOUND');
      if (r.result !== 'CANCELLED') throw httpError(409, 'NOT_CANCELLABLE');
    } else if (view.cancel.kind === 'REFUND_REQUEST') {
      const r = await requestCancellation({ actorType: 'CUSTOMER', actorTelegramId: audit(request), orderId: id, reasonCode: body.reasonCode ?? 'OTHER', ...(request.principal!.kind === 'guest' ? { customerId: await customerId(request) } : {}) });
      if (r.result === 'NOT_FOUND') throw httpError(404, 'NOT_FOUND');
      if (!['REQUESTED', 'ALREADY_REQUESTED'].includes(r.result)) throw httpError(409, 'NOT_CANCELLABLE');
    } else if (view.status === 'CANCELLED' || view.status === 'CUSTOMER_CANCELLED') {
      // idempotent: cancelling an already cancelled order just returns it
    } else {
      throw httpError(409, 'NOT_CANCELLABLE');
    }
    return { order: await ownedView(request, id) };
  });

  // MOCK mode only (never in production): the safe test payment, the same path as the bot's MOCK button.
  app.post<{ Params: { id: string } }>('/orders/:id/mock-payment', async (request, reply: FastifyReply) => {
    strict(request, 'mockpay', 20);
    if (paymentMode() !== 'MOCK' || process.env.NODE_ENV === 'production') throw httpError(409, 'MOCK_PAYMENT_NOT_AVAILABLE');
    const id = idParam.parse(request.params.id);
    const order = await loadCustomerOrder(owner(request), id);
    if (!order) throw httpError(404, 'NOT_FOUND');
    if (order.payment?.status !== 'AWAITING' || !order.payment.card?.isTest || !order.paymentIsTest) throw httpError(409, 'MOCK_PAYMENT_NOT_AVAILABLE');
    await engine.ingestMock(order.payment.amountTiyin, order.payment.card.last4);
    await advanceMockOrder(id).catch(err => request.log.error({ err }, 'mock auto-advance failed'));
    return reply.send({ order: await ownedView(request, id) });
  });
}
