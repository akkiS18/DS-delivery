import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { adminAppEnabled } from '../../lib/features.js';
import { requireAdminSession } from '../admin-auth/routes.js';
import { notifyAdmins } from '../admin-platform/service.js';
import { adminConfirmRefund, adminMarkRefundSent } from '../refunds/service.js';
import { listRefunds, refundDetail } from './service.js';

const idParams = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/) }).strict();
const confirmSchema = z.object({ note: z.string().max(1000) }).strict();
const sentSchema = z.object({ bankReference: z.string().max(200) }).strict();

/** DS Admin app, A4c: refunds. Read-only except "confirm with a note", which is the same guarded step the bot's button takes. */
export async function adminRefundsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (_request, reply) => {
    if (!adminAppEnabled()) return reply.code(404).send({ error: 'NOT_FOUND' });
  });
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  app.get('/refunds', async request => {
    await requireAdminSession(request);
    return listRefunds();
  });

  app.get('/refunds/:id', async (request, reply) => {
    await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const d = await refundDetail(id);
    if (!d) return reply.code(404).send({ error: 'NOT_FOUND' });
    return d;
  });

  // The customer paid onto a PLATFORM card, so the money is the platform's: the administrator sends the refund himself (bank transfer, outside DS)
  // and records the bank reference. The customer is then asked to confirm, as for a restaurant refund. Refused for money the restaurant holds.
  app.post('/refunds/:id/sent', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const body = sentSchema.parse(request.body);
    try {
      const r = await adminMarkRefundSent({ adminTelegramId: s.telegramUserId, refundId: id, bankReference: body.bankReference });
      if (r.result === 'NOT_FOUND') return reply.code(404).send({ error: 'NOT_FOUND' });
      if (r.result === 'NOT_POOL') return reply.code(409).send({ error: 'NOT_POOL' });
      if (r.result === 'REFERENCE_USED') return reply.code(409).send({ error: 'REFERENCE_USED' });
      if (r.result === 'STALE') return reply.code(409).send({ error: 'CHANGED', status: r.status });
      await notifyAdmins('💸 Qaytarish: platforma kartasidan mijozga qaytarish belgilandi — DS Admin ilovasi.');
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && e.message === 'BANK_REFERENCE_NOTOGRI') return reply.code(400).send({ error: 'REFERENCE_INVALID', message: 'Bank ma’lumoti noto‘g‘ri (4–64 belgi, raqam bo‘lsin).' });
      throw e;
    }
  });

  // The administrator checked independently (restaurant statement, a call to the customer) and writes what they checked (10-300 characters).
  // Only a SENT or DISPUTED refund can be confirmed; a repeat or a stale screen is a 409 and changes nothing.
  app.post('/refunds/:id/confirm', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const body = confirmSchema.parse(request.body);
    try {
      const r = await adminConfirmRefund({ adminTelegramId: s.telegramUserId, refundId: id, note: body.note });
      if (r.result === 'NOT_FOUND') return reply.code(404).send({ error: 'NOT_FOUND' });
      if (r.result === 'STALE') return reply.code(409).send({ error: 'CHANGED', status: r.status });
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && e.message === 'ADMIN_IZOH_NOTOGRI') return reply.code(400).send({ error: 'NOTE_INVALID', message: 'Izoh 10–300 belgi bo‘lsin.' });
      throw e;
    }
  });
}
