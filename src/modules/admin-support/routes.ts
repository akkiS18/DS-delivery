import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { adminAppEnabled } from '../../lib/features.js';
import { requireAdminSession } from '../admin-auth/routes.js';
import { claimTicket, isSupportAdmin, resolveTicket } from '../support/service.js';
import { addAdminReply, reassignTicket, reopenTicket, MAX_FOLLOWUP } from '../support/conversation.js';
import { adminDisplayName, listInbox, syncSupport, ticketThread } from './service.js';

const idParams = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/) }).strict();
// The phone makes one up per tap and resends the SAME key when it retries: that is what makes a retry harmless.
const clientKey = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const keyOnly = z.object({ clientKey }).strict();
const reassignSchema = z.object({ clientKey, targetTelegramId: z.string().regex(/^\d{1,20}$/) }).strict();
const replySchema = z.object({ clientKey, text: z.string().max(MAX_FOLLOWUP + 200) }).strict();

type AnyResult = { result: string; [k: string]: unknown };

/** DONE and DUPLICATE (a retry that was already applied) are success; NOT_FOUND is 404; every other refusal is a 409 the app explains. */
function respond(reply: FastifyReply, r: AnyResult): unknown {
  if (r.result === 'DONE' || r.result === 'SENT' || r.result === 'DUPLICATE') return { ok: true, result: r.result };
  if (r.result === 'NOT_FOUND') return reply.code(404).send({ error: 'NOT_FOUND' });
  const { result, ...detail } = r;
  return reply.code(409).send({ error: result, ...detail });
}

/** DS Admin app, A4a: the support inbox, the conversation and the ticket actions (take, reply, hand over, resolve, reopen). */
export async function adminSupportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (_request, reply) => {
    if (!adminAppEnabled()) return reply.code(404).send({ error: 'NOT_FOUND' });
  });
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  app.get('/tickets', async request => {
    const s = await requireAdminSession(request);
    return listInbox(s.telegramUserId);
  });

  app.get('/tickets/:id', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const thread = await ticketThread(s.telegramUserId, id);
    if (!thread) return reply.code(404).send({ error: 'NOT_FOUND' });
    return thread;
  });

  app.post('/tickets/:id/claim', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const body = keyOnly.parse(request.body);
    const r = await claimTicket({ actorTelegramId: s.telegramUserId, actorName: await adminDisplayName(s.telegramUserId), ticketId: id, callbackQueryId: `app:${body.clientKey}` });
    if (r.result === 'DONE') await syncSupport(id);
    return respond(reply, r);
  });

  app.post('/tickets/:id/resolve', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const body = keyOnly.parse(request.body);
    const r = await resolveTicket({ actorTelegramId: s.telegramUserId, ticketId: id, callbackQueryId: `app:${body.clientKey}` });
    if (r.result === 'DONE') await syncSupport(id);
    return respond(reply, r);
  });

  app.post('/tickets/:id/reopen', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const body = keyOnly.parse(request.body);
    const r = await reopenTicket({ actorTelegramId: s.telegramUserId, ticketId: id, callbackQueryId: `app:${body.clientKey}` });
    if (r.result === 'DONE') await syncSupport(id);
    return respond(reply, r);
  });

  app.post('/tickets/:id/reassign', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const body = reassignSchema.parse(request.body);
    if (!isSupportAdmin(body.targetTelegramId)) return reply.code(409).send({ error: 'INVALID_TARGET' });
    const targetName = await adminDisplayName(body.targetTelegramId);
    const r = await reassignTicket({ actorTelegramId: s.telegramUserId, ticketId: id, targetTelegramId: body.targetTelegramId, targetName, callbackQueryId: `app:${body.clientKey}` });
    if (r.result === 'DONE') await syncSupport(id);
    return respond(reply, r);
  });

  // Like Telegram's own "Reply" on a ticket message: a ticket nobody has taken yet is taken by the replying administrator first.
  app.post('/tickets/:id/reply', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const body = replySchema.parse(request.body);
    const text = body.text.trim();
    if (!text || text.length > MAX_FOLLOWUP) return reply.code(400).send({ error: 'TEXT_INVALID' });
    const name = await adminDisplayName(s.telegramUserId);
    const open = await ticketThread(s.telegramUserId, id);
    if (!open) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (open.ticket.status === 'OPEN') {
      const c = await claimTicket({ actorTelegramId: s.telegramUserId, actorName: name, ticketId: id, callbackQueryId: `app:${body.clientKey}:claim` });
      if (c.result !== 'DONE' && c.result !== 'DUPLICATE') return respond(reply, c);
    }
    const r = await addAdminReply({ actorTelegramId: s.telegramUserId, actorName: name, ticketId: id, text, clientKey: body.clientKey });
    if (r.result === 'SENT') await syncSupport(id);
    return respond(reply, r);
  });
}
