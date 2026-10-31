import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { adminAppEnabled } from '../../lib/features.js';
import { requireAdminSession } from '../admin-auth/routes.js';
import { commissionStatements, settleRestaurant } from '../commission/settlement.js';
import { setCashEnabled, setCashMaxOrderSom } from '../payment/method.js';
import { setRealPaymentsOpen } from '../platform/settings.js';
import { FEE_MODES } from '../pricing/fee.js';
import { setFeeMode } from '../pricing/config.js';
import { listRestaurantsForAdmin, setRestaurantActive } from '../restaurant/admin.js';
import { setRankingEnabled } from '../ratings/service.js';
import { setTaxiMode } from '../taxi/mode.js';
import { notifyAdmins, ratingsSnapshot, settingsSnapshot } from './service.js';

const idParams = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/) }).strict();
const paymentsSchema = z.object({ open: z.boolean() }).strict();
const cashSchema = z.object({ enabled: z.boolean() }).strict();
const cashMaxSchema = z.object({ maxOrderSom: z.number().int().min(10_000).max(100_000_000) }).strict();
const rankingSchema = z.object({ enabled: z.boolean() }).strict();
const taxiSchema = z.object({ mode: z.enum(['READY', 'LEAD']) }).strict();
// percent is 1..25 with at most two decimals (the service stores basis points).
const feeSchema = z.object({
  mode: z.enum(FEE_MODES as unknown as [string, ...string[]]),
  percent: z.number().min(1).max(25).refine(p => Math.round(p * 100) / 100 === p, 'at most two decimals').optional(),
  /** LINE mode: the platform line in som (1 000 - 50 000) and whether it is waived (shown crossed out as a discount). */
  lineSom: z.number().int().min(1000).max(50_000).optional(),
  lineWaived: z.boolean().optional(),
}).strict();
const activeSchema = z.object({ active: z.boolean() }).strict();
const settleSchema = z.object({
  expectedCount: z.number().int().min(1).max(1_000_000),
  expectedSom: z.number().int().min(0).max(10_000_000_000),
  note: z.string().max(1000),
}).strict();

/** DS Admin app, A3a: platform settings, restaurant on/off, commission. Same switch and sessions as the other admin routes. */
export async function adminPlatformRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (_request, reply) => {
    if (!adminAppEnabled()) return reply.code(404).send({ error: 'NOT_FOUND' });
  });
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  app.get('/settings', async request => {
    await requireAdminSession(request);
    return settingsSnapshot();
  });

  // Opening or closing REAL payments is the most serious switch there is: the app asks twice, the server refuses while any blocker is
  // present (same rules as /payments), writes the audit row, and tells every administrator on Telegram.
  app.put('/settings/payments', async (request, reply) => {
    const s = await requireAdminSession(request);
    const body = paymentsSchema.parse(request.body);
    const r = await setRealPaymentsOpen({ adminId: s.telegramUserId, open: body.open });
    if (r.result === 'BLOCKED') return reply.code(409).send({ error: 'BLOCKED', blockers: r.blockers });
    if (r.result === 'CHANGED') {
      await notifyAdmins(body.open ? '🟢 Real to‘lov ochildi (DS Admin ilovasi).' : '🔴 Real to‘lov yopildi (DS Admin ilovasi).');
    }
    return { ok: true, result: r.result, settings: await settingsSnapshot() };
  });

  app.put('/settings/cash', async request => {
    const s = await requireAdminSession(request);
    const body = cashSchema.parse(request.body);
    const result = await setCashEnabled({ adminId: s.telegramUserId, enabled: body.enabled });
    if (result === 'CHANGED') await notifyAdmins(body.enabled ? '🟢 Naqd to‘lov yoqildi (DS Admin ilovasi).' : '🔴 Naqd to‘lov o‘chirildi (DS Admin ilovasi).');
    return { ok: true, result, settings: await settingsSnapshot() };
  });

  // The largest food total accepted in cash: set here by the administrator (owner decision 2026-10-31), applies to NEW orders only.
  app.put('/settings/cash-max', async request => {
    const s = await requireAdminSession(request);
    const body = cashMaxSchema.parse(request.body);
    const result = await setCashMaxOrderSom({ adminId: s.telegramUserId, maxOrderSom: body.maxOrderSom });
    if (result === 'CHANGED') await notifyAdmins(`💵 Naqd buyurtmaning eng katta summasi: ${body.maxOrderSom.toLocaleString('en-US').replace(/,/g, ' ')} so‘m (DS Admin ilovasi).`);
    return { ok: true, result, settings: await settingsSnapshot() };
  });

  app.put('/settings/fee', async (request, reply) => {
    const s = await requireAdminSession(request);
    const body = feeSchema.parse(request.body);
    try {
      const r = await setFeeMode({
        adminId: s.telegramUserId, mode: body.mode as (typeof FEE_MODES)[number],
        ...(body.percent !== undefined ? { percentBp: Math.round(body.percent * 100) } : {}),
        ...(body.lineSom !== undefined ? { lineSom: body.lineSom } : {}),
        ...(body.lineWaived !== undefined ? { lineWaived: body.lineWaived } : {}),
      });
      if (r.result === 'CHANGED') await notifyAdmins(`🧾 Xizmat haqi o‘zgardi: ${body.mode}${body.percent !== undefined ? ` ${body.percent}%` : ''}${body.mode === 'LINE' ? (r.config.lineWaived ? ` ${r.config.lineSom} so‘m — chegirma (bepul)` : ` ${r.config.lineSom} so‘m`) : ''} (DS Admin ilovasi).`);
      return { ok: true, result: r.result, settings: await settingsSnapshot() };
    } catch (e) {
      if (e instanceof Error && e.message === 'XIZMAT_HAQI_FOIZI_NOTOGRI') return reply.code(400).send({ error: 'PERCENT_INVALID' });
      throw e;
    }
  });

  app.put('/settings/taxi-mode', async request => {
    const s = await requireAdminSession(request);
    const body = taxiSchema.parse(request.body);
    const result = await setTaxiMode({ adminId: s.telegramUserId, mode: body.mode });
    return { ok: true, result, settings: await settingsSnapshot() };
  });

  app.put('/settings/ranking', async request => {
    const s = await requireAdminSession(request);
    const body = rankingSchema.parse(request.body);
    const result = await setRankingEnabled({ adminId: s.telegramUserId, enabled: body.enabled });
    return { ok: true, result, settings: await settingsSnapshot() };
  });

  app.get('/ratings', async request => {
    const s = await requireAdminSession(request);
    return ratingsSnapshot(s.telegramUserId);
  });

  app.get('/restaurants', async request => {
    await requireAdminSession(request);
    return { restaurants: await listRestaurantsForAdmin() };
  });

  app.put('/restaurants/:id/active', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const body = activeSchema.parse(request.body);
    const r = await setRestaurantActive({ restaurantId: id, active: body.active, adminId: s.telegramUserId });
    if (r.result === 'NOT_FOUND') return reply.code(404).send({ error: 'NOT_FOUND' });
    if (r.result === 'CHANGED') {
      const name = (await listRestaurantsForAdmin()).find(x => x.id === id)?.name ?? 'Restoran';
      await notifyAdmins(body.active ? `✅ ${name} yoqildi (DS Admin ilovasi).` : `⛔ ${name} to‘xtatildi (DS Admin ilovasi).`);
    }
    return { ok: true, result: r.result, signedOut: r.signedOut ?? 0 };
  });

  app.get('/commission', async request => {
    await requireAdminSession(request);
    return { statements: await commissionStatements() };
  });

  // The administrator confirmed `expectedCount` / `expectedSom` on screen after seeing the money in the bank; if the set changed since,
  // nothing is recorded (409 CHANGED with the new numbers). This records a verification: no money moves here.
  app.post('/commission/:id/settle', async (request, reply) => {
    const s = await requireAdminSession(request);
    const { id } = idParams.parse(request.params);
    const body = settleSchema.parse(request.body);
    try {
      const r = await settleRestaurant({ restaurantId: id, adminId: s.telegramUserId, expectedCount: body.expectedCount, expectedSom: body.expectedSom, note: body.note });
      if (r.result === 'SETTLED') return { ok: true, settlementNumber: r.settlementNumber, count: r.count, amountSom: r.amountSom };
      if (r.result === 'CHANGED') return reply.code(409).send({ error: 'CHANGED', count: r.count, amountSom: r.amountSom });
      return reply.code(409).send({ error: 'NOTHING_DUE' });
    } catch (e) {
      if (e instanceof Error && e.message === 'ADMIN_IZOH_NOTOGRI') return reply.code(400).send({ error: 'NOTE_INVALID', message: 'Izoh 10–300 belgi bo‘lsin.' });
      throw e;
    }
  });
}
