import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cursorParam } from '../../lib/cursor.js';
import { requireRestaurantSession } from '../restaurant-auth/routes.js';
import { financeCommissions, financeOrders, financeRefunds, financeSummary } from './service.js';
import { financeLedger, financeOverview } from './overview.js';
import { financeState, lockFinance, requireFinanceUnlocked, unlockFinance } from './pin.js';

const dateParam = z.string().trim().min(10).max(40);
const range = { from: dateParam.optional(), to: dateParam.optional() };
const page = {
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: cursorParam.optional(),
};
// Strict: an unknown parameter (including a client-sent restaurantId) is a 400. Identity comes only from the Bearer session.
const summaryQuery = z.object(range).strict();
const ordersQuery = z.object({ ...range, ...page, status: z.enum(['completed', 'cancelled', 'in_progress']).optional() }).strict();
const commissionsQuery = z.object({ ...range, ...page }).strict();
const ledgerQuery = z.object({ ...range, limit: page.limit, cursor: page.cursor, filter: z.enum(['all', 'card', 'cash']).default('all') }).strict();
const unlockBody = z.object({ pin: z.string().regex(/^\d{4}$/) }).strict();
const refundsQuery = z.object({ ...range, ...page, status: z.enum(['REQUESTED', 'APPROVED', 'REJECTED', 'SENT', 'CONFIRMED', 'DISPUTED']).optional() }).strict();

/** Read-only. Every handler starts with requireRestaurantSession and passes ONLY the session's restaurant id to the queries. */
export async function restaurantFinanceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  // ---- the finance PIN: state, unlock, lock
  app.get('/finance/state', async request => {
    const s = await requireRestaurantSession(request);
    return financeState(s.sessionId, s.restaurant.id);
  });
  app.post('/finance/unlock', async (request, reply) => {
    const s = await requireRestaurantSession(request);
    const body = unlockBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'PIN_NOTOGRI' });
    const r = await unlockFinance({ sessionId: s.sessionId, restaurantId: s.restaurant.id, pin: body.data.pin });
    if (r.result === 'UNLOCKED') return { unlocked: true, unlockedUntil: r.until.toISOString() };
    if (r.result === 'NO_PIN') return reply.code(409).send({ error: 'FINANCE_NO_PIN' });
    if (r.result === 'LOCKED') return reply.code(429).header('Retry-After', String(r.retryAfterSeconds)).send({ error: 'FINANCE_PIN_BLOCKED', retryAfterSeconds: r.retryAfterSeconds });
    // 403, not 401: apps treat 401 as "login expired" and sign the user out, and a mistyped code must never do that.
    return reply.code(403).send({ error: 'FINANCE_PIN_WRONG', attemptsLeft: r.attemptsLeft });
  });
  app.post('/finance/lock', async (request, reply) => {
    const s = await requireRestaurantSession(request);
    await lockFinance(s.sessionId, s.restaurant.id);
    return reply.code(204).send();
  });

  // ---- the simple money view (PIN required: a code must exist and be entered)
  app.get('/finance/overview', async request => {
    const s = await requireRestaurantSession(request);
    await requireFinanceUnlocked(s.sessionId, s.restaurant.id, { strict: true });
    return financeOverview(s.restaurant.id);
  });
  app.get('/finance/ledger', async request => {
    const s = await requireRestaurantSession(request);
    await requireFinanceUnlocked(s.sessionId, s.restaurant.id, { strict: true });
    return financeLedger(s.restaurant.id, ledgerQuery.parse(request.query));
  });

  // ---- the older detailed endpoints (installed apps still call them): locked as soon as a code exists
  app.get('/finance/summary', async request => {
    const s = await requireRestaurantSession(request);
    await requireFinanceUnlocked(s.sessionId, s.restaurant.id, { strict: false });
    return financeSummary(s.restaurant.id, summaryQuery.parse(request.query));
  });
  app.get('/finance/orders', async request => {
    const s = await requireRestaurantSession(request);
    await requireFinanceUnlocked(s.sessionId, s.restaurant.id, { strict: false });
    const q = ordersQuery.parse(request.query);
    return financeOrders(s.restaurant.id, { ...q, bucket: q.status });
  });
  app.get('/finance/commissions', async request => {
    const s = await requireRestaurantSession(request);
    await requireFinanceUnlocked(s.sessionId, s.restaurant.id, { strict: false });
    return financeCommissions(s.restaurant.id, commissionsQuery.parse(request.query));
  });
  app.get('/finance/refunds', async request => {
    const s = await requireRestaurantSession(request);
    await requireFinanceUnlocked(s.sessionId, s.restaurant.id, { strict: false });
    return financeRefunds(s.restaurant.id, refundsQuery.parse(request.query));
  });
}
