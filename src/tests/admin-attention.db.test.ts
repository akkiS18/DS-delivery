import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { hashToken } from '../modules/admin-auth/service.js';
import { QUIET_KEY } from '../modules/admin-attention/service.js';
import { deliverAttention } from '../bot/attention-notify.js';

// DS Admin "Diqqat" (A1 server side). Needs a *_test database (the repo's DB guard). Uses only uniquely named rows and removes only them
// (AdminAuditEvent is append-only: its rows stay, under a unique actor id).
const db = new PrismaClient();
const app = buildApp(new PaymentEngineV3(db, defaultOptions, () => {}));
const tag = randomUUID().slice(0, 8);
const adminId = `9${randomInt(100_000_000, 999_999_999)}${randomInt(100, 999)}`;
const token = randomBytes(32).toString('base64url');
const minutesAgo = (m: number): Date => new Date(Date.now() - m * 60_000);
const auth = { authorization: `Bearer ${token}` };
const api = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object, headers: Record<string, string> = auth) =>
  app.inject({ method, url: `/api/v1/admin${url}`, headers, ...(payload ? { payload } : {}) });

const saved = { ...process.env };
let previousQuiet: string | null = null;
const ids = { restaurant: '', customer: '', unseen: '', cash: '', ticketOrder: '' };

before(async () => {
  await db.$connect();
  process.env.ADMIN_APP_ENABLED = 'true';
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = adminId;
  delete process.env.SUPPORT_ADMIN_2_TELEGRAM_ID;
  await db.adminSession.create({ data: { tokenHash: hashToken(token), telegramUserId: adminId, expiresAt: new Date(Date.now() + 3_600_000) } });
  previousQuiet = (await db.platformSetting.findUnique({ where: { key: QUIET_KEY } }))?.value ?? null;
  await db.platformSetting.deleteMany({ where: { key: QUIET_KEY } }); // start from the default window
  const r = await db.restaurant.create({ data: { slug: `attn-${tag}`, name: `Diqqat ${tag}`, pickupPhone: '+998901234567' } });
  const c = await db.customer.create({ data: { displayName: `attn-${tag}` } });
  ids.restaurant = r.id; ids.customer = c.id;
  const mk = async (data: Record<string, unknown>, payment: { method: string; status: string }) => {
    const o = await db.order.create({ data: { restaurantId: r.id, customerId: c.id, addressText: 'test', totalSom: 55_000, createdViaBot: true, ...data } as never });
    await db.payment.create({ data: { orderId: o.id, restaurantId: r.id, amountTiyin: 5_500_000n, method: payment.method, status: payment.status, isTest: true } });
    return o.id;
  };
  // A paid card order the kitchen has not acknowledged for 10 minutes, and a cash order nobody accepted for 10 minutes.
  ids.unseen = await mk({ status: 'PREPARING', createdAt: minutesAgo(30), preparingStartedAt: minutesAgo(10), paymentVerifiedAt: minutesAgo(10) }, { method: 'CARD', status: 'CONFIRMED_MANUAL' });
  ids.cash = await mk({ status: 'PAYMENT_PENDING', createdAt: minutesAgo(10) }, { method: 'CASH', status: 'CASH_PENDING' });
});

after(async () => {
  const ors = [ids.unseen, ids.cash];
  await db.payment.deleteMany({ where: { orderId: { in: ors } } });
  await db.order.deleteMany({ where: { id: { in: ors } } });
  await db.restaurantSession.deleteMany({ where: { restaurantId: ids.restaurant } });
  await db.restaurant.deleteMany({ where: { id: ids.restaurant } });
  await db.customer.deleteMany({ where: { id: ids.customer } });
  await db.adminAttentionAck.deleteMany({ where: { OR: [{ ackedBy: adminId }, { key: { contains: ids.unseen } }, { key: { contains: ids.cash } }] } });
  await db.notificationLog.deleteMany({ where: { chatId: adminId } }).catch(() => undefined);
  await db.adminSession.deleteMany({ where: { telegramUserId: adminId } });
  await db.platformSetting.deleteMany({ where: { key: QUIET_KEY } });
  if (previousQuiet !== null) await db.platformSetting.create({ data: { key: QUIET_KEY, value: previousQuiet } });
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  await app.close();
  await db.$disconnect();
});

const mine = async () => {
  const r = await api('GET', '/attention');
  assert.equal(r.statusCode, 200);
  const body = r.json();
  return { body, items: (body.items as Array<Record<string, any>>).filter(i => i.restaurant?.id === ids.restaurant) };
};

test('the list needs an admin session and the switch (404 when off, 401 without or with a bad token)', async () => {
  assert.equal((await api('GET', '/attention', undefined, {})).statusCode, 401);
  assert.equal((await api('GET', '/attention', undefined, { authorization: `Bearer ${'x'.repeat(43)}` })).statusCode, 401);
  assert.equal((await api('POST', '/attention/ack', { key: 'ORDER_UNSEEN:x' }, {})).statusCode, 401);
  process.env.ADMIN_APP_ENABLED = 'false';
  try { assert.equal((await api('GET', '/attention')).statusCode, 404); } finally { process.env.ADMIN_APP_ENABLED = 'true'; }
});

test('stuck orders appear with the restaurant phone, the right kind, severity and an alarm', async () => {
  const { body, items } = await mine();
  const byKind = Object.fromEntries(items.map(i => [i.kind, i]));
  assert.equal(byKind.ORDER_UNSEEN.key, `ORDER_UNSEEN:${ids.unseen}`);
  assert.equal(byKind.ORDER_UNSEEN.severity, 'CRITICAL');
  assert.equal(byKind.ORDER_UNSEEN.restaurant.phone, '+998901234567');
  assert.equal(byKind.ORDER_UNSEEN.alarm, true);
  assert.ok(byKind.ORDER_UNSEEN.ageSeconds >= 590);
  assert.equal(byKind.CASH_UNACCEPTED.key, `CASH_UNACCEPTED:${ids.cash}`);
  assert.ok(byKind.RESTAURANT_OFFLINE, 'no app of this restaurant reported in');
  assert.equal(byKind.RESTAURANT_OFFLINE.severity, 'HIGH');
  assert.equal(body.quiet.from, '01:00'); // default window
  assert.ok(body.counts.total >= 3 && body.counts.alarming >= 3);
  const order = body.items.map((i: any) => i.severity);
  assert.deepEqual(order, [...order].sort((a: string, b: string) => ({ CRITICAL: 0, HIGH: 1, MEDIUM: 2 } as any)[a] - ({ CRITICAL: 0, HIGH: 1, MEDIUM: 2 } as any)[b]), 'critical first');
});

test('a restaurant app that reports in removes the "offline" item; acknowledging the kitchen removes the "unseen" item', async () => {
  await db.restaurantSession.create({ data: { tokenHash: `attn-${tag}`, restaurantId: ids.restaurant, passwordVersion: 1, expiresAt: new Date(Date.now() + 3_600_000), lastSeenAt: new Date() } });
  let { items } = await mine();
  assert.equal(items.some(i => i.kind === 'RESTAURANT_OFFLINE'), false);
  await db.order.update({ where: { id: ids.unseen }, data: { prepChosenMinutes: 15, prepChosenAt: new Date() } });
  ({ items } = await mine());
  assert.equal(items.some(i => i.kind === 'ORDER_UNSEEN'), false, 'the item disappears by itself once its cause is gone');
  await db.order.update({ where: { id: ids.unseen }, data: { prepChosenMinutes: null, prepChosenAt: null } });
  assert.equal((await mine()).items.some(i => i.kind === 'ORDER_UNSEEN'), true);
  await db.restaurantSession.deleteMany({ where: { restaurantId: ids.restaurant } });
});

test('"called" silences one item for a while, is audited, and rejects malformed keys', async () => {
  const key = `CASH_UNACCEPTED:${ids.cash}`;
  assert.equal((await api('POST', '/attention/ack', { key: 'bad key' })).statusCode, 400);
  assert.equal((await api('POST', '/attention/ack', { key, minutes: 0 })).statusCode, 400);
  assert.equal((await api('POST', '/attention/ack', { key, extra: 1 })).statusCode, 400);
  const r = await api('POST', '/attention/ack', { key, minutes: 30 });
  assert.equal(r.statusCode, 200);
  const { items } = await mine();
  const cash = items.find(i => i.kind === 'CASH_UNACCEPTED')!;
  assert.equal(cash.acked, true);
  assert.equal(cash.alarm, false);
  assert.ok(Date.parse(cash.snoozeUntil) > Date.now() + 29 * 60_000);
  assert.equal(items.find(i => i.kind === 'ORDER_UNSEEN')!.alarm, true, 'other items keep ringing');
  assert.equal(await db.adminAuditEvent.count({ where: { actorId: adminId, action: 'ATTENTION_ACK', targetId: key } }), 1);
  // an expired snooze rings again
  await db.adminAttentionAck.update({ where: { key }, data: { snoozeUntil: new Date(Date.now() - 1000) } });
  assert.equal((await mine()).items.find(i => i.kind === 'CASH_UNACCEPTED')!.alarm, true);
});

test('quiet hours: only critical items still ring, nothing is hidden; invalid windows are refused; "off" works', async () => {
  assert.equal((await api('PUT', '/attention/quiet-hours', { from: '25:00', to: '07:00' })).statusCode, 400);
  assert.equal((await api('PUT', '/attention/quiet-hours', { from: '00:00' })).statusCode, 400);
  const r = await api('PUT', '/attention/quiet-hours', { from: '00:00', to: '23:59' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().quietActive, true);
  let { body, items } = await mine();
  assert.equal(body.quietActive, true);
  assert.equal(items.find(i => i.kind === 'ORDER_UNSEEN')!.alarm, true);
  const offline = items.find(i => i.kind === 'RESTAURANT_OFFLINE')!;
  assert.equal(offline.alarm, false, 'HIGH is silent in quiet hours');
  assert.ok(offline, 'but it is still listed');
  assert.equal((await api('PUT', '/attention/quiet-hours', { off: true })).json().quiet, null);
  ({ body, items } = await mine());
  assert.equal(body.quietActive, false);
  assert.equal(items.find(i => i.kind === 'RESTAURANT_OFFLINE')!.alarm, true);
  assert.equal(await db.adminAuditEvent.count({ where: { actorId: adminId, action: 'ADMIN_QUIET_HOURS' } }), 2, 'only the two valid changes are audited');
});

test('Telegram copy: one message per item, silent for non-critical items in quiet hours, nothing for acknowledged items', async () => {
  const sent: Array<{ chatId: string; text: string; extra?: any }> = [];
  const bot = { telegram: { sendMessage: async (chatId: string, text: string, extra?: never) => { sent.push({ chatId, text, extra }); return { message_id: sent.length }; } } };
  const only = (i: { restaurant: { id: string } | null }) => i.restaurant?.id === ids.restaurant;
  await db.adminAttentionAck.upsert({ where: { key: `CASH_UNACCEPTED:${ids.cash}` }, create: { key: `CASH_UNACCEPTED:${ids.cash}`, ackedBy: adminId, snoozeUntil: new Date(Date.now() + 600_000) }, update: { snoozeUntil: new Date(Date.now() + 600_000) } });
  await api('PUT', '/attention/quiet-hours', { from: '00:00', to: '23:59' });
  const n1 = await deliverAttention(bot, new Date(), only);
  assert.equal(n1, 2, 'unseen order + offline restaurant; the acknowledged cash order is skipped');
  assert.ok(sent.every(m => m.chatId === adminId));
  const unseen = sent.find(m => m.text.includes('körmadi'))!;
  assert.ok(unseen.text.includes('+998901234567') && unseen.text.includes(`Diqqat ${tag}`));
  assert.equal(unseen.extra.disable_notification, undefined, 'critical stays loud');
  const offline = sent.find(m => m.text.includes('aloqada emas'))!;
  assert.equal(offline.extra.disable_notification, true, 'HIGH is silent during quiet hours');
  assert.equal(await deliverAttention(bot, new Date(), only), 0, 'the same items are never announced twice');
  await api('PUT', '/attention/quiet-hours', { off: true });
});
