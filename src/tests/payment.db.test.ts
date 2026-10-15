import assert from 'node:assert/strict';
import test from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});

test('PostgreSQL: parallel identical checkouts remain collision-free per restaurant', { timeout: 120_000 }, async () => {
  await db.$connect();
  const slug = `db-test-${randomUUID()}`;
  const restaurant = await db.restaurant.create({ data: { slug, name: 'DB test restaurant' } });
  const customer = await db.customer.create({ data: { telegramUserId: String(randomInt(100000000000, 900000000000)) } });
  const product = await db.product.create({ data: { restaurantId: restaurant.id, name: 'Unit test burger', priceSom: 21_000 } });
  const cards: string[] = [];
  try {
    while (cards.length < 2) {
      const last4 = String(randomInt(1000, 9999));
      if (!await db.card.findUnique({ where: { last4 } }) && !cards.includes(last4)) {
        cards.push(last4);
        await engine.addCard(last4, true, restaurant.id);
      }
    }
    await Promise.all(Array.from({ length: 8 }, () => engine.createCheckout(async tx => {
      return tx.order.create({ data: {
        restaurantId: restaurant.id, customerId: customer.id, addressText: 'Test manzili', totalSom: 21000,
        items: { create: [{ productId: product.id, name: product.name, unitSom: 21000, quantity: 1, subtotalSom: 21000 }] },
      } });
    }, true)));
    const active = await db.payment.findMany({ where: { restaurantId: restaurant.id, status: 'AWAITING' } });
    const queued = await db.payment.count({ where: { restaurantId: restaurant.id, status: 'QUEUED' } });
    assert.equal(active.length, 2);
    assert.equal(queued, 6);
    assert.notEqual(active[0].cardId, active[1].cardId);
    assert(active.every(x => x.orderId));
    const payment = active[0];
    const card = await db.card.findUniqueOrThrow({ where: { id: payment.cardId! } });
    const result = await engine.ingestMock(2_100_000n, card.last4);
    assert.equal(result.status, 'MATCHED_UNVERIFIED');
    const updated = await db.order.findUniqueOrThrow({ where: { id: payment.orderId! } });
    assert.equal(updated.status, 'PAYMENT_MATCHED_UNVERIFIED');
  } finally {
    // The following cleanup targets ONLY this uniquely named test restaurant.
    const payments = await db.payment.findMany({ where: { restaurantId: restaurant.id }, select: { id: true } });
    const ids = payments.map(p => p.id);
    await db.incomingTransaction.deleteMany({ where: { matchedPaymentId: { in: ids } } });
    await db.payment.deleteMany({ where: { id: { in: ids } } });
    const cardRows = await db.card.findMany({ where: { restaurantId: restaurant.id }, select: { id: true } });
    await db.cardCooldown.deleteMany({ where: { cardId: { in: cardRows.map(x => x.id) } } });
    await db.card.deleteMany({ where: { restaurantId: restaurant.id } });
    const orders = await db.order.findMany({ where: { restaurantId: restaurant.id }, select: { id: true } });
    await db.orderItem.deleteMany({ where: { orderId: { in: orders.map(x => x.id) } } });
    await db.order.deleteMany({ where: { restaurantId: restaurant.id } });
    await db.product.deleteMany({ where: { restaurantId: restaurant.id } });
    await db.customer.delete({ where: { id: customer.id } });
    await db.restaurant.delete({ where: { id: restaurant.id } });
    await db.$disconnect();
  }
});
