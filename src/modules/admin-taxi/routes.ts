import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { adminAppEnabled } from '../../lib/features.js';
import { requireAdminSession } from '../admin-auth/routes.js';
import { notifyAdmins } from '../admin-platform/service.js';
import { planTaxiRemoval, removeTaxiCompany } from '../platform/removal.js';
import { adminRecoverDispatch } from '../taxi/recovery.js';
import { createTaxiCompanyByAdmin, resetTaxiAccessByAdmin } from '../taxi-app/provision.js';
import { listCompanies, listProblems, problemDetail } from './service.js';

const idParams = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/) }).strict();
const recoverSchema = z.object({
  action: z.enum(['RETRY_SAME', 'REASSIGN', 'DRIVER_SENT']),
  companyId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
  note: z.string().max(1000),
}).strict();
const createSchema = z.object({ name: z.string().max(200) }).strict();
const removeSchema = z.object({ expected: z.enum(['DELETE', 'ARCHIVE']) }).strict();

const RECOVERED: Record<string, string> = {
  RETRY_SAME: 'qayta yuborishga navbatga qo‘yildi',
  REASSIGN: 'boshqa kompaniyaga o‘tkazildi',
  DRIVER_SENT: 'haydovchi yuborilgani qayd etildi',
};

/**
 * DS Admin app, A4b: taxi problems and taxi companies. Retrying or reassigning needs the administrator's written note that NO driver was
 * sent for the previous attempt (the same attestation the bot asks for); "driver already sent" records the fact and creates nothing new.
 * A generated company password is in the answer exactly once, never logged and never sent to the admin chat.
 */
export async function adminTaxiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (_request, reply) => {
    if (!adminAppEnabled()) return reply.code(404).send({ error: 'NOT_FOUND' });
  });
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  app.get('/taxi/problems', async request => {
    await requireAdminSession(request);
    return { problems: await listProblems() };
  });

  app.get('/taxi/problems/:id', async (request, reply) => {
    await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const d = await problemDetail(id);
    if (!d) return reply.code(404).send({ error: 'NOT_FOUND' });
    return d;
  });

  app.post('/taxi/problems/:id/recover', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const body = recoverSchema.parse(request.body);
    if (body.action !== 'REASSIGN' && body.companyId) return reply.code(400).send({ error: 'COMPANY_NOT_ALLOWED' });
    try {
      const r = await adminRecoverDispatch({
        adminTelegramId: s.telegramUserId, dispatchId: id, action: body.action, note: body.note,
        ...(body.companyId ? { companyId: body.companyId } : {}),
      });
      if (r.result === 'NOT_FOUND') return reply.code(404).send({ error: 'NOT_FOUND' });
      if (r.result === 'STALE') return reply.code(409).send({ error: 'CHANGED', status: r.status });
      await notifyAdmins(`🚕 Taksi muammosi: ${RECOVERED[r.action]}${r.companyName ? ` (${r.companyName})` : ''} — DS Admin ilovasi.`);
      return { ok: true, action: r.action, companyName: r.companyName };
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      if (m === 'ADMIN_IZOH_NOTOGRI') return reply.code(400).send({ error: 'NOTE_INVALID', message: 'Izoh 10–300 belgi bo‘lsin.' });
      if (m === 'TAKSI_KOMPANIYASI_YOQ') return reply.code(409).send({ error: 'NO_COMPANY' });
      throw e;
    }
  });

  app.get('/taxi/companies', async request => {
    await requireAdminSession(request);
    return { companies: await listCompanies() };
  });

  app.post('/taxi/companies', async (request, reply) => {
    const s = await requireAdminSession(request);
    const body = createSchema.parse(request.body);
    try {
      const r = await createTaxiCompanyByAdmin({ adminId: s.telegramUserId, name: body.name });
      await notifyAdmins(`➕ Taksi kompaniyasi qo‘shildi: ${r.name} (${r.login}) — DS Admin ilovasi.`);
      return reply.code(201).send({ ok: true, name: r.name, login: r.login, password: r.password });
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      if (m === 'NOM_QISQA') return reply.code(400).send({ error: 'NAME_INVALID' });
      if (m === 'KOMPANIYA_BOR') return reply.code(409).send({ error: 'COMPANY_EXISTS' });
      throw e;
    }
  });

  app.post('/taxi/companies/:id/password', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const r = await resetTaxiAccessByAdmin({ adminId: s.telegramUserId, companyId: id });
    if (!r) return reply.code(404).send({ error: 'NOT_FOUND' });
    await notifyAdmins(`🔑 ${r.name}: taksi ilovasi paroli yangilandi, barcha qurilmalar chiqarildi — DS Admin ilovasi.`);
    return { ok: true, name: r.name, login: r.login, password: r.password };
  });

  app.get('/taxi/companies/:id/removal', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const plan = await planTaxiRemoval(s.telegramUserId, id);
    if (plan.result === 'NOT_FOUND') return reply.code(404).send({ error: 'NOT_FOUND' });
    return { plan };
  });

  app.post('/taxi/companies/:id/remove', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const body = removeSchema.parse(request.body);
    const plan = await planTaxiRemoval(s.telegramUserId, id);
    if (plan.result === 'NOT_FOUND') return reply.code(404).send({ error: 'NOT_FOUND' });
    if (plan.result === 'BLOCKED') return reply.code(409).send({ error: 'REMOVAL_BLOCKED', reason: plan.reason, count: plan.count });
    if (plan.result !== body.expected) return reply.code(409).send({ error: 'CHANGED', plan: plan.result });
    const r = await removeTaxiCompany({ adminId: s.telegramUserId, companyId: id });
    if (r.result === 'NOT_FOUND') return reply.code(404).send({ error: 'NOT_FOUND' });
    if (r.result === 'BLOCKED') return reply.code(409).send({ error: 'REMOVAL_BLOCKED', reason: r.reason, count: r.count });
    await notifyAdmins(r.result === 'DELETED' ? `🗑 Taksi kompaniyasi ${r.name}: o‘chirildi — DS Admin ilovasi.` : `🗄 Taksi kompaniyasi ${r.name}: arxivlandi — DS Admin ilovasi.`);
    return { ok: true, result: r.result, name: r.name };
  });
}
