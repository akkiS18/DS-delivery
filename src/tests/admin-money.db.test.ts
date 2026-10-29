import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { hashToken } from '../modules/admin-auth/service.js';
import { luhnValid } from '../modules/restaurant-cards/service.js';

// DS Admin A2 (money review, card approval, platform pool). Needs a *_test database (the repo's DB guard). Uses only uniquely named rows and
// removes only them (AdminAuditEvent is append-only: its rows stay, under a unique actor id).
const db = new PrismaClient();
const app = buildApp(new PaymentEngineV3(db, defaultOptions, () => {}));
const tag = randomUUID().slice(0, 8);
const adminId = `9${randomInt(100_000_000, 999_999_999)}${randomInt(100, 999)}`;
const token = randomBytes(32).toString('base64url');
const auth = { authorization: `Bearer ${token}` };
const api = (method: 'GET' | 'POST', url: string, payload?: object, headers: Record<string, string> = auth) =>
  app.inject({ method, url: `/api/v1/admin${url}`, headers, ...(payload ? { payload } : {}) });

const saved = { ...process.env };
const created = { incoming: [] as string[], cards: [] as string[], payments: [] as string[], restaurant: '' };

/** A Luhn-valid 16-digit number (the real check the service applies). */
function cardNumber(): string {
  const body = Array.from({ length: 15 }, () => randomInt(0, 10));
  for (let check = 0; check < 10; check++) {
    const n = [...body, check].join('');
    if (luhnValid(n)) return n;
  }
  throw new Error('unreachable');
}

/** Adds a platform card through the API, retrying when the random last4 is already taken in this database. */
async function addPoolCard(holder = 'Test Egasi'): Promise<{ id: string; last4: string; number: string }> {
  for (let i = 0; i < 30; i++) {
    const number = cardNumber();
    const r = await api('POST', '/pool/cards', { number, holderName: holder });
    if (r.statusCode === 201) { const j = r.json(); created.cards.push(j.cardId); return { id: j.cardId, last4: j.last4, number }; }
    assert.equal(r.statusCode, 409, 'only a taken last4 may be refused here');
  }
  throw new Error('no free last4');
}

before(async () => {
  await db.$connect();
  process.env.ADMIN_APP_ENABLED = 'true';
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = adminId;
  delete process.env.SUPPORT_ADMIN_2_TELEGRAM_ID;
  process.env.CARD_TURNOVER_CAP_SOM = '1000000';
  await db.adminSession.create({ data: { tokenHash: hashToken(token), telegramUserId: adminId, expiresAt: new Date(Date.now() + 3_600_000) } });
  created.restaurant = (await db.restaurant.create({ data: { slug: `money-${tag}`, name: `Pul ${tag}` } })).id;
});

after(async () => {
  await db.payment.deleteMany({ where: { id: { in: created.payments } } });
  await db.cardEvent.deleteMany({ where: { cardId: { in: created.cards } } });
  await db.card.deleteMany({ where: { id: { in: created.cards } } });
  await db.incomingTransaction.deleteMany({ where: { id: { in: created.incoming } } });
  await db.restaurant.deleteMany({ where: { id: created.restaurant } });
  await db.adminSession.deleteMany({ where: { telegramUserId: adminId } });
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  await app.close();
  await db.$disconnect();
});

test('every money route needs an admin session and the switch', async () => {
  for (const [m, u] of [['GET', '/money'], ['GET', '/cards'], ['GET', '/cards/x'], ['GET', '/pool']] as const) {
    assert.equal((await api(m, u, undefined, {})).statusCode, 401, u);
    assert.equal((await api(m, u, undefined, { authorization: `Bearer ${'x'.repeat(43)}` })).statusCode, 401, u);
  }
  assert.equal((await api('POST', '/money/reviews/x/handle', { action: 'OTHER', note: 'x'.repeat(12) }, {})).statusCode, 401);
  assert.equal((await api('POST', '/cards/x/decision', { decision: 'APPROVE' }, {})).statusCode, 401);
  assert.equal((await api('POST', '/pool/cards', { number: '1', holderName: 'x' }, {})).statusCode, 401);
  assert.equal((await api('POST', '/pool/collect', { slug: 'ab', on: true }, {})).statusCode, 401);
  process.env.ADMIN_APP_ENABLED = 'false';
  try { assert.equal((await api('GET', '/money')).statusCode, 404); } finally { process.env.ADMIN_APP_ENABLED = 'true'; }
});

test('money review: listed with a readable reason, needs a real note, closes once, unknown id is not found', async () => {
  const inc = await db.incomingTransaction.create({ data: {
    sourceId: `mon-${tag}`, source: 'GMAIL', cardLast4: '0000', amountTiyin: 12_300_000n, occurredAt: new Date(), emailReceivedAt: new Date(), status: 'REVIEW_REQUIRED', reason: 'NO_ACTIVE_PAYMENT',
  } });
  created.incoming.push(inc.id);

  const list = (await api('GET', '/money')).json();
  const mine = list.reviews.find((r: { id: string }) => r.id === inc.id);
  assert.ok(mine, 'the unhandled item is listed');
  assert.equal(mine.amountSom, 123_000);
  assert.equal(mine.reason, 'NO_ACTIVE_PAYMENT');
  assert.match(mine.reasonText, /ochiq to‘lov yo‘q/);
  assert.deepEqual(list.actions.map((a: { action: string }) => a.action), ['NOT_OURS', 'REFUNDED', 'ORDER_RESOLVED', 'OTHER']);

  const short = await api('POST', `/money/reviews/${inc.id}/handle`, { action: 'NOT_OURS', note: 'qisqa' });
  assert.equal(short.statusCode, 400);
  assert.equal(short.json().error, 'NOTE_INVALID');
  assert.equal((await api('POST', `/money/reviews/${inc.id}/handle`, { action: 'DELETE_EVERYTHING', note: 'x'.repeat(20) })).statusCode, 400);
  assert.equal((await db.incomingTransaction.findUniqueOrThrow({ where: { id: inc.id } })).handledAt, null, 'refused calls change nothing');

  // Two taps at once: exactly one decision is recorded.
  const note = 'Bank ilovasida tekshirildi: begona o‘tkazma';
  const both = await Promise.all([1, 2].map(() => api('POST', `/money/reviews/${inc.id}/handle`, { action: 'NOT_OURS', note })));
  assert.deepEqual(both.map(r => r.statusCode), [200, 200]);
  assert.deepEqual(both.map(r => r.json().result).sort(), ['ALREADY_HANDLED', 'HANDLED']);
  const row = await db.incomingTransaction.findUniqueOrThrow({ where: { id: inc.id } });
  assert.equal(row.handledBy, adminId);
  assert.equal(row.handledAction, 'NOT_OURS');
  assert.equal(row.handledNote, note);
  assert.ok(!(await api('GET', '/money')).json().reviews.some((r: { id: string }) => r.id === inc.id), 'a closed item leaves the list');

  assert.equal((await api('POST', '/money/reviews/does-not-exist/handle', { action: 'OTHER', note })).statusCode, 404);
});

test('card approval: the full number is shown only for a pending card (and audited); two taps give one decision; masked afterwards', async () => {
  const card = await addPoolCard('Sinov Egasi');
  const listed = (await api('GET', '/cards')).json().cards.find((c: { id: string }) => c.id === card.id);
  assert.equal(listed.status, 'PENDING');
  assert.equal(listed.platform, true);
  assert.equal(listed.masked, `**** **** **** ${card.last4}`);
  assert.ok(!JSON.stringify(listed).includes(card.number), 'the list never carries the number');

  const detail = (await api('GET', `/cards/${card.id}`)).json();
  assert.equal(detail.number, card.number.replace(/(\d{4})(?=\d)/g, '$1 '));
  assert.equal(detail.holderName, 'Sinov Egasi');
  const viewed = await db.adminAuditEvent.count({ where: { actorId: adminId, action: 'CARD_NUMBER_VIEWED', targetId: card.id } });
  assert.equal(viewed, 1, 'looking at a full number leaves a trace');

  const taps = await Promise.all([1, 2].map(() => api('POST', `/cards/${card.id}/decision`, { decision: 'APPROVE' })));
  assert.deepEqual(taps.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal(taps.find(r => r.statusCode === 409)!.json().error, 'ALREADY_DECIDED');
  const after = await db.card.findUniqueOrThrow({ where: { id: card.id } });
  assert.equal(after.approvalStatus, 'APPROVED');
  assert.equal(after.active, true);
  assert.equal(await db.adminAuditEvent.count({ where: { actorId: adminId, action: 'CARD_APPROVED', targetId: card.id } }), 1);

  const approved = (await api('GET', `/cards/${card.id}`)).json();
  assert.equal(approved.number, null, 'an approved card is never shown in full again');
  assert.equal(await db.adminAuditEvent.count({ where: { actorId: adminId, action: 'CARD_NUMBER_VIEWED', targetId: card.id } }), 1, 'no extra trace: nothing sensitive was shown');

  assert.equal((await api('POST', `/cards/${card.id}/decision`, { decision: 'REJECT' })).statusCode, 409, 'an approved card cannot be rejected by a stale tap');
  assert.equal((await api('POST', '/cards/nope/decision', { decision: 'APPROVE' })).statusCode, 404);
  assert.equal((await api('POST', `/cards/${card.id}/decision`, { decision: 'MAYBE' })).statusCode, 400);
});

test('platform card input is validated: bad number, bad holder, duplicate', async () => {
  assert.equal((await api('POST', '/pool/cards', { number: '8600123412341234', holderName: 'Test Egasi' })).json().error, 'CARD_NUMBER_INVALID', 'Luhn');
  assert.equal((await api('POST', '/pool/cards', { number: '1234', holderName: 'Test Egasi' })).json().error, 'CARD_NUMBER_INVALID');
  const card = await addPoolCard();
  assert.equal((await api('POST', '/pool/cards', { number: cardNumber(), holderName: '12' })).json().error, 'HOLDER_INVALID');
  const dup = await api('POST', '/pool/cards', { number: card.number, holderName: 'Boshqa Ism' });
  assert.equal(dup.statusCode, 409);
  assert.equal(dup.json().error, 'CARD_TAKEN');
  assert.equal((await api('POST', '/pool/cards', { number: card.number, holderName: 'Boshqa Ism', extra: 1 })).statusCode, 400, 'unknown fields are refused');
});

test('pool: turnover levels, the 70/90 warnings in "Diqqat", and switching a restaurant on and off (audited, refused while a card payment is open)', async () => {
  const card = await addPoolCard();
  assert.equal((await api('POST', `/cards/${card.id}/decision`, { decision: 'APPROVE' })).statusCode, 200);

  const snap = async () => (await api('GET', '/pool')).json().cards.find((c: { id: string }) => c.id === card.id);
  assert.deepEqual({ ...(await snap()), id: undefined, last4: undefined, holderName: undefined }, { id: undefined, last4: undefined, holderName: undefined, status: 'ACTIVE', turnoverSom: 0, percent: 0, level: 'OK' });
  const attn = async () => (await api('GET', '/attention')).json().items.filter((i: { key: string }) => i.key.endsWith(`:${card.id}`));
  assert.deepEqual(await attn(), []);

  // 750 000 so'm waiting on the card = 75% of the 1 000 000 cap used in this test.
  const pay = async (som: number) => {
    const p = await db.payment.create({ data: { amountTiyin: BigInt(som) * 100n, status: 'AWAITING', method: 'CARD', isTest: false, cardId: card.id, assignedAt: new Date(), expiresAt: new Date(Date.now() + 600_000) } });
    created.payments.push(p.id);
  };
  await pay(750_000);
  const mid = await snap();
  assert.equal(mid.percent, 75);
  assert.equal(mid.level, 'MID');
  const midItems = await attn();
  assert.deepEqual(midItems.map((i: { kind: string }) => i.kind), ['CARD_TURN_MID']);
  assert.equal(midItems[0].alarm, false, 'the 70% heads-up never rings');
  assert.equal(midItems[0].severity, 'MEDIUM');

  await pay(160_000);
  assert.equal((await snap()).level, 'HIGH');
  const highItems = await attn();
  assert.deepEqual(highItems.map((i: { kind: string }) => i.kind), ['CARD_TURN_HIGH'], 'only the higher level is raised');
  assert.equal(highItems[0].severity, 'HIGH');

  // Switching the restaurant: needs the pool card (approved above), is audited, and is refused while a card payment of the restaurant is open.
  const slug = `money-${tag}`;
  assert.equal((await api('POST', '/pool/collect', { slug: 'does-not-exist-zz', on: true })).statusCode, 404);
  assert.equal((await api('POST', '/pool/collect', { slug: 'Bad Slug!', on: true })).statusCode, 400);
  const on = await api('POST', '/pool/collect', { slug, on: true });
  assert.equal(on.statusCode, 200);
  assert.equal(on.json().result, 'CHANGED');
  assert.equal((await api('POST', '/pool/collect', { slug, on: true })).json().result, 'UNCHANGED', 'a second tap changes nothing');
  assert.ok((await api('GET', '/pool')).json().restaurants.some((r: { slug: string; collectsToPlatform: boolean }) => r.slug === slug && r.collectsToPlatform));
  assert.equal(await db.adminAuditEvent.count({ where: { actorId: adminId, action: 'COLLECTS_TO_PLATFORM_ON', targetId: created.restaurant } }), 1);

  const open = await db.payment.create({ data: { restaurantId: created.restaurant, amountTiyin: 5_000_000n, status: 'AWAITING', method: 'CARD', isTest: false, assignedAt: new Date(), expiresAt: new Date(Date.now() + 600_000) } });
  created.payments.push(open.id);
  const blocked = await api('POST', '/pool/collect', { slug, on: false });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().error, 'OPEN_PAYMENTS');
  assert.equal(blocked.json().count, 1);
  assert.equal((await db.restaurant.findUniqueOrThrow({ where: { id: created.restaurant } })).collectsToPlatform, true, 'refused: nothing changed');
  await db.payment.update({ where: { id: open.id }, data: { status: 'EXPIRED' } });
  assert.equal((await api('POST', '/pool/collect', { slug, on: false })).json().result, 'CHANGED');
});
