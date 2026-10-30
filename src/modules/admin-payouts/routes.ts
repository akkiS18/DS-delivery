import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { adminAppEnabled } from '../../lib/features.js';
import { requireAdminSession } from '../admin-auth/routes.js';
import { notifyAdmins } from '../admin-platform/service.js';
import { MAX_DAYS, isDateKey, markPayoutPaid, payoutDayDetail, payoutReport, unmarkPayoutPaid } from './service.js';

const listQuery = z.object({ days: z.coerce.number().int().min(1).max(MAX_DAYS).default(7) }).strict();
const paidSchema = z.object({ expectedSom: z.number().int().min(1).max(2_000_000_000), note: z.string().max(1000).optional() }).strict();
const unpaidSchema = z.object({ note: z.string().max(1000) }).strict();
const dayParams = z.object({
  date: z.string().refine(isDateKey),
  restaurantId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
}).strict();

/** DS Admin app, A5a: the daily payout report. Read only: it tells the administrator what to transfer to each restaurant, it never moves money. */
export async function adminPayoutsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (_request, reply) => {
    if (!adminAppEnabled()) return reply.code(404).send({ error: 'NOT_FOUND' });
  });
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  app.get('/payouts', async request => {
    await requireAdminSession(request);
    const q = listQuery.parse(request.query);
    return payoutReport(q.days);
  });

  app.get('/payouts/:date/:restaurantId', async (request, reply) => {
    await requireAdminSession(request);
    const p = dayParams.parse(request.params);
    const d = await payoutDayDetail(p.date, p.restaurantId);
    if (!d) return reply.code(404).send({ error: 'NOT_FOUND' });
    return d;
  });

  // "I transferred it": remembers the amount for that day so it is not paid twice. The platform never moves money.
  app.post('/payouts/:date/:restaurantId/paid', async (request, reply) => {
    const s = await requireAdminSession(request);
    const p = dayParams.parse(request.params);
    const body = paidSchema.parse(request.body);
    try {
      const r = await markPayoutPaid({ adminId: s.telegramUserId, date: p.date, restaurantId: p.restaurantId, expectedSom: body.expectedSom, note: body.note });
      if (r.result === 'NOT_FOUND') return reply.code(404).send({ error: 'NOT_FOUND' });
      if (r.result === 'FUTURE_DAY') return reply.code(400).send({ error: 'FUTURE_DAY' });
      if (r.result === 'NOTHING_DUE') return reply.code(409).send({ error: 'NOTHING_TO_PAY' });
      if (r.result === 'ALREADY_PAID') return reply.code(409).send({ error: 'ALREADY_PAID' });
      if (r.result === 'CHANGED') return reply.code(409).send({ error: 'CHANGED', amountSom: r.payableSom });
      await notifyAdmins(`💸 To‘lov hisobi: ${p.date} kuni uchun restoranga o‘tkazma belgilandi — DS Admin ilovasi.`);
      return { ok: true, amountSom: r.amountSom };
    } catch (e) {
      if (e instanceof Error && e.message === 'ADMIN_IZOH_NOTOGRI') return reply.code(400).send({ error: 'NOTE_INVALID', message: 'Izoh 300 belgidan oshmasin.' });
      throw e;
    }
  });

  app.post('/payouts/:date/:restaurantId/unpaid', async (request, reply) => {
    const s = await requireAdminSession(request);
    const p = dayParams.parse(request.params);
    const body = unpaidSchema.parse(request.body);
    try {
      const r = await unmarkPayoutPaid({ adminId: s.telegramUserId, date: p.date, restaurantId: p.restaurantId, note: body.note });
      if (r.result === 'NOT_PAID') return reply.code(409).send({ error: 'CHANGED' });
      await notifyAdmins(`↩️ To‘lov hisobi: ${p.date} kuni uchun o‘tkazma belgisi bekor qilindi — DS Admin ilovasi.`);
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && e.message === 'ADMIN_IZOH_NOTOGRI') return reply.code(400).send({ error: 'NOTE_INVALID', message: 'Izoh 10–300 belgi bo‘lsin.' });
      throw e;
    }
  });
}
