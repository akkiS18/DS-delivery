import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PaymentEngineV3 } from '../payment/engine.js';
import { requireRestaurantSession } from '../restaurant-auth/routes.js';
import {
  acceptBodySchema, cancelBodySchema, getOrderView, listOrders, listQuerySchema, orderIdSchema, performOrderAction, preparingBodySchema,
  readyBodySchema, refundDecisionBodySchema, refundSentBodySchema, rejectBodySchema, verifyBodySchema,
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
  // Stage 6E: the restaurant confirms the REAL bank credit itself (explicit confirmReceived:true). Gmail only ever signals.
  act('verify-payment', 'VERIFY_PAYMENT', b => verifyBodySchema.parse(b));
  // Removed in 6F: prices are validated and frozen before payment, so a restaurant can no longer re-price an existing order.
  app.post('/orders/:id/propose-price', async (request, reply) => {
    await requireRestaurantSession(request);
    return reply.code(410).send({ error: 'PRICE_PROPOSALS_REMOVED' });
  });
  act('cancel', 'CANCEL_ORDER', b => cancelBodySchema.parse(b));
  act('refund/approve', 'REFUND_APPROVE', b => { const x = refundDecisionBodySchema.parse({ ...(b as object), decision: 'APPROVE' }); return { expectedStatus: x.expectedStatus }; });
  act('refund/reject', 'REFUND_REJECT', b => {
    const x = refundDecisionBodySchema.parse({ ...(b as object), decision: 'REJECT' });
    return { rejectReason: x.rejectReason, expectedStatus: x.expectedStatus };
  });
  act('refund/sent', 'REFUND_SENT', b => refundSentBodySchema.parse(b));
}
