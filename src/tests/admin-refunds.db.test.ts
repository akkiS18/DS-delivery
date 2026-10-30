import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { hashToken } from '../modules/admin-auth/service.js';
import { computeAttention } from '../modules/admin-attention/service.js';
import { markRefundSent } from '../modules/refunds/service.js';

// DS Admin A4c (refunds). Needs a *_test database (the repo's DB guard). Only synthetic orders; every row it makes is removed again and the
// audit table is append-only (rows stay under a unique actor id).
const db = new PrismaClient();
const app = buildApp(new PaymentEngineV3(db, defaultOptions, () => {}));
const tag = randomUUID().slice(0, 8);
const adminId = `9${randomInt(100_000_000, 999_999_999)}${randomInt(100, 999)}`;
const token = randomBytes(32).toString('base64url');
const auth = { authorization: `Bearer ${token}` };
const api = (method: 'GET' | 'POST', url: string, payload?: object, headers: Record<string, string> = auth) =>
  app.inject({ method, url: `/api/v1/admin${url}`, headers, ...(payload ? { payload } : {}) });

const saved = { ...process.env };
const orders: string[] = [];
const ids = { restaurant: '', customer: '', poolCard: '' };
const NOTE = 'Restoran hisobi ko‘chirmasi va mijoz bilan telefonda tekshirildi';

/** `pool`: the customer paid onto a PLATFORM card (the platform holds the money), so the administrator refunds it. */
async function refund(status: string, pool = false) {
  const order = await db.order.create({ data: {
    restaurantId: ids.restaurant, customerId: ids.customer, addressText: 'x', totalSom: 40_000, createdViaBot: true, status: 'CANCELLED', paymentIsTest: true,
    payment: { create: { restaurantId: ids.restaurant, amountTiyin: 4_000_000n, status: 'CONFIRMED_MANUAL', isTest: true, ...(pool ? { cardId: ids.poolCard } : {}) } },
  }, include: { payment: true } });
  orders.push(order.id);
  const r = await db.refundRequest.create({ data: {
    orderId: order.id, paymentId: order.payment!.id, kind: 'CUSTOMER_CANCEL', status, reasonCode: 'CHANGED_MIND', paidAmountTiyin: 4_000_000n, approvedAmountTiyin: 4_000_000n,
    orderStatusBefore: 'PREPARING', paymentStatusAtRequest: 'CONFIRMED_MANUAL', requestedBy: 'test', requestedByType: 'CUSTOMER',
    // a refund that was sent carries its proof (a database check demands it); the old typed bank reference is enough for a fixture
    ...(['SENT', 'DISPUTED', 'CONFIRMED'].includes(status) ? { sentBy: 'staff', sentAt: new Date(Date.now() - 60_000), bankReference: 'TEST-REF-1234' } : {}),
    ...(status === 'DISPUTED' ? { disputedAt: new Date() } : {}),
    ...(status === 'CONFIRMED' ? { confirmedBy: 'cust', confirmedByType: 'CUSTOMER', confirmedAt: new Date() } : {}),
  } });
  return { orderId: order.id, id: r.id, number: r.number };
}

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  process.env.ADMIN_APP_ENABLED = 'true';
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = adminId;
  delete process.env.SUPPORT_ADMIN_2_TELEGRAM_ID;
  await db.adminSession.create({ data: { tokenHash: hashToken(token), telegramUserId: adminId, expiresAt: new Date(Date.now() + 3_600_000) } });
  ids.restaurant = (await db.restaurant.create({ data: { slug: `rf-${tag}`, name: `Qaytarish ${tag}`, pickupPhone: '+998901112233' } })).id;
  ids.poolCard = (await db.card.create({ data: { restaurantId: null, last4: String(randomInt(1000, 9999)), holderName: 'TEST', isTest: true } })).id;
  ids.customer = (await db.customer.create({ data: { telegramUserId: String(randomInt(900000000001, 990000000000)), displayName: `Mijoz ${tag}`, phone: '+998909998877' } })).id;
});

after(async () => {
  await db.refundRequest.deleteMany({ where: { orderId: { in: orders } } }); // events cascade
  await db.payment.deleteMany({ where: { orderId: { in: orders } } });
  await db.order.deleteMany({ where: { id: { in: orders } } });
  await db.customer.deleteMany({ where: { id: ids.customer } });
  await db.card.deleteMany({ where: { id: ids.poolCard } });
  await db.restaurant.deleteMany({ where: { id: ids.restaurant } });
  await db.adminSession.deleteMany({ where: { telegramUserId: adminId } });
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  await app.close();
  await db.$disconnect();
});

test('every refund route needs an admin session and the switch', async () => {
  for (const [m, u, body] of [['GET', '/refunds', undefined], ['GET', '/refunds/x', undefined], ['POST', '/refunds/x/confirm', { note: NOTE }], ['POST', '/refunds/x/sent', { bankReference: 'PR-1234' }]] as const) {
    assert.equal((await api(m, u, body, {})).statusCode, 401, u);
    assert.equal((await api(m, u, body, { authorization: `Bearer ${'x'.repeat(43)}` })).statusCode, 401, u);
  }
  process.env.ADMIN_APP_ENABLED = 'false';
  try { assert.equal((await api('GET', '/refunds')).statusCode, 404); } finally { process.env.ADMIN_APP_ENABLED = 'true'; }
});

test('open refunds are listed with amounts in som, readable reasons and whether they can be confirmed', async () => {
  const requested = await refund('REQUESTED');
  const sent = await refund('SENT');
  const confirmed = await refund('CONFIRMED');
  const list = (await api('GET', '/refunds')).json() as { open: Array<{ id: string; status: string; paidSom: number; reason: string; canConfirm: boolean; restaurantName: string }>; recent: Array<{ id: string }> };
  const a = list.open.find(r => r.id === requested.id);
  const b = list.open.find(r => r.id === sent.id);
  assert.ok(a && b, 'both open ones are listed');
  assert.equal(a.paidSom, 40_000);
  assert.equal(a.reason, 'Fikrim o‘zgardi');
  assert.equal(a.restaurantName, `Qaytarish ${tag}`);
  assert.equal(a.canConfirm, false, 'the restaurant has not even answered yet');
  assert.equal(b.canConfirm, true);
  assert.ok(!list.open.some(r => r.id === confirmed.id));
  assert.ok(list.recent.some(r => r.id === confirmed.id));
});

test('detail shows the timeline and the phones needed to check independently; unknown id is 404', async () => {
  const r = await refund('DISPUTED');
  await db.refundEvent.create({ data: { refundId: r.id, actorId: 'x', actorType: 'CUSTOMER', action: 'DISPUTED', fromStatus: 'SENT', toStatus: 'DISPUTED' } });
  const d = (await api('GET', `/refunds/${r.id}`)).json();
  assert.equal(d.status, 'DISPUTED');
  assert.equal(d.restaurantPhone, '+998901112233');
  assert.equal(d.customerPhone, '+998909998877');
  assert.equal(d.events.length, 1);
  assert.equal(d.events[0].action, 'DISPUTED');
  assert.equal((await api('GET', '/refunds/nope')).statusCode, 404);
});

test('confirm: a short note is refused, a good one confirms once with the note kept, a repeat is "changed"', async () => {
  const r = await refund('DISPUTED');
  const short = await api('POST', `/refunds/${r.id}/confirm`, { note: 'ok' });
  assert.equal(short.statusCode, 400);
  assert.equal(short.json().error, 'NOTE_INVALID');
  assert.equal((await db.refundRequest.findUniqueOrThrow({ where: { id: r.id } })).status, 'DISPUTED');
  const ok = await api('POST', `/refunds/${r.id}/confirm`, { note: NOTE });
  assert.equal(ok.statusCode, 200, ok.body);
  const row = await db.refundRequest.findUniqueOrThrow({ where: { id: r.id } });
  assert.equal(row.status, 'CONFIRMED');
  assert.equal(row.confirmedBy, adminId);
  assert.equal(row.confirmedByType, 'ADMIN');
  assert.equal(row.confirmNote, NOTE);
  const again = await api('POST', `/refunds/${r.id}/confirm`, { note: NOTE });
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error, 'CHANGED');
  assert.equal((await api('POST', '/refunds/nope/confirm', { note: NOTE })).statusCode, 404);
  assert.equal(await db.refundEvent.count({ where: { refundId: r.id, action: 'CONFIRMED' } }), 1);
});

test('a refund the restaurant has not sent yet cannot be confirmed by an administrator', async () => {
  const r = await refund('APPROVED');
  const res = await api('POST', `/refunds/${r.id}/confirm`, { note: NOTE });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error, 'CHANGED');
  assert.equal(res.json().status, 'APPROVED');
  assert.equal((await db.refundRequest.findUniqueOrThrow({ where: { id: r.id } })).status, 'APPROVED');
});

test('two confirm taps at once confirm exactly once', async () => {
  const r = await refund('SENT');
  const [a, b] = await Promise.all([
    api('POST', `/refunds/${r.id}/confirm`, { note: NOTE }),
    api('POST', `/refunds/${r.id}/confirm`, { note: NOTE }),
  ]);
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 409]);
  assert.equal(await db.refundEvent.count({ where: { refundId: r.id, action: 'CONFIRMED' } }), 1);
});

const ref = (suffix: string) => `PR-${tag}-${suffix}`;

test('pool refunds: the platform holds the money, so the list says the administrator sends it; restaurant-held money is not his to send', async () => {
  const pool = await refund('APPROVED', true);
  const own = await refund('APPROVED');
  const requested = await refund('REQUESTED', true);
  const list = (await api('GET', '/refunds')).json() as { open: Array<{ id: string; byPlatform: boolean; canSend: boolean }> };
  const row = (id: string) => list.open.find(r => r.id === id)!;
  assert.deepEqual([row(pool.id).byPlatform, row(pool.id).canSend], [true, true]);
  assert.deepEqual([row(own.id).byPlatform, row(own.id).canSend], [false, false]);
  assert.deepEqual([row(requested.id).byPlatform, row(requested.id).canSend], [true, false], 'the restaurant has not decided yet');
  // an approved pool refund is a notification in Diqqat (never a ring), and only for pool money
  const snap = await computeAttention();
  const item = snap.items.find(i => i.key === `REFUND_POOL_DUE:${pool.id}`);
  assert.ok(item, 'raised');
  assert.deepEqual([item.alarm, item.notify, item.severity], [false, true, 'HIGH']);
  assert.match(item.detail, /40 000/);
  assert.ok(!snap.items.some(i => i.key === `REFUND_POOL_DUE:${own.id}` || i.key === `REFUND_POOL_DUE:${requested.id}`));
});

test('administrator sends a pool refund: bank reference required and used once; the customer is then asked; the restaurant cannot send it', async () => {
  const r = await refund('APPROVED', true);
  const url = `/refunds/${r.id}/sent`;
  assert.equal((await api('POST', url, { bankReference: 'ok' })).json().error, 'REFERENCE_INVALID');
  assert.equal((await api('POST', url, { bankReference: 'ok' })).statusCode, 400);
  assert.equal((await api('POST', url, { bankReference: ref('A1'), extra: 1 })).statusCode, 400, 'strict body');
  assert.equal((await api('POST', '/refunds/nope/sent', { bankReference: ref('A1') })).statusCode, 404);

  // the restaurant tries to send money it never had: refused, nothing written
  const fakeReceipt = { key: `${randomUUID()}.jpg`, mime: 'image/jpeg' as const, bytes: 2048, sha256: randomBytes(32).toString('hex') };
  await assert.rejects(markRefundSent({ actorTelegramId: 'restaurant-api:x', restaurantId: ids.restaurant, refundId: r.id, receipt: fakeReceipt }), /POOL_ADMIN_QAYTARADI/);
  assert.equal((await db.refundRequest.findUniqueOrThrow({ where: { id: r.id } })).status, 'APPROVED');

  // two taps at once: one send
  const both = await Promise.all([api('POST', url, { bankReference: ref('A1') }), api('POST', url, { bankReference: ref('A1') })]);
  assert.deepEqual(both.map(x => x.statusCode).sort(), [200, 409]);
  const row = await db.refundRequest.findUniqueOrThrow({ where: { id: r.id } });
  assert.equal(row.status, 'SENT');
  assert.equal(row.sentBy, `admin:${adminId}`);
  assert.equal(row.bankReference, ref('A1'));
  assert.equal(row.customerSentNotifiedAt, null, 'the customer notice goes out through the usual worker');
  assert.equal(await db.refundEvent.count({ where: { refundId: r.id, action: 'SENT', actorType: 'ADMIN' } }), 1);
  assert.ok(!(await computeAttention()).items.some(i => i.key === `REFUND_POOL_DUE:${r.id}`), 'gone once it is sent');
  const d = (await api('GET', '/refunds')).json().open.find((x: { id: string }) => x.id === r.id);
  assert.deepEqual([d.canSend, d.canConfirm], [false, true]);

  // one transfer proves one refund (case does not matter)
  const other = await refund('APPROVED', true);
  const dup = await api('POST', `/refunds/${other.id}/sent`, { bankReference: ref('A1').toLowerCase() });
  assert.equal(dup.statusCode, 409);
  assert.equal(dup.json().error, 'REFERENCE_USED');
  assert.equal((await db.refundRequest.findUniqueOrThrow({ where: { id: other.id } })).status, 'APPROVED');
});

test('pool refund rules: restaurant-held money is refused, a not-yet-approved one is "changed", and a disputed one can be sent again with a new reference', async () => {
  const own = await refund('APPROVED');
  const notOwn = await api('POST', `/refunds/${own.id}/sent`, { bankReference: ref('B1') });
  assert.deepEqual([notOwn.statusCode, notOwn.json().error], [409, 'NOT_POOL']);
  assert.equal((await db.refundRequest.findUniqueOrThrow({ where: { id: own.id } })).status, 'APPROVED');

  const requested = await refund('REQUESTED', true);
  const early = await api('POST', `/refunds/${requested.id}/sent`, { bankReference: ref('B2') });
  assert.deepEqual([early.statusCode, early.json().error, early.json().status], [409, 'CHANGED', 'REQUESTED']);

  const disputed = await refund('DISPUTED', true);
  const again = await api('POST', `/refunds/${disputed.id}/sent`, { bankReference: ref('B3') });
  assert.equal(again.statusCode, 200, again.body);
  const row = await db.refundRequest.findUniqueOrThrow({ where: { id: disputed.id } });
  assert.deepEqual([row.status, row.bankReference, row.disputedAt], ['SENT', ref('B3'), null]);
  // an already-sent refund cannot be sent a second time
  assert.equal((await api('POST', `/refunds/${disputed.id}/sent`, { bankReference: ref('B4') })).statusCode, 409);
});

test('a disputed refund is an item in Diqqat until it is confirmed', async () => {
  const r = await refund('DISPUTED');
  const key = `REFUND_DISPUTED:${r.id}`;
  const before = await computeAttention();
  const item = before.items.find(i => i.key === key);
  assert.ok(item, 'raised');
  assert.equal(item.severity, 'HIGH');
  assert.equal(item.restaurant?.name, `Qaytarish ${tag}`);
  assert.match(item.detail, /40 000/);
  await api('POST', `/refunds/${r.id}/confirm`, { note: NOTE });
  assert.ok(!(await computeAttention()).items.some(i => i.key === key), 'gone the moment its cause is gone');
});
