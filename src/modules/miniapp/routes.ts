import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import { checkoutRequestSchema, customerCancelRequestSchema, quoteCheckout, quoteRequestSchema, toPlaceOrderInput } from '../orders/contract.js';
import { switchOrderToCash } from '../orders/cash.js';
import { placeOrder } from '../orders/service.js';
import type { PaymentEngineV3 } from '../payment/engine.js';
import { paymentMode } from '../payment/requisites.js';
import { cancelUnpaidOrder, requestCancellation } from '../refunds/service.js';
import { readReceipt } from '../refunds/receipts.js';
import { advanceMockOrder } from '../restaurant-orders/auto.js';
import { actorLabel, type CustomerOwner } from '../../lib/customer-owner.js';
import { appTicketThread, countUnreadAppTickets, listAppTickets } from '../support/app.js';
import { addAppCustomerMessage } from '../support/conversation.js';
import { createAppTicket } from '../support/service.js';
import { RATING_REASONS, NOTE_MAX, rateOrder } from '../ratings/service.js';
import { readRestaurantImage } from '../restaurant/image.js';
import { initDataFromHeader, verifyInitData, type InitDataUser } from './auth.js';
import { createGuest, guestAuthEnabled, guestTokenFromHeader, installationIdSchemaRe, resolveGuestSession, revokeSession } from './guest.js';
import { cancelLink, completeLink, createLinkAttempt, LinkError, linkStatus } from './telegram-link.js';
import {
  addressInputSchema, addressUpdateSchema, createAddress, deleteAddress, ensureCustomer, getProfile, ownedAddress, phoneBodySchema,
  ProfileError, setDefaultAddress, setPhone, touchAddress, updateAddress,
} from './profile.js';
import { eligibleCompanyWhere } from '../taxi/assignment.js';
import { customerOrderView, listCustomerOrders, listRestaurants, listTaxiOptions, loadCustomerOrder, restaurantMenu } from './views.js';

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
  // The restaurant's photo. Public on purpose (an <img> cannot send the auth header; it is a marketing picture): the id is not secret and the
  // URL carries ?v=<version>, so the answer is cached hard and a replaced photo shows up at once.
  app.get<{ Params: { id: string } }>('/restaurants/:id/image', { config: { public: true } }, async (request, reply) => {
    const img = await readRestaurantImage(idParam.parse(request.params.id));
    if (!img) throw httpError(404, 'NOT_FOUND');
    if (request.headers['if-none-match'] === `"${img.sha256}"`) return reply.code(304).send();
    return reply.header('Content-Type', img.mime).header('X-Content-Type-Options', 'nosniff').header('ETag', `"${img.sha256}"`)
      .header('Cache-Control', 'public, max-age=2592000, immutable').send(img.data);
  });
  app.get<{ Params: { id: string } }>('/restaurants/:id/menu', async request => {
    const menu = await restaurantMenu(idParam.parse(request.params.id));
    if (!menu) throw httpError(404, 'NOT_FOUND');
    return menu;
  });
  // The taxi services the customer can choose between at checkout (names only).
  app.get('/taxi-companies', async () => ({ companies: await listTaxiOptions() }));
  app.post('/quote', async request => {
    strict(request, 'quote', 60);
    return quoteCheckout(quoteRequestSchema.parse(request.body), { isTest: paymentMode() === 'MOCK' });
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

    // A chosen taxi service must be one that can be booked now; an unknown, inactive or unreachable id looks the same.
    if (body.taxiCompanyId && !(await db.taxiCompany.findFirst({ where: { id: body.taxiCompanyId, ...eligibleCompanyWhere() }, select: { id: true } }))) {
      throw httpError(409, 'TAKSI_XIZMATI_MAVJUD_EMAS');
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

  // The bank-receipt photo the restaurant attached to a sent refund, for the order's OWN customer only (foreign and unknown ids look the same).
  // Returned as base64 JSON so the Mini App and the native app can show it without any binary or header-authenticated image loading.
  app.get<{ Params: { id: string } }>('/orders/:id/refund/receipt', async request => {
    strict(request, 'receipt', 20);
    const id = idParam.parse(request.params.id);
    const order = await loadCustomerOrder(owner(request), id);
    if (!order) throw httpError(404, 'NOT_FOUND');
    const refund = await db.refundRequest.findFirst({
      where: { orderId: order.id, receiptKey: { not: null }, status: { in: ['SENT', 'CONFIRMED', 'DISPUTED'] } },
      orderBy: { number: 'desc' }, select: { receiptKey: true, receiptMime: true, sentAt: true },
    });
    const bytes = refund?.receiptKey ? await readReceipt(refund.receiptKey) : null;
    if (!refund || !bytes) throw httpError(404, 'NOT_FOUND');
    return { mime: refund.receiptMime, dataBase64: bytes.toString('base64'), sentAt: refund.sentAt?.toISOString() ?? null };
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

  // "No free card, pay in cash": converts the customer's still-QUEUED card payment into a cash order for the restaurant to accept. Idempotent.
  app.post<{ Params: { id: string } }>('/orders/:id/pay-cash', async request => {
    strict(request, 'paycash', 10);
    const id = idParam.parse(request.params.id);
    const r = await switchOrderToCash(engine, { telegramUserId: audit(request), orderId: id, ...(request.principal!.kind === 'guest' ? { customerId: await customerId(request) } : {}) });
    if (r === 'NOT_FOUND') throw httpError(404, 'NOT_FOUND');
    if (r === 'CASH_OFF') throw httpError(409, 'NAQD_TOLOV_YOPIQ');
    if (r === 'TOO_LARGE') throw httpError(409, 'NAQD_SUMMA_JUDA_KATTA');
    if (r === 'LIMIT') throw httpError(429, 'KOP_NAQD_BUYURTMA');
    if (r === 'NOT_ALLOWED') throw httpError(409, 'NAQD_MUMKIN_EMAS');
    return { order: await ownedView(request, id) };
  });

  // ------------------------------------------------------------------ support chat (customer side; admins answer in Telegram)
  const ticketBody = z.object({ message: z.string().trim().min(5).max(1000) }).strict();
  const messageBody = z.object({ text: z.string().trim().min(1).max(1000), clientKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/) }).strict();

  app.get('/support', async request => {
    strict(request, 'support', 60);
    return { tickets: await listAppTickets(await customerId(request)) };
  });
  // Cheap count for the tab badge.
  app.get('/support/unread', async request => {
    strict(request, 'supportunread', 60);
    const p = request.principal!;
    if (p.kind === 'telegram' && !(await db.customer.findUnique({ where: { telegramUserId: p.user.id }, select: { id: true } }))) return { unread: 0 };
    return { unread: await countUnreadAppTickets(await customerId(request)) };
  });
  app.get<{ Params: { id: string } }>('/support/:id', async request => {
    strict(request, 'support', 60);
    const thread = await appTicketThread(await customerId(request), idParam.parse(request.params.id));
    if (!thread) throw httpError(404, 'NOT_FOUND');
    return thread;
  });
  // Opens a ticket for one of the caller's own orders (e.g. a payment that was not confirmed in time). An order that already has an open ticket returns it.
  app.post<{ Params: { id: string } }>('/orders/:id/support', async (request, reply) => {
    strict(request, 'supportnew', 10, 3_600_000);
    const body = ticketBody.parse(request.body);
    const r = await createAppTicket({ customerId: (await customerRow(request)).id, orderId: idParam.parse(request.params.id), message: body.message });
    if (r.result === 'NOT_FOUND') throw httpError(404, 'NOT_FOUND');
    if (r.result === 'UNAVAILABLE') throw httpError(503, 'SUPPORT_UNAVAILABLE');
    if (r.result === 'LIMIT') throw httpError(429, 'KOP_OCHIQ_MUROJAAT');
    return reply.code(r.result === 'CREATED' ? 201 : 200).send({ ticketId: r.ticketId, number: r.number, created: r.result === 'CREATED' });
  });
  app.post<{ Params: { id: string } }>('/support/:id/messages', async (request, reply) => {
    strict(request, 'supportmsg', 20);
    const body = messageBody.parse(request.body);
    const r = await addAppCustomerMessage({ customerId: await customerId(request), ticketId: idParam.parse(request.params.id), text: body.text, clientKey: body.clientKey });
    if (r.result === 'NOT_FOUND') throw httpError(404, 'NOT_FOUND');
    if (r.result === 'ALREADY_RESOLVED') throw httpError(409, 'MUROJAAT_YOPILGAN');
    if (r.result === 'TOO_MANY') throw httpError(429, 'KOP_XABAR');
    return reply.code(r.result === 'SENT' ? 201 : 200).send({ sent: r.result === 'SENT' });
  });

  // Rate the food of a delivered order (24 h after delivery; changing it is allowed in that time). Nothing about the taxi is rated here.
  const ratingBody = z.object({
    stars: z.number().int().min(1).max(5),
    reasons: z.array(z.enum(RATING_REASONS)).max(RATING_REASONS.length).optional(),
    note: z.string().trim().max(NOTE_MAX).optional(),
  }).strict();
  app.put<{ Params: { id: string } }>('/orders/:id/rating', async request => {
    strict(request, 'rate', 20);
    const id = idParam.parse(request.params.id);
    const body = ratingBody.parse(request.body);
    const order = await loadCustomerOrder(owner(request), id);
    if (!order) throw httpError(404, 'NOT_FOUND');
    const view = customerOrderView(order);
    const r = await rateOrder({ customerId: order.customerId, orderId: id, stars: body.stars, reasons: body.reasons ?? [], note: body.note }, { canRate: view.canRate });
    if (r.result === 'NOT_FOUND') throw httpError(404, 'NOT_FOUND');
    if (r.result === 'NOT_ALLOWED') throw httpError(409, 'BAHOLASH_MUMKIN_EMAS');
    if (r.result === 'CLOSED') throw httpError(409, 'BAHOLASH_MUDDATI_TUGADI');
    return { order: await ownedView(request, id) };
  });

  // "I received my order": once, only for the order's own customer, only while the taxi is on its way or delivered. Idempotent.
  app.post<{ Params: { id: string } }>('/orders/:id/received', async request => {
    strict(request, 'received', 10);
    const id = idParam.parse(request.params.id);
    const order = await loadCustomerOrder(owner(request), id);
    if (!order) throw httpError(404, 'NOT_FOUND');
    const view = customerOrderView(order);
    if (view.receivedAt) return { order: view };
    if (!view.canConfirmReceived) throw httpError(409, 'NOT_YET');
    await db.$transaction(async tx => {
      const { count } = await tx.order.updateMany({ where: { id, customerReceivedAt: null }, data: { customerReceivedAt: new Date() } });
      if (count === 1) {
        await tx.orderEvent.create({ data: { orderId: id, actorTelegramId: audit(request), actorType: 'CUSTOMER', action: 'CUSTOMER_RECEIVED', fromStatus: order.status, toStatus: order.status } });
      }
    });
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
