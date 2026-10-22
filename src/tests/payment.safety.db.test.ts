import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { db as appDb } from '../lib/db.js';
import { takeStaffAction } from '../modules/restaurant/service.js';

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const staffId = String(randomInt(100000000000, 400000000000));
const stranger = String(randomInt(400000000001, 700000000000));
let restaurantId = '';
let customerId = '';
const last4s: string[] = [];

async function newCard(): Promise<{ last4: string; id: string }> {
  for (;;) {
    const last4 = String(randomInt(1000, 9999));
    if (last4s.includes(last4) || await db.card.findUnique({ where: { last4 } })) continue;
    last4s.push(last4);
    const card = await engine.addCard(last4, false, restaurantId); // real-type card: Gmail may match it
    return { last4, id: card.id };
  }
}
/** Distinct amount per test so cooldowns/ambiguity from other tests never interact. */
const somFor = () => randomInt(10_000, 900_000);
async function checkout(totalSom: number) {
  return engine.createCheckout(tx => tx.order.create({ data: {
    restaurantId, customerId, addressText: 'Test', totalSom, createdViaBot: true,
  } }), false);
}
const mail = (cardLast4: string, amountTiyin: bigint, extra: Record<string, unknown> = {}) => ({
  cardLast4, amountTiyin, occurredAt: new Date(), emailReceivedAt: new Date(),
  minutePrecision: false, trustedSender: true, ...extra,
});
const pay = (id: string) => db.payment.findUniqueOrThrow({ where: { id } });
const events = async (paymentId: string) => (await db.paymentEvent.findMany({ where: { paymentId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(e => e.action);

before(async () => {
  await db.$connect();
  restaurantId = (await db.restaurant.create({ data: { slug: `pay-safety-${randomUUID()}`, name: 'Pay safety', staffTelegramUserId: staffId } })).id;
  customerId = (await db.customer.create({ data: { telegramUserId: String(randomInt(700000000001, 900000000000)) } })).id;
});
after(async () => {
  // Only rows of this uniquely named test restaurant and its random cards are removed.
  const ids = (await db.payment.findMany({ where: { restaurantId }, select: { id: true } })).map(p => p.id);
  await db.incomingTransaction.deleteMany({ where: { OR: [{ matchedPaymentId: { in: ids } }, { cardLast4: { in: last4s } }] } });
  await db.gmailIngestion.deleteMany({ where: { gmailId: { startsWith: 'safety-' + restaurantId } } });
  await db.payment.deleteMany({ where: { id: { in: ids } } }); // cascades PaymentEvent
  const cards = await db.card.findMany({ where: { restaurantId }, select: { id: true } });
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards.map(c => c.id) } } });
  await db.card.deleteMany({ where: { restaurantId } });
  await db.order.deleteMany({ where: { restaurantId } });
  await db.customer.delete({ where: { id: customerId } });
  await db.restaurant.delete({ where: { id: restaurantId } });
  await db.$disconnect();
  await appDb.$disconnect();
});
const gid = () => `safety-${restaurantId}-${randomUUID()}`;

test('a trusted Gmail match is only a signal: MATCHED_UNVERIFIED, never confirmed', async () => {
  const card = await newCard();
  const { order, payment } = await checkout(somFor());
  assert.equal(payment.status, 'AWAITING');
  const r = await engine.ingestGmail(gid(), mail(card.last4, payment.amountTiyin));
  assert.equal(r.status, 'MATCHED_UNVERIFIED');
  const p = await pay(payment.id);
  const o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(p.status, 'MATCHED_UNVERIFIED');
  assert.equal(o.status, 'PAYMENT_MATCHED_UNVERIFIED');
  assert.equal(o.paymentVerifiedAt, null);
  assert.equal(o.paymentVerifiedBy, null);
  assert.deepEqual(await events(payment.id), ['CREATED', 'ASSIGNED', 'MATCHED_UNVERIFIED']);
});

test('duplicate Gmail message id is ignored; same bank event under another id is reviewed; parallel race matches once', async () => {
  const card = await newCard();
  const { payment } = await checkout(somFor());
  const id = gid();
  const input = mail(card.last4, payment.amountTiyin, { occurredAt: new Date(), minutePrecision: false });
  const same = await Promise.all(Array.from({ length: 4 }, () => engine.ingestGmail(id, input)));
  assert.equal(same.filter(r => r.status === 'MATCHED_UNVERIFIED').length, 1);
  assert.equal(same.filter(r => r.status === 'DUPLICATE').length, 3);
  const other = await Promise.all(Array.from({ length: 4 }, () => engine.ingestGmail(gid(), input)));
  assert.ok(other.every(r => r.status === 'REVIEW_REQUIRED'));
  assert.ok(other.every(r => r.reason === 'POSSIBLE_DUPLICATE_NOTIFICATION' || r.reason === 'ALREADY_MATCHED_PAYMENT'));
  assert.equal(await db.incomingTransaction.count({ where: { matchedPaymentId: payment.id } }), 1);
  assert.equal((await pay(payment.id)).status, 'MATCHED_UNVERIFIED');
  assert.equal(await db.paymentEvent.count({ where: { paymentId: payment.id, action: 'MATCHED_UNVERIFIED' } }), 1);
});

test('equal amounts on different orders go to different cards; one mail matches exactly one order', async () => {
  const c1 = await newCard(); const c2 = await newCard();
  const som = somFor();
  const [a, b] = await Promise.all([checkout(som), checkout(som)]);
  const cards = new Set([(await pay(a.payment.id)).cardId, (await pay(b.payment.id)).cardId]);
  assert.equal(cards.size, 2);
  const target = (await pay(a.payment.id)).cardId === c1.id ? c1 : c2;
  const r = await engine.ingestGmail(gid(), mail(target.last4, BigInt(som) * 100n));
  assert.equal(r.status, 'MATCHED_UNVERIFIED');
  const statuses = [(await pay(a.payment.id)).status, (await pay(b.payment.id)).status].sort();
  assert.deepEqual(statuses, ['AWAITING', 'MATCHED_UNVERIFIED']);
});

test('partial and excess payments are reviewed and never change the payment', async () => {
  const card = await newCard();
  const { order, payment } = await checkout(somFor());
  const below = await engine.ingestGmail(gid(), mail(card.last4, payment.amountTiyin - 100n));
  const above = await engine.ingestGmail(gid(), mail(card.last4, payment.amountTiyin + 100n));
  assert.equal(below.reason, 'AMOUNT_BELOW_EXPECTED');
  assert.equal(above.reason, 'AMOUNT_ABOVE_EXPECTED');
  assert.equal((await pay(payment.id)).status, 'AWAITING');
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'PAYMENT_PENDING');
  assert.equal(await db.paymentEvent.count({ where: { paymentId: payment.id, action: 'INCOMING_FLAGGED' } }), 2);
  const stored = await db.incomingTransaction.findMany({ where: { cardLast4: card.last4, status: 'REVIEW_REQUIRED' } });
  assert.equal(stored.length, 2); // evidence kept
});

test('late money for an expired attempt is reviewed; the attempt and its history are preserved', async () => {
  const card = await newCard();
  const { order, payment } = await checkout(somFor());
  const now = Date.now();
  await db.payment.update({ where: { id: payment.id }, data: { assignedAt: new Date(now - 120_000), expiresAt: new Date(now - 1_000) } });
  await engine.maintenance();
  assert.equal((await pay(payment.id)).status, 'EXPIRED');
  const r = await engine.ingestGmail(gid(), mail(card.last4, payment.amountTiyin, { occurredAt: new Date(now - 90_000) }));
  assert.deepEqual([r.status, r.reason], ['REVIEW_REQUIRED', 'LATE_FOR_EXPIRED_PAYMENT']);
  assert.equal((await pay(payment.id)).status, 'EXPIRED');
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'PAYMENT_EXPIRED');
  assert.deepEqual(await events(payment.id), ['CREATED', 'ASSIGNED', 'EXPIRED', 'INCOMING_FLAGGED']);
});

test('a mail that arrives long after the operation is never auto-matched', async () => {
  const card = await newCard();
  const { payment } = await checkout(somFor());
  const r = await engine.ingestGmail(gid(), mail(card.last4, payment.amountTiyin, {
    occurredAt: new Date(Date.now() - 2 * 3600_000), emailReceivedAt: new Date(),
  }));
  assert.equal(r.reason, 'DELAYED_NOTIFICATION');
  assert.equal((await pay(payment.id)).status, 'AWAITING');
});

test('reused amount: a second mail for an already matched attempt is reviewed, not matched again', async () => {
  const card = await newCard();
  const { payment } = await checkout(somFor());
  assert.equal((await engine.ingestGmail(gid(), mail(card.last4, payment.amountTiyin))).status, 'MATCHED_UNVERIFIED');
  const second = await engine.ingestGmail(gid(), mail(card.last4, payment.amountTiyin, { occurredAt: new Date(Date.now() + 1000) }));
  assert.equal(second.status, 'REVIEW_REQUIRED');
  assert.equal(await db.incomingTransaction.count({ where: { matchedPaymentId: payment.id } }), 1);
});

test('database invariants: no two active attempts per card+amount; one transaction per payment; real match needs a transaction', async () => {
  const card = await newCard();
  const { payment } = await checkout(somFor());
  await assert.rejects(db.$executeRaw`INSERT INTO "Payment" ("id","amountTiyin","status","cardId","isTest")
    SELECT ${randomUUID()}::text, "amountTiyin", 'AWAITING', "cardId", false FROM "Payment" WHERE "id" = ${payment.id}`);
  // a real payment cannot be put into a matched state without a linked incoming transaction
  await assert.rejects(db.$executeRaw`UPDATE "Payment" SET "status" = 'MATCHED_UNVERIFIED' WHERE "id" = ${payment.id}`);
  assert.equal((await pay(payment.id)).status, 'AWAITING');
  // one incoming transaction cannot be linked to two payments, and one payment has a single transaction
  const r = await engine.ingestGmail(gid(), mail(card.last4, payment.amountTiyin));
  assert.equal(r.status, 'MATCHED_UNVERIFIED');
  const other = await db.incomingTransaction.create({ data: {
    sourceId: `safety-${randomUUID()}`, source: 'GMAIL', cardLast4: card.last4, amountTiyin: 1n, occurredAt: new Date() } });
  await assert.rejects(db.incomingTransaction.update({ where: { id: other.id }, data: { matchedPaymentId: payment.id } }));
});

test('only the restaurant staff actor can confirm; confirmation is audited and idempotent under concurrency', async () => {
  const card = await newCard();
  const { order, payment } = await checkout(somFor());
  await engine.ingestGmail(gid(), mail(card.last4, payment.amountTiyin));
  const verify = (actor: string) => takeStaffAction({ actorTelegramId: actor, orderId: order.id, action: 'VERIFY_PAYMENT' });
  await assert.rejects(verify(stranger), /RUXSAT_YOQ/);
  await assert.rejects(verify(String(randomInt(1, 99999))), /RUXSAT_YOQ/);
  assert.equal((await pay(payment.id)).status, 'MATCHED_UNVERIFIED');
  const results = await Promise.allSettled([verify(staffId), verify(staffId), verify(staffId)]);
  assert.equal(results.filter(r => r.status === 'fulfilled' && r.value.changed).length, 1);
  assert.equal((await pay(payment.id)).status, 'CONFIRMED_MANUAL');
  const o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(o.status, 'PAYMENT_CONFIRMED');
  assert.equal(o.paymentVerifiedBy, staffId);
  const ev = await db.paymentEvent.findMany({ where: { paymentId: payment.id, action: 'CONFIRMED_MANUAL' } });
  assert.equal(ev.length, 1);
  assert.equal(ev[0]!.actorId, staffId);
  assert.equal(ev[0]!.actorType, 'RESTAURANT_STAFF');
});

test('confirmation is refused when the stored match is inconsistent (amount or missing transaction)', async () => {
  const card = await newCard();
  const { order, payment } = await checkout(somFor());
  await engine.ingestGmail(gid(), mail(card.last4, payment.amountTiyin));
  // simulate a tampered/inconsistent record: the linked incoming amount differs from the payment
  const p = await pay(payment.id);
  await db.incomingTransaction.update({ where: { id: p.matchedTransactionId! }, data: { amountTiyin: payment.amountTiyin + 1n } });
  await assert.rejects(takeStaffAction({ actorTelegramId: staffId, orderId: order.id, action: 'VERIFY_PAYMENT' }), /TOLOV_MOS_EMAS/);
  assert.equal((await pay(payment.id)).status, 'MATCHED_UNVERIFIED');
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'PAYMENT_MATCHED_UNVERIFIED');
});
