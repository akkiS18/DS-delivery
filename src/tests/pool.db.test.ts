import assert from 'node:assert/strict';
import test from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { usableCardCount } from '../modules/payment/pool.js';

// Platform card pool (owner decision 2026-10-30). Needs a *_test database (the repo's DB guard). Uses only uniquely named rows and removes only them.
const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const SOM = (n: number) => BigInt(n) * 100n;

async function freeLast4(taken: string[]): Promise<string> {
  for (;;) {
    const last4 = String(randomInt(1000, 9999));
    if (!taken.includes(last4) && !await db.card.findUnique({ where: { last4 } })) return last4;
  }
}

test('PostgreSQL: platform pool serves several restaurants, matches only on its own cards, honours the turnover cap', { timeout: 120_000 }, async () => {
  await db.$connect();
  const tag = randomUUID();
  const oldCap = process.env.CARD_TURNOVER_CAP_SOM;
  const platformA = await db.restaurant.create({ data: { slug: `pool-a-${tag}`, name: 'Pool A', collectsToPlatform: true } });
  const platformB = await db.restaurant.create({ data: { slug: `pool-b-${tag}`, name: 'Pool B', collectsToPlatform: true } });
  const own = await db.restaurant.create({ data: { slug: `pool-own-${tag}`, name: 'Own card restaurant' } });
  const last4s: string[] = [];
  const cardIds: string[] = [];
  for (const restaurantId of [null, null, own.id]) {
    const last4 = await freeLast4(last4s); last4s.push(last4);
    cardIds.push((await db.card.create({ data: { last4, restaurantId, isTest: false, active: true, approvalStatus: 'APPROVED', label: 'UZCARD' } })).id);
  }
  const [pool1, pool2, ownCard] = cardIds as [string, string, string];
  const restaurantIds = [platformA.id, platformB.id, own.id];
  try {
    delete process.env.CARD_TURNOVER_CAP_SOM; // default cap 40 000 000: not reached below
    // Two restaurants, the SAME amount, at the same time: two different pool cards; the third waits (one open payment per card and amount).
    const p1 = await engine.createPayment(SOM(55_000), false, false, null, platformA.id);
    const p2 = await engine.createPayment(SOM(55_000), false, false, null, platformB.id);
    const p3 = await engine.createPayment(SOM(55_000), false, false, null, platformA.id);
    assert.equal(p1.status, 'AWAITING'); assert.equal(p2.status, 'AWAITING'); assert.equal(p3.status, 'QUEUED');
    assert.notEqual(p1.cardId, p2.cardId);
    assert(new Set([pool1, pool2]).has(p1.cardId!) && new Set([pool1, pool2]).has(p2.cardId!), 'pool payments must sit on platform cards');

    // A restaurant with its own card never takes a platform card, and a pool restaurant never takes the restaurant's own card.
    const own1 = await engine.createPayment(SOM(55_000), false, false, null, own.id);
    assert.equal(own1.status, 'AWAITING'); assert.equal(own1.cardId, ownCard);

    // Bank signal for p1's card: matches p1 (scope check accepts a platform card for a collectsToPlatform restaurant).
    const card1 = await db.card.findUniqueOrThrow({ where: { id: p1.cardId! } });
    const ok = await engine.ingest({ sourceId: `pool-${tag}-1`, source: 'GMAIL', cardLast4: card1.last4, amountTiyin: SOM(55_000), occurredAt: new Date(), minutePrecision: false, trustedSender: true });
    assert.equal(ok.status, 'MATCHED_UNVERIFIED');
    // The flag is switched while a payment sits on the OLD owner's card: the money must go to review, never be guessed.
    await db.restaurant.update({ where: { id: own.id }, data: { collectsToPlatform: true } });
    const ownLast4 = (await db.card.findUniqueOrThrow({ where: { id: ownCard } })).last4;
    const mismatch = await engine.ingest({ sourceId: `pool-${tag}-2`, source: 'GMAIL', cardLast4: ownLast4, amountTiyin: SOM(55_000), occurredAt: new Date(), minutePrecision: false, trustedSender: true });
    assert.equal(mismatch.status, 'REVIEW_REQUIRED'); assert.equal(mismatch.reason, 'CARD_PAYMENT_SCOPE_MISMATCH');
    await db.restaurant.update({ where: { id: own.id }, data: { collectsToPlatform: false } });

    // Turnover cap: 2 000 000 so'm. Each pool card already holds 55 000 (matched or waiting); one 990 000 payment fits on each, a second one no longer does.
    process.env.CARD_TURNOVER_CAP_SOM = '2000000';
    const big1 = await engine.createPayment(SOM(990_000), false, false, null, platformA.id); // the card with the least intake takes it
    assert.equal(big1.status, 'AWAITING');
    const big2 = await engine.createPayment(SOM(990_000), false, false, null, platformB.id);
    assert.equal(big2.status, 'AWAITING');
    assert.notEqual(big1.cardId, big2.cardId);
    const big3 = await engine.createPayment(SOM(990_000), false, false, null, platformA.id);
    assert.equal(big3.status, 'QUEUED', 'every pool card is at the cap: the payment must not be assigned');
    assert.equal(await usableCardCount(db, platformA.id, 990_000), 0);
    assert.equal(await usableCardCount(db, own.id, 990_000), 1, 'a restaurant with its own card is not capped');
  } finally {
    if (oldCap === undefined) delete process.env.CARD_TURNOVER_CAP_SOM; else process.env.CARD_TURNOVER_CAP_SOM = oldCap;
    const payments = await db.payment.findMany({ where: { restaurantId: { in: restaurantIds } }, select: { id: true } });
    const ids = payments.map(p => p.id);
    await db.incomingTransaction.deleteMany({ where: { sourceId: { startsWith: `pool-${tag}` } } });
    await db.payment.deleteMany({ where: { id: { in: ids } } });
    await db.cardCooldown.deleteMany({ where: { cardId: { in: cardIds } } });
    await db.card.deleteMany({ where: { id: { in: cardIds } } });
    await db.restaurant.deleteMany({ where: { id: { in: restaurantIds } } });
    await db.$disconnect();
  }
});
