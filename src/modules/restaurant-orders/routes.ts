import type { FastifyInstance, FastifyReply } from 'fastify';
import { RECEIPT_MAX_BYTES, RECEIPT_TYPES } from '../refunds/receipts.js';
import type { PaymentEngineV3 } from '../payment/engine.js';
import { requireRestaurantSession } from '../restaurant-auth/routes.js';
import {
  acceptBodySchema, cancelBodySchema, getOrderView, listOrders, listQuerySchema, orderIdSchema, performOrderAction, prepTimeBodySchema, preparingBodySchema,
  pickedUpBodySchema, readyBodySchema, refundDecisionBodySchema, selfDeliveredBodySchema, refundReceiptQuerySchema, rejectBodySchema, verifyBodySchema,
  type ActionArgs, type ActionOutcome, type OrderAction,
} from './service.js';

/** The restaurant id comes from the Bearer session only; bodies and queries are strict so a client-sent
 *  restaurantId is a 400. Every mutation goes through the shared order services (the legacy Telegram staff panel used the
 *  same ones), so the app and Telegram can never disagree about a state. */
export async function restaurantOrdersRoutes(app: FastifyInstance, engine: PaymentEngineV3): Promise<void> {
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  const send = (reply: FastifyReply, r: ActionOutcome) => {
    if (r.ok) return { ...r.order, ...(r.autoStart ? { autoStart: r.autoStart } : {}) };
    const { httpStatus, ok: _ok, ...body } = r;
    return reply.code(httpStatus).send(body);
  };

  app.get('/orders', async request => {
    const s = await requireRestaurantSession(request);
    return listOrders(s.restaurant.id, listQuerySchema.parse(request.query));
  });

  app.get<{ Params: { id: string } }>('/orders/:id', async (request, reply) => {
    const s = await requireRestaurantSession(request);
    const order = await getOrderView(s.restaurant.id, orderIdSchema.parse(request.params.id));
    return order ?? reply.code(404).send({ error: 'NOT_FOUND' });
  });

  const act = (path: string, action: OrderAction, parse: (body: unknown) => ActionArgs) =>
    app.post<{ Params: { id: string } }>(`/orders/:id/${path}`, async (request, reply) => {
      const s = await requireRestaurantSession(request);
      const id = orderIdSchema.parse(request.params.id);
      return send(reply, await performOrderAction(engine, s.restaurant.id, id, action, parse(request.body ?? {})));
    });
  act('accept', 'ACCEPT', b => acceptBodySchema.parse(b));
  act('reject', 'REJECT', b => rejectBodySchema.parse(b));
  act('preparing', 'START_PREPARING', b => preparingBodySchema.parse(b));
  act('ready', 'MARK_READY', b => readyBodySchema.parse(b));
  // Walking delivery: the restaurant reports that it brought the order itself (only after "Tayyor" with delivery SELF).
  act('delivered-self', 'SELF_DELIVERED', b => selfDeliveredBodySchema.parse(b));
  // Pickup ("O‘zim olib ketaman"): the restaurant handed the ready order to the customer ("Mijozga berildi").
  act('picked-up', 'PICKED_UP', b => pickedUpBodySchema.parse(b));
  // "Ready in N minutes" (5..60), chosen after the payment while the food is already cooking.
  act('prep-time', 'SET_PREP_TIME', b => { const x = prepTimeBodySchema.parse(b); return { chosenMinutes: x.minutes, expectedStatus: x.expectedStatus }; });
  // Stage 6E: the restaurant confirms the REAL bank credit itself (explicit confirmReceived:true). Gmail only ever signals.
  act('verify-payment', 'VERIFY_PAYMENT', b => verifyBodySchema.parse(b));
  act('cancel', 'CANCEL_ORDER', b => cancelBodySchema.parse(b));
  act('refund/approve', 'REFUND_APPROVE', b => { const x = refundDecisionBodySchema.parse({ ...(b as object), decision: 'APPROVE' }); return { expectedStatus: x.expectedStatus }; });
  act('refund/reject', 'REFUND_REJECT', b => {
    const x = refundDecisionBodySchema.parse({ ...(b as object), decision: 'REJECT' });
    return { rejectReason: x.rejectReason, expectedStatus: x.expectedStatus };
  });
  // "Qaytarildi" from older restaurant apps. Owner decision 2026-11-22: the administrator sends every refund, so this is always refused
  // (409 REFUND_BY_PLATFORM, or 404 for another restaurant's order) and the photo is never stored. Authentication runs BEFORE the body is read,
  // so an anonymous caller cannot make the server buffer 5 MB.
  app.addContentTypeParser([...RECEIPT_TYPES], { parseAs: 'buffer', bodyLimit: RECEIPT_MAX_BYTES }, (_request, body, done) => done(null, body));
  app.post<{ Params: { id: string } }>('/orders/:id/refund/receipt', {
    bodyLimit: RECEIPT_MAX_BYTES,
    onRequest: async request => { await requireRestaurantSession(request); },
  }, async (request, reply) => {
    const s = await requireRestaurantSession(request);
    const id = orderIdSchema.parse(request.params.id);
    const q = refundReceiptQuerySchema.parse(request.query);
    return send(reply, await performOrderAction(engine, s.restaurant.id, id, 'REFUND_SENT', q.expectedStatus ? { expectedStatus: q.expectedStatus } : {}));
  });
}
