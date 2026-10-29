import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { adminAppEnabled } from '../../lib/features.js';
import { requireAdminSession } from '../admin-auth/routes.js';
import { planRestaurantRemoval, removeRestaurant } from '../platform/removal.js';
import { RECEIPT_TYPES } from '../refunds/receipts.js';
import { createRestaurantByAdmin, linkStaffByAdmin, resetRestaurantPasswordByAdmin } from '../restaurant/provision.js';
import { IMAGE_MAX_BYTES, setRestaurantImage } from '../restaurant/image.js';
import { notifyAdmins } from './service.js';

const idParams = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/) }).strict();
const createSchema = z.object({
  name: z.string().max(200),
  pickupAddress: z.string().max(400),
  pickupPhone: z.string().max(30).optional(),
}).strict();
const staffSchema = z.object({ telegramId: z.string().regex(/^\d{1,20}$/) }).strict();
const removeSchema = z.object({ expected: z.enum(['DELETE', 'ARCHIVE']) }).strict();

/** The slug for a restaurant id (the services work by slug); null when there is no such restaurant. */
async function slugOf(id: string): Promise<string | null> {
  return (await db.restaurant.findUnique({ where: { id }, select: { slug: true } }))?.slug ?? null;
}

/** Service errors the bot also explains; mapped to a code the app turns into an Uzbek sentence. */
const INPUT_ERRORS: Record<string, string> = {
  NOM_QISQA: 'NAME_INVALID',
  MANZIL_QISQA: 'ADDRESS_INVALID',
  TELEFON_NOTOGRI: 'PHONE_INVALID',
  RASM_NOTOGRI: 'IMAGE_INVALID',
  TELEGRAM_ID_NOTOGRI: 'TELEGRAM_ID_INVALID',
};

/**
 * DS Admin app, A3b: add a restaurant, new password, link the Telegram staff account, restaurant photo, delete/archive. Each one calls the
 * service the Telegram command uses (so rules and audit rows are the same). A generated password is in the answer exactly once and is never
 * logged, stored or sent to the admin chat; answers are `no-store`.
 */
export async function adminProvisionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (_request, reply) => {
    if (!adminAppEnabled()) return reply.code(404).send({ error: 'NOT_FOUND' });
  });
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  app.post('/restaurants', async (request, reply) => {
    const s = await requireAdminSession(request);
    const body = createSchema.parse(request.body);
    try {
      const r = await createRestaurantByAdmin({ adminId: s.telegramUserId, name: body.name, pickupAddress: body.pickupAddress, pickupPhone: body.pickupPhone });
      await notifyAdmins(`➕ Restoran qo‘shildi: ${r.name} (${r.slug}) — DS Admin ilovasi.`);
      return reply.code(201).send({ ok: true, slug: r.slug, name: r.name, password: r.password });
    } catch (e) {
      const code = e instanceof Error ? INPUT_ERRORS[e.message] : undefined;
      if (code) return reply.code(400).send({ error: code });
      throw e;
    }
  });

  app.post('/restaurants/:id/password', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const slug = await slugOf(id);
    if (!slug) return reply.code(404).send({ error: 'NOT_FOUND' });
    const r = await resetRestaurantPasswordByAdmin({ adminId: s.telegramUserId, slug });
    if (!r) return reply.code(404).send({ error: 'NOT_FOUND' });
    await notifyAdmins(`🔑 ${r.name}: parol yangilandi, barcha qurilmalar chiqarildi — DS Admin ilovasi.`);
    return { ok: true, slug: r.slug, name: r.name, password: r.password };
  });

  app.put('/restaurants/:id/staff', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const body = staffSchema.parse(request.body);
    const slug = await slugOf(id);
    if (!slug) return reply.code(404).send({ error: 'NOT_FOUND' });
    const r = await linkStaffByAdmin({ adminId: s.telegramUserId, slug, telegramId: body.telegramId });
    if (r.result === 'NOT_FOUND') return reply.code(404).send({ error: 'NOT_FOUND' });
    if (r.result === 'TAKEN') return reply.code(409).send({ error: 'TELEGRAM_TAKEN', otherSlug: r.otherSlug });
    await notifyAdmins(`🔗 ${r.name}: Telegram xodimi ulandi — DS Admin ilovasi.`);
    return { ok: true, name: r.name };
  });

  // The photo is the raw request body (image/jpeg|png|webp, <= 3 MB; the app shrinks it first). The type is decided from the magic bytes.
  // Authentication runs BEFORE the body is read, so an anonymous caller cannot make the server buffer 3 MB.
  app.addContentTypeParser([...RECEIPT_TYPES], { parseAs: 'buffer', bodyLimit: IMAGE_MAX_BYTES }, (_request, body, done) => done(null, body));
  app.put('/restaurants/:id/image', {
    bodyLimit: IMAGE_MAX_BYTES,
    onRequest: async request => { await requireAdminSession(request); },
  }, async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const slug = await slugOf(id);
    if (!slug) return reply.code(404).send({ error: 'NOT_FOUND' });
    try {
      const r = await setRestaurantImage({ adminId: s.telegramUserId, slug, bytes: request.body as Buffer });
      if (!r) return reply.code(404).send({ error: 'NOT_FOUND' });
      return { ok: true, version: r.version };
    } catch (e) {
      if (e instanceof Error && e.message === 'RASM_NOTOGRI') return reply.code(400).send({ error: 'IMAGE_INVALID' });
      throw e;
    }
  });

  // Step one of removal: what WOULD happen (delete for good / archive because it has history / refused because something is unfinished).
  app.get('/restaurants/:id/removal', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const plan = await planRestaurantRemoval(s.telegramUserId, id);
    if (plan.result === 'NOT_FOUND') return reply.code(404).send({ error: 'NOT_FOUND' });
    return { plan };
  });

  // Step two: the app sends back what it showed (`expected`). If the plan is different now, nothing is done (409 CHANGED).
  app.post('/restaurants/:id/remove', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const body = removeSchema.parse(request.body);
    const plan = await planRestaurantRemoval(s.telegramUserId, id);
    if (plan.result === 'NOT_FOUND') return reply.code(404).send({ error: 'NOT_FOUND' });
    if (plan.result === 'BLOCKED') return reply.code(409).send({ error: 'REMOVAL_BLOCKED', reason: plan.reason, count: plan.count });
    if (plan.result !== body.expected) return reply.code(409).send({ error: 'CHANGED', plan: plan.result });
    const r = await removeRestaurant({ adminId: s.telegramUserId, restaurantId: id });
    if (r.result === 'NOT_FOUND') return reply.code(404).send({ error: 'NOT_FOUND' });
    if (r.result === 'BLOCKED') return reply.code(409).send({ error: 'REMOVAL_BLOCKED', reason: r.reason, count: r.count });
    await notifyAdmins(r.result === 'DELETED' ? `🗑 ${r.name}: o‘chirildi — DS Admin ilovasi.` : `🗄 ${r.name}: arxivlandi — DS Admin ilovasi.`);
    return { ok: true, result: r.result, name: r.name };
  });
}
