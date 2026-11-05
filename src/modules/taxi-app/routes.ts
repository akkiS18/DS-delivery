import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticateTaxi, bearerToken, LOGIN_RE, loginTaxi, logoutTaxi, type PublicTaxiCompany } from './auth.js';
import { windowsClientConfig } from './client-config.js';
import { act, getRequest, listRequests, TaxiAppError } from './service.js';

const loginSchema = z.object({ login: z.string().regex(LOGIN_RE), password: z.string().min(1).max(200) }).strict();
const actionSchema = z.object({ action: z.enum(['ACCEPT', 'SENT', 'NO_TAXI', 'DELIVERED']) }).strict();
const idSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/) });

type Session = { sessionId: string; expiresAt: Date; company: PublicTaxiCompany };

function httpError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}

/** Preflight for every protected taxi route. The company returned here is the ONLY one routes may use. */
export async function requireTaxiSession(request: FastifyRequest): Promise<Session> {
  const auth = await authenticateTaxi(bearerToken(request.headers.authorization));
  if (auth.ok) return auth;
  throw httpError(auth.reason === 'COMPANY_INACTIVE' ? 403 : 401, auth.reason);
}

/** DS Taxi app API (/api/v1/taxi). The app polls GET /requests every few seconds while its dispatch service runs; that poll is also its heartbeat. */
export async function taxiAppRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  // Public and read-only: the desktop program asks it before sign-in (oldest allowed version, where to download the new one). No company data.
  app.get('/client-config', async () => ({ windows: windowsClientConfig() }));

  app.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const r = await loginTaxi({ login: body.login, password: body.password, ip: request.ip });
    if (r.result === 'OK') return reply.send({ accessToken: r.token, tokenType: 'Bearer', expiresAt: r.expiresAt.toISOString(), company: r.company });
    if (r.result === 'LOCKED') {
      return reply.code(429).header('Retry-After', String(r.retryAfterSeconds)).send({ error: 'TOO_MANY_ATTEMPTS', retryAfterSeconds: r.retryAfterSeconds });
    }
    if (r.result === 'INACTIVE') return reply.code(403).send({ error: 'COMPANY_INACTIVE' });
    return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
  });

  app.post('/auth/logout', async (request, reply) => {
    const session = await requireTaxiSession(request);
    await logoutTaxi(session.sessionId);
    return reply.code(204).send();
  });

  app.get('/auth/me', async request => {
    const session = await requireTaxiSession(request);
    return { company: session.company, session: { expiresAt: session.expiresAt.toISOString() } };
  });

  app.get('/requests', async request => {
    const session = await requireTaxiSession(request);
    return { company: session.company, ...(await listRequests(session.company.id)) };
  });

  app.get('/requests/:id', async (request, reply) => {
    const session = await requireTaxiSession(request);
    const { id } = idSchema.parse(request.params);
    const view = await getRequest(session.company.id, id);
    if (!view) return reply.code(404).send({ error: 'TAKSI_SOROVI_TOPILMADI' });
    return { request: view };
  });

  app.post('/requests/:id/action', async (request, reply) => {
    const session = await requireTaxiSession(request);
    const { id } = idSchema.parse(request.params);
    const { action } = actionSchema.parse(request.body);
    try {
      return await act(session.company.id, id, action);
    } catch (err) {
      if (err instanceof TaxiAppError) return reply.code(err.status).send({ error: err.code, message: err.message });
      throw err;
    }
  });
}
