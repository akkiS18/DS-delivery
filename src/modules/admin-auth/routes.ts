import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { adminAppEnabled } from '../../lib/features.js';
import { authenticate, bearerToken, logout, logoutAll, requestCode, verifyCode } from './service.js';

const idSchema = z.string().regex(/^\d{1,20}$/);
const requestSchema = z.object({ telegramUserId: idSchema }).strict();
const verifySchema = z.object({
  telegramUserId: idSchema,
  code: z.string().regex(/^\d{6}$/),
  deviceName: z.string().max(100).optional(),
}).strict();

export type AdminSessionInfo = { sessionId: string; telegramUserId: string; deviceName: string | null; expiresAt: Date };

function httpError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}

/** Preflight for every protected admin route. The administrator returned here is the ONLY identity routes may use:
 *  bodies, query strings and headers never choose one. */
export async function requireAdminSession(request: FastifyRequest): Promise<AdminSessionInfo> {
  const auth = await authenticate(bearerToken(request.headers.authorization));
  if (auth.ok) return auth;
  throw httpError(401, 'UNAUTHENTICATED');
}

const iso = (d: Date): string => d.toISOString();

/** DS Admin app API. Off (404) unless ADMIN_APP_ENABLED=true. The Telegram bot commands keep working either way. */
export async function adminAuthRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (_request, reply) => {
    if (!adminAppEnabled()) return reply.code(404).send({ error: 'NOT_FOUND' });
  });
  // Tokens and codes must never be cached by proxies or logged.
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  app.post('/auth/request-code', async (request, reply) => {
    const body = requestSchema.parse(request.body);
    const r = await requestCode({ telegramUserId: body.telegramUserId, ip: request.ip });
    if (r.result === 'LOCKED') {
      return reply.code(429).header('Retry-After', String(r.retryAfterSeconds)).send({ error: 'TOO_MANY_ATTEMPTS', retryAfterSeconds: r.retryAfterSeconds });
    }
    return reply.code(202).send({ ok: true, validMinutes: r.validMinutes });
  });

  app.post('/auth/verify', async (request, reply) => {
    const body = verifySchema.parse(request.body);
    const r = await verifyCode({ telegramUserId: body.telegramUserId, code: body.code, deviceName: body.deviceName, ip: request.ip });
    if (r.result === 'OK') {
      return reply.send({ accessToken: r.token, tokenType: 'Bearer', expiresAt: iso(r.expiresAt), admin: { telegramUserId: body.telegramUserId } });
    }
    if (r.result === 'LOCKED') {
      return reply.code(429).header('Retry-After', String(r.retryAfterSeconds)).send({ error: 'TOO_MANY_ATTEMPTS', retryAfterSeconds: r.retryAfterSeconds });
    }
    return reply.code(401).send({ error: 'INVALID_CODE' });
  });

  app.get('/auth/me', async request => {
    const s = await requireAdminSession(request);
    return { admin: { telegramUserId: s.telegramUserId }, session: { deviceName: s.deviceName, expiresAt: iso(s.expiresAt) } };
  });

  app.post('/auth/logout', async (request, reply) => {
    const s = await requireAdminSession(request);
    await logout(s.sessionId, s.telegramUserId);
    return reply.code(204).send();
  });

  app.post('/auth/logout-all', async request => {
    const s = await requireAdminSession(request);
    return { closed: await logoutAll(s.telegramUserId) };
  });
}
