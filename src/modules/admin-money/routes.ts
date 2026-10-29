import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { adminAppEnabled } from '../../lib/features.js';
import { requireAdminSession } from '../admin-auth/routes.js';
import { addPlatformCard, setCollectsToPlatform } from '../payment/pool-admin.js';
import { REVIEW_ACTIONS } from '../payment/review-reasons.js';
import { handleReview } from '../payment/review.js';
import { decideCard } from '../restaurant-cards/service.js';
import { cardDetail, cardList, moneySnapshot, poolSnapshot } from './service.js';

const idRe = /^[A-Za-z0-9_-]{1,40}$/;
const idParams = z.object({ id: z.string().regex(idRe) }).strict();
const handleSchema = z.object({ action: z.enum(REVIEW_ACTIONS), note: z.string().max(1000) }).strict();
const decisionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']) }).strict();
// The number is validated (length, Luhn) by addPlatformCard; here only its shape, so a huge body never reaches the service.
const platformCardSchema = z.object({ number: z.string().max(40), holderName: z.string().max(60) }).strict();
const collectSchema = z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/), on: z.boolean() }).strict();

/** DS Admin app, A2: money review, card approval, platform card pool. Same switch and sessions as the other admin routes. */
export async function adminMoneyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (_request, reply) => {
    if (!adminAppEnabled()) return reply.code(404).send({ error: 'NOT_FOUND' });
  });
  // Card numbers must never be cached by a proxy or the phone.
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  app.get('/money', async request => {
    await requireAdminSession(request);
    return moneySnapshot();
  });

  app.post('/money/reviews/:id/handle', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const body = handleSchema.parse(request.body);
    try {
      const r = await handleReview({ incomingId: id, adminId: s.telegramUserId, action: body.action, note: body.note });
      if (r.result === 'NOT_FOUND') return reply.code(404).send({ error: 'NOT_FOUND' });
      return { ok: true, result: r.result };
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      if (code === 'ADMIN_IZOH_NOTOGRI') return reply.code(400).send({ error: 'NOTE_INVALID', message: 'Izoh 10–300 belgi bo‘lsin.' });
      if (code === 'AMAL_NOTOGRI') return reply.code(400).send({ error: 'ACTION_INVALID' });
      throw e;
    }
  });

  app.get('/cards', async request => {
    await requireAdminSession(request);
    return { cards: await cardList() };
  });

  app.get('/cards/:id', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const c = await cardDetail(id);
    if (!c) return reply.code(404).send({ error: 'NOT_FOUND' });
    // Showing a full card number is itself a sensitive act: leave a trace of who looked.
    if (c.number) {
      await db.adminAuditEvent.create({ data: { actorId: s.telegramUserId, action: 'CARD_NUMBER_VIEWED', targetType: 'Card', targetId: c.id, details: { last4: c.last4 } } });
    }
    return c;
  });

  app.post('/cards/:id/decision', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const body = decisionSchema.parse(request.body);
    const r = await decideCard({ cardId: id, adminId: s.telegramUserId, decision: body.decision });
    if (!('card' in r)) {
      return r.result === 'NOT_FOUND' ? reply.code(404).send({ error: 'NOT_FOUND' }) : reply.code(409).send({ error: 'ALREADY_DECIDED', status: r.status ?? null });
    }
    await db.adminAuditEvent.create({ data: { actorId: s.telegramUserId, action: r.result === 'APPROVED' ? 'CARD_APPROVED' : 'CARD_REJECTED', targetType: 'Card', targetId: r.card.id, details: { last4: r.card.last4, via: 'admin-app' } } });
    return { ok: true, result: r.result, last4: r.card.last4 };
  });

  app.get('/pool', async request => {
    await requireAdminSession(request);
    return poolSnapshot();
  });

  app.post('/pool/cards', async (request, reply) => {
    const s = await requireAdminSession(request);
    const body = platformCardSchema.parse(request.body);
    const r = await addPlatformCard({ adminId: s.telegramUserId, number: body.number, holderName: body.holderName });
    if (r.ok) return reply.code(201).send({ ok: true, cardId: r.cardId, last4: r.last4 });
    return reply.code(r.code === 'CARD_TAKEN' ? 409 : 400).send({ error: r.code });
  });

  app.post('/pool/collect', async (request, reply) => {
    const s = await requireAdminSession(request);
    const body = collectSchema.parse(request.body);
    const r = await setCollectsToPlatform({ adminId: s.telegramUserId, slug: body.slug, on: body.on });
    if (r.result === 'NOT_FOUND') return reply.code(404).send({ error: 'NOT_FOUND' });
    if (r.result === 'NO_POOL_CARD') return reply.code(409).send({ error: 'NO_POOL_CARD' });
    if (r.result === 'OPEN_PAYMENTS') return reply.code(409).send({ error: 'OPEN_PAYMENTS', name: r.name, count: r.count });
    return { ok: true, result: r.result, name: r.name };
  });
}
