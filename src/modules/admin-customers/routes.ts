import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { adminAppEnabled } from '../../lib/features.js';
import { requireAdminSession } from '../admin-auth/routes.js';
import { notifyAdmins } from '../admin-platform/service.js';
import { customerDetail, listCustomers, recordStrike, revokeStrike, setCustomerBlock } from '../customer-strikes/service.js';

const idParams = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/) }).strict();
const strikeParams = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), strikeId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/) }).strict();
const searchQuery = z.object({ q: z.string().max(80).optional() }).strict();
const noteSchema = z.object({ note: z.string().max(1000) }).strict();
const strikeSchema = z.object({ note: z.string().max(1000), orderCode: z.string().max(20).optional() }).strict();

const NOTE_INVALID = { error: 'NOTE_INVALID', message: 'Izoh 10–300 belgi bo‘lsin.' };

/**
 * DS Admin app, A5b: customers with strikes or blocks (owner decision 2026-10-30: 1 strike turns cash off, 5 strikes block; the administrator can
 * also block by hand, revoke a strike and lift a block). Every change needs a written note, is audited, and is announced to the administrators.
 */
export async function adminCustomersRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (_request, reply) => {
    if (!adminAppEnabled()) return reply.code(404).send({ error: 'NOT_FOUND' });
  });
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  const guard = async <T>(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, run: () => Promise<T>): Promise<T | unknown> => {
    try { return await run(); } catch (e) {
      if (e instanceof Error && e.message === 'ADMIN_IZOH_NOTOGRI') return reply.code(400).send(NOTE_INVALID);
      throw e;
    }
  };

  app.get('/customers', async request => {
    await requireAdminSession(request);
    const q = searchQuery.parse(request.query);
    return { customers: await listCustomers(q.q) };
  });

  app.get('/customers/:id', async (request, reply) => {
    await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const d = await customerDetail(id);
    if (!d) return reply.code(404).send({ error: 'NOT_FOUND' });
    return d;
  });

  app.post('/customers/:id/strikes', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const body = strikeSchema.parse(request.body);
    return guard(reply, async () => {
      const r = await recordStrike({ customerId: id, source: 'ADMIN', reportedBy: s.telegramUserId, note: body.note, orderCode: body.orderCode?.trim() || undefined });
      if (r.result === 'NOT_FOUND') return reply.code(404).send({ error: 'NOT_FOUND' });
      if (r.result === 'ORDER_NOT_FOUND') return reply.code(400).send({ error: 'ORDER_INVALID', message: 'Bu buyurtma shu mijozniki emas yoki raqami noto‘g‘ri.' });
      if (r.result === 'ALREADY_RECORDED') return reply.code(409).send({ error: 'ALREADY_STRUCK', message: 'Bu buyurtma uchun strike allaqachon berilgan.' });
      await notifyAdmins(`⚠️ Mijozga strike berildi (hozir ${r.standing.strikes} ta${r.standing.blocked ? ', BLOKLANDI' : r.standing.cashAllowed ? '' : ', naqd o‘chdi'}) — DS Admin ilovasi.`);
      return reply.code(201).send({ ok: true, strikeId: r.strikeId, standing: r.standing });
    });
  });

  app.post('/customers/:id/strikes/:strikeId/revoke', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id, strikeId } = strikeParams.parse(request.params);
    const body = noteSchema.parse(request.body);
    return guard(reply, async () => {
      const r = await revokeStrike({ adminId: s.telegramUserId, customerId: id, strikeId, note: body.note });
      if (r.result === 'NOT_FOUND') return reply.code(404).send({ error: 'NOT_FOUND' });
      if (r.result === 'ALREADY_REVOKED') return reply.code(409).send({ error: 'CHANGED' });
      await notifyAdmins(`↩️ Strike bekor qilindi (hozir ${r.standing.strikes} ta) — DS Admin ilovasi.`);
      return { ok: true, standing: r.standing };
    });
  });

  for (const block of [true, false]) {
    app.post(`/customers/:id/${block ? 'block' : 'unblock'}`, async (request, reply) => {
      const s = await requireAdminSession(request);
      const { id } = idParams.parse(request.params);
      const body = noteSchema.parse(request.body);
      return guard(reply, async () => {
        const r = await setCustomerBlock({ adminId: s.telegramUserId, customerId: id, block, note: body.note });
        if (r.result === 'NOT_FOUND') return reply.code(404).send({ error: 'NOT_FOUND' });
        if (r.result === 'UNCHANGED') return reply.code(409).send({ error: 'CHANGED' });
        await notifyAdmins(block ? '🚫 Mijoz bloklandi — DS Admin ilovasi.' : '✅ Mijoz blokdan chiqarildi — DS Admin ilovasi.');
        return { ok: true, standing: r.standing };
      });
    });
  }
}
