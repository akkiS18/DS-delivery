import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { adminAppEnabled } from '../../lib/features.js';
import { requireAdminSession } from '../admin-auth/routes.js';
import { RECEIPT_TYPES } from '../refunds/receipts.js';
import { adminPromoOverview, createBanner, createPromotion, deleteBanner, deletePromotion, readBannerImageForAdmin, setBannerImageByAdmin, updateBanner, updatePromotion } from '../promotions/admin.js';
import { BANNER_IMAGE_MAX_BYTES } from '../promotions/service.js';

const idParams = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/) }).strict();
const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const createPromoSchema = z.object({ restaurantId: id, title: z.string().max(100) }).strict();
const patchPromoSchema = z.object({
  isActive: z.boolean().optional(), /** 0 = remove the cap (the app cannot send an explicit null). */ maxFreePerOrder: z.number().int().min(0).max(100).optional(),
  productIds: z.array(id).max(60).optional(), title: z.string().max(100).optional(),
}).strict();
const createBannerSchema = z.object({ title: z.string().max(100), restaurantId: id.nullable().optional(), promotionId: id.nullable().optional(), endsAt: z.string().max(40).nullable().optional() }).strict();
const patchBannerSchema = z.object({
  title: z.string().max(100).optional(), isActive: z.boolean().optional(), position: z.number().int().min(0).max(1000).optional(),
  restaurantId: id.nullable().optional(), promotionId: id.nullable().optional(), endsAt: z.string().max(40).nullable().optional(),
}).strict();

/** Service refusals the app turns into an Uzbek sentence. */
const ERRORS: Record<string, [number, string]> = {
  NOM_NOTOGRI: [400, 'NAME_INVALID'], RESTORAN_TOPILMADI: [404, 'NOT_FOUND'], AKSIYA_TOPILMADI: [404, 'NOT_FOUND'], SLAYD_TOPILMADI: [404, 'NOT_FOUND'],
  TAOM_TOPILMADI: [400, 'DISH_INVALID'], AKSIYADA_TAOM_YOQ: [409, 'PROMO_NO_DISHES'], SON_NOTOGRI: [400, 'NUMBER_INVALID'], SANA_NOTOGRI: [400, 'DATE_INVALID'],
  SLAYDDA_RASM_YOQ: [409, 'BANNER_NO_IMAGE'], RASM_NOTOGRI: [400, 'IMAGE_INVALID'],
};

/** DS Admin app: 1+1 promotions and the home-screen slides (news and offers). Replaces the /aksiya bot command for everyday use. */
export async function adminPromoRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (_request, reply) => {
    if (!adminAppEnabled()) return reply.code(404).send({ error: 'NOT_FOUND' });
  });
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });
  app.setErrorHandler((error, _request, reply) => {
    const mapped = error instanceof Error ? ERRORS[error.message] : undefined;
    if (mapped) return reply.code(mapped[0]).send({ error: mapped[1] });
    return reply.send(error);
  });

  app.get('/promo', async request => {
    const s = await requireAdminSession(request);
    return adminPromoOverview(s.telegramUserId);
  });
  app.post('/promo/promotions', async request => {
    const s = await requireAdminSession(request);
    const r = await createPromotion(s.telegramUserId, createPromoSchema.parse(request.body));
    return { ok: true, id: r.id };
  });
  app.put('/promo/promotions/:id', async request => {
    const s = await requireAdminSession(request);
    const { maxFreePerOrder, ...rest } = patchPromoSchema.parse(request.body);
    await updatePromotion(s.telegramUserId, idParams.parse(request.params).id, { ...rest, ...(maxFreePerOrder !== undefined ? { maxFreePerOrder: maxFreePerOrder === 0 ? null : maxFreePerOrder } : {}) });
    return { ok: true };
  });
  app.delete('/promo/promotions/:id', async request => {
    const s = await requireAdminSession(request);
    await deletePromotion(s.telegramUserId, idParams.parse(request.params).id);
    return { ok: true };
  });

  app.post('/promo/banners', async request => {
    const s = await requireAdminSession(request);
    const r = await createBanner(s.telegramUserId, createBannerSchema.parse(request.body));
    return { ok: true, id: r.id };
  });
  app.put('/promo/banners/:id', async request => {
    const s = await requireAdminSession(request);
    await updateBanner(s.telegramUserId, idParams.parse(request.params).id, patchBannerSchema.parse(request.body));
    return { ok: true };
  });
  app.delete('/promo/banners/:id', async request => {
    const s = await requireAdminSession(request);
    await deleteBanner(s.telegramUserId, idParams.parse(request.params).id);
    return { ok: true };
  });
  // The picture is the raw body (image/jpeg|png|webp); authentication runs BEFORE the body is read.
  app.addContentTypeParser([...RECEIPT_TYPES], { parseAs: 'buffer', bodyLimit: BANNER_IMAGE_MAX_BYTES }, (_request, body, done) => done(null, body));
  app.put('/promo/banners/:id/image', { bodyLimit: BANNER_IMAGE_MAX_BYTES, onRequest: async request => { await requireAdminSession(request); } }, async request => {
    const s = await requireAdminSession(request);
    const version = await setBannerImageByAdmin(s.telegramUserId, idParams.parse(request.params).id, request.body as Buffer);
    return { ok: true, version };
  });
  app.get('/promo/banners/:id/image', async (request, reply) => {
    const s = await requireAdminSession(request);
    const img = await readBannerImageForAdmin(s.telegramUserId, idParams.parse(request.params).id);
    if (!img) return reply.code(404).send({ error: 'NOT_FOUND' });
    return reply.header('Content-Type', img.mime).header('X-Content-Type-Options', 'nosniff').send(img.data);
  });
}
