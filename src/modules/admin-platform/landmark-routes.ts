import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { adminAppEnabled } from '../../lib/features.js';
import { requireAdminSession } from '../admin-auth/routes.js';
import { AREA, KINDS } from '../landmarks/geo.js';
import { adminLandmarks, createLandmark, deleteLandmark, updateLandmark } from '../landmarks/service.js';

const idParams = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/) }).strict();
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const createSchema = z.object({ name: z.string().max(100), kind: z.string().max(30), lat, lng }).strict();
const patchSchema = z.object({ name: z.string().max(100).optional(), kind: z.string().max(30).optional(), lat: lat.optional(), lng: lng.optional(), isActive: z.boolean().optional() }).strict();

/** Service refusals the app turns into an Uzbek sentence. */
const ERRORS: Record<string, [number, string]> = {
  NOM_NOTOGRI: [400, 'NAME_INVALID'], TUR_NOTOGRI: [400, 'KIND_INVALID'], HUDUDDAN_TASHQARI: [400, 'OUT_OF_AREA'],
  JOY_TOPILMADI: [404, 'NOT_FOUND'], LANDMARK_EXISTS: [409, 'LANDMARK_EXISTS'], JOYLAR_LIMITI: [409, 'LANDMARK_LIMIT'],
};

/** DS Admin app: the places (market, mosque, school...) customers and taxi drivers orient by. */
export async function adminLandmarkRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (_request, reply) => {
    if (!adminAppEnabled()) return reply.code(404).send({ error: 'NOT_FOUND' });
  });
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });
  app.setErrorHandler((error, _request, reply) => {
    const mapped = error instanceof Error ? ERRORS[error.message] : undefined;
    if (mapped) return reply.code(mapped[0]).send({ error: mapped[1] });
    return reply.send(error);
  });

  app.get('/landmarks', async request => {
    const s = await requireAdminSession(request);
    return { landmarks: await adminLandmarks(s.telegramUserId), kinds: KINDS, area: AREA };
  });
  app.post('/landmarks', async request => {
    const s = await requireAdminSession(request);
    const r = await createLandmark(s.telegramUserId, createSchema.parse(request.body));
    return { ok: true, id: r.id };
  });
  app.put('/landmarks/:id', async request => {
    const s = await requireAdminSession(request);
    await updateLandmark(s.telegramUserId, idParams.parse(request.params).id, patchSchema.parse(request.body));
    return { ok: true };
  });
  app.delete('/landmarks/:id', async request => {
    const s = await requireAdminSession(request);
    await deleteLandmark(s.telegramUserId, idParams.parse(request.params).id);
    return { ok: true };
  });
}
