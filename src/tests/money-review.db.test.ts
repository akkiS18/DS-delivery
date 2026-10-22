import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { countUnhandledReviews, handleReview, listStaleUnverified, listUnhandledReviews } from '../modules/payment/review.js';
import { explainReason, REVIEW_REASON_TEXT } from '../modules/payment/review-reasons.js';
import { renderReviewItem } from '../bot/money-admin.js';

// Stage 8C: administrator handling of REVIEW_REQUIRED money. ds_delivery_test only; no Telegram, no real money.
const ADMIN = String(randomInt(100000000001, 200000000000));
const OTHER_ADMIN = String(randomInt(200000000001, 300000000000));
const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const nonce = randomUUID().slice(0, 8);
const sources: string[] = [];
let restaurantId = '';
let savedA: string | undefined;
let savedB: string | undefined;

async function freeLast4(): Promise<string> {
  for (;;) {
    const v = String(randomInt(1000, 10000));
    if (!(await db.card.findUnique({ where: { last4: v } })) && !(await db.incomingTransaction.findFirst({ where: { cardLast4: v } }))) return v;
  }
}
/** An e-mail for a card nobody has: the engine files it as REVIEW_REQUIRED / UNKNOWN_CARD. */
async function strayMoney(amountSom = randomInt(10_000, 900_000)) {
  const last4 = await freeLast4();
  const id = `mr-${nonce}-${randomUUID().slice(0, 6)}`;
  sources.push(`gmail:${id}`);
  const r = await engine.ingestGmail(id, { cardLast4: last4, amountTiyin: BigInt(amountSom) * 100n, occurredAt: new Date(), emailReceivedAt: new Date(), minutePrecision: true, trustedSender: true });
  assert.equal(r.status, 'REVIEW_REQUIRED');
  return db.incomingTransaction.findUniqueOrThrow({ where: { sourceId: `gmail:${id}` } });
}

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  savedA = process.env.SUPPORT_ADMIN_1_TELEGRAM_ID; savedB = process.env.SUPPORT_ADMIN_2_TELEGRAM_ID;
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = ADMIN; process.env.SUPPORT_ADMIN_2_TELEGRAM_ID = OTHER_ADMIN;
  restaurantId = (await db.restaurant.create({ data: { slug: `mr-${nonce}`, name: `MR ${nonce}`, pickupAddress: 'P' } })).id;
});

after(async () => {
  if (savedA === undefined) delete process.env.SUPPORT_ADMIN_1_TELEGRAM_ID; else process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = savedA;
  if (savedB === undefined) delete process.env.SUPPORT_ADMIN_2_TELEGRAM_ID; else process.env.SUPPORT_ADMIN_2_TELEGRAM_ID = savedB;
  const pays = await db.payment.findMany({ where: { restaurantId }, select: { id: true } });
  const cards = await db.card.findMany({ where: { restaurantId }, select: { id: true } });
  await db.paymentEvent.deleteMany({ where: { paymentId: { in: pays.map(p => p.id) } } });
  await db.payment.deleteMany({ where: { id: { in: pays.map(p => p.id) } } });
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards.map(c => c.id) } } });
  await db.card.deleteMany({ where: { restaurantId } });
  await db.incomingTransaction.deleteMany({ where: { sourceId: { in: sources } } });
  await db.restaurant.deleteMany({ where: { id: restaurantId } });
  await db.$disconnect();
});

test('every reason code the engine can produce has a plain-language explanation', async () => {
  const src = await import('node:fs').then(fs => fs.readFileSync(new URL('../modules/payment/engine.ts', import.meta.url), 'utf8'));
  const codes = new Set([...src.matchAll(/reviewed\('([A-Z_]+)'/g)].map(m => m[1]!));
  for (const c of ['LATE_FOR_EXPIRED_PAYMENT', 'ALREADY_MATCHED_PAYMENT']) codes.add(c);
  assert.ok(codes.size >= 10, 'found the reason codes in the engine');
  for (const code of codes) assert.ok(REVIEW_REASON_TEXT[code], `missing explanation for ${code}`);
  assert.match(explainReason('SOMETHING_NEW'), /noma’lum/);
});

test('an unmatched mail is listed with its restaurant-less card, reason text and the four decisions; closing it needs a real note', async () => {
  const before = await countUnhandledReviews();
  const item = await strayMoney(21_000);
  assert.equal(await countUnhandledReviews(), before + 1);
  const listed = (await listUnhandledReviews(50)).find(r => r.id === item.id);
  assert.ok(listed, 'listed');
  assert.equal(listed.reason, 'UNKNOWN_CARD');
  const view = renderReviewItem(listed);
  assert.match(view.text, /21,000 so‘m/);
  assert.match(view.text, new RegExp(`\\*\\*\\*${item.cardLast4}`));
  assert.match(view.text, /UNKNOWN_CARD/);
  assert.equal(JSON.stringify(view.keyboard.reply_markup).split('mon:').length - 1, 4, 'four decision buttons');

  await assert.rejects(handleReview({ incomingId: item.id, adminId: '999', action: 'NOT_OURS', note: 'bu begona pul edi, tekshirildi' }), /ADMIN_RUXSAT_YOQ/);
  await assert.rejects(handleReview({ incomingId: item.id, adminId: ADMIN, action: 'NOT_OURS', note: 'qisqa' }), /ADMIN_IZOH_NOTOGRI/);
  await assert.rejects(handleReview({ incomingId: item.id, adminId: ADMIN, action: 'NOT_OURS', note: 'x'.repeat(301) }), /ADMIN_IZOH_NOTOGRI/);
  await assert.rejects(handleReview({ incomingId: item.id, adminId: ADMIN, action: 'DELETE' as never, note: 'yetarlicha uzun izoh' }), /AMAL_NOTOGRI/);
  assert.equal((await db.incomingTransaction.findUniqueOrThrow({ where: { id: item.id } })).handledAt, null, 'refusals changed nothing');

  assert.deepEqual(await handleReview({ incomingId: item.id, adminId: ADMIN, action: 'REFUNDED', note: '  Mijozga bank orqali qaytarildi, 21 000  ' }), { result: 'HANDLED' });
  const done = await db.incomingTransaction.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(done.handledBy, ADMIN);
  assert.equal(done.handledAction, 'REFUNDED');
  assert.equal(done.handledNote, 'Mijozga bank orqali qaytarildi, 21 000');
  assert.equal(done.status, 'REVIEW_REQUIRED', 'history keeps its status');
  assert.equal((await listUnhandledReviews(50)).some(r => r.id === item.id), false);
  assert.deepEqual(await handleReview({ incomingId: item.id, adminId: OTHER_ADMIN, action: 'NOT_OURS', note: 'ikkinchi admin ham yopmoqchi' }), { result: 'ALREADY_HANDLED' });
  assert.equal((await db.incomingTransaction.findUniqueOrThrow({ where: { id: item.id } })).handledBy, ADMIN, 'the first decision stands');
  assert.deepEqual(await handleReview({ incomingId: 'nope', adminId: ADMIN, action: 'OTHER', note: 'mavjud bo‘lmagan element' }), { result: 'NOT_FOUND' });
});

test('two administrators closing the same item at once produce exactly one record', async () => {
  const item = await strayMoney();
  const r = await Promise.all([
    handleReview({ incomingId: item.id, adminId: ADMIN, action: 'NOT_OURS', note: 'birinchi admin: begona pul' }),
    handleReview({ incomingId: item.id, adminId: OTHER_ADMIN, action: 'OTHER', note: 'ikkinchi admin: boshqa sabab' }),
  ]);
  assert.deepEqual(r.map(x => x.result).sort(), ['ALREADY_HANDLED', 'HANDLED']);
});

test('the database enforces the record: all-or-none, fixed decisions, a real note, and only rows that were in review', async () => {
  const item = await strayMoney();
  const bad = (data: object) => assert.rejects(db.incomingTransaction.update({ where: { id: item.id }, data }), /IncomingTransaction_handling_complete|check constraint/i);
  await bad({ handledAt: new Date() });
  await bad({ handledAt: new Date(), handledBy: ADMIN }); // half-filled: NULL action and note must not slip through a CHECK
  await bad({ handledAt: new Date(), handledBy: ADMIN, handledAction: 'NOT_OURS', handledNote: 'short' });
  await bad({ handledAt: new Date(), handledBy: ADMIN, handledAction: 'DELETE', handledNote: 'long enough note here' });
  await bad({ handledAt: new Date(), handledBy: ADMIN, handledAction: 'OTHER', handledNote: 'long enough note here', status: 'MATCHED_UNVERIFIED' });
});

test('/money also lists payments the restaurant has not confirmed for too long (customer paid, nobody cooking)', async () => {
  const last4 = await freeLast4();
  await db.card.create({ data: { restaurantId, last4, isTest: false } });
  const som = randomInt(10_000, 900_000);
  const p = await engine.createPayment(BigInt(som) * 100n, false, false, null, restaurantId);
  assert.equal(p.status, 'AWAITING');
  const id = `mr-${nonce}-${randomUUID().slice(0, 6)}`;
  sources.push(`gmail:${id}`);
  const m = await engine.ingestGmail(id, { cardLast4: last4, amountTiyin: BigInt(som) * 100n, occurredAt: new Date(), emailReceivedAt: new Date(), minutePrecision: true, trustedSender: true });
  assert.equal(m.status, 'MATCHED_UNVERIFIED');
  assert.equal((await listStaleUnverified(10)).some(s => s.restaurantName === `MR ${nonce}`), false, 'fresh: not stale yet');
  await db.payment.update({ where: { id: p.id }, data: { matchedAt: new Date(Date.now() - 30 * 60_000) } });
  const stale = (await listStaleUnverified(10)).find(s => s.restaurantName === `MR ${nonce}`);
  assert.ok(stale);
  assert.equal(stale.amountTiyin, BigInt(som) * 100n);
});
