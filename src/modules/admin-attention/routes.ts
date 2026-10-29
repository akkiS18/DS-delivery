import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { adminAppEnabled } from '../../lib/features.js';
import { requireAdminSession } from '../admin-auth/routes.js';
import { ATTENTION_KEY_RE, ackAttention, computeAttention, isHHMM, setQuietHours } from './service.js';

const ackSchema = z.object({
  key: z.string().regex(ATTENTION_KEY_RE),
  minutes: z.number().int().min(1).max(720).optional(),
}).strict();

const quietSchema = z.union([
  z.object({ off: z.literal(true) }).strict(),
  z.object({ from: z.string().refine(isHHMM), to: z.string().refine(isHHMM) }).strict(),
]);

/** DS Admin app: the "Diqqat" list. Same switch and sessions as the sign-in routes (404 unless ADMIN_APP_ENABLED=true). */
export async function adminAttentionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (_request, reply) => {
    if (!adminAppEnabled()) return reply.code(404).send({ error: 'NOT_FOUND' });
  });
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  app.get('/attention', async request => {
    await requireAdminSession(request);
    return computeAttention();
  });

  app.post('/attention/ack', async request => {
    const s = await requireAdminSession(request);
    const body = ackSchema.parse(request.body);
    const r = await ackAttention({ adminId: s.telegramUserId, key: body.key, minutes: body.minutes });
    return { ok: true, snoozeUntil: r.snoozeUntil.toISOString() };
  });

  app.put('/attention/quiet-hours', async request => {
    const s = await requireAdminSession(request);
    const body = quietSchema.parse(request.body);
    await setQuietHours({ adminId: s.telegramUserId, quiet: 'off' in body ? null : { from: body.from, to: body.to } });
    return computeAttention().then(x => ({ ok: true, quiet: x.quiet, quietActive: x.quietActive }));
  });
}
