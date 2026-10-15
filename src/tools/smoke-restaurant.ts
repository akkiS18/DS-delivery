import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db.js';
import { staffOrderDetails, takeStaffAction } from '../modules/restaurant/service.js';

// Isolated database smoke. It never creates a real payment or sends a Telegram message.
const nonce = randomUUID().replace(/-/g, '').slice(0, 10);
const suffix = nonce.replace(/[a-f]/g, '1').slice(0, 8);
const staffTelegramId = `9911${suffix}`;
const customerTelegramId = `9922${suffix}`;
let restaurantId: string | undefined;
let orderId: string | undefined;
let customerId: string | undefined;
try {
  console.log('[SMOKE RESTAURANT] Isolated MOCK-only DB workflow');
  const restaurant = await db.restaurant.create({
    data: { slug: `staff-smoke-${nonce}`, name: 'Restoran smoke test', staffTelegramUserId: staffTelegramId, staffLinkedAt: null },
  });
  restaurantId = restaurant.id;
  const customer = await db.customer.create({ data: { telegramUserId: customerTelegramId, displayName: 'Test Customer' } });
  customerId = customer.id;
  const order = await db.order.create({
    data: {
      restaurantId, customerId, addressText: 'Sinov manzil', phoneSnapshot: '+998901234567',
      totalSom: 21000, status: 'PAYMENT_PENDING', createdViaBot: true,
      payment: { create: { restaurantId, amountTiyin: 2_100_000n, status: 'AWAITING', isTest: true } },
    },
  });
  orderId = order.id;
  await assert.rejects(() => takeStaffAction({ actorTelegramId: staffTelegramId, orderId: order.id, action: 'VERIFY_PAYMENT' }), /TOLOV_MOS/);
  console.log('[OK] No staff confirmation before a matched payment');
  // Simulate *output* of the matching engine, not bank receipt. No real payment is sent.
  await db.order.update({ where: { id: order.id }, data: { status: 'PAYMENT_MATCHED_UNVERIFIED' } });
  await db.payment.update({ where: { orderId: order.id }, data: { status: 'MATCHED_UNVERIFIED' } });
  await assert.rejects(() => takeStaffAction({ actorTelegramId: '99881122', orderId: order.id, action: 'VERIFY_PAYMENT' }), /RUXSAT_YOQ/);
  assert.equal(await staffOrderDetails('99881122', order.id), null);
  console.log('[OK] Other Telegram account cannot view or change the order');
  const confirmed = await takeStaffAction({ actorTelegramId: staffTelegramId, orderId: order.id, action: 'VERIFY_PAYMENT' });
  assert.equal(confirmed.status, 'PAYMENT_CONFIRMED');
  assert.equal((await db.payment.findUniqueOrThrow({ where: { orderId: order.id } })).status, 'CONFIRMED_MANUAL');
  await assert.rejects(() => takeStaffAction({ actorTelegramId: staffTelegramId, orderId: order.id, action: 'VERIFY_PAYMENT' }));
  console.log('[OK] Payment manually verified once; duplicate blocked');
  const preparing = await takeStaffAction({ actorTelegramId: staffTelegramId, orderId: order.id, action: 'START_PREPARING', prepMinutes: 15 });
  assert.equal(preparing.status, 'PREPARING');
  console.log('[OK] 15 minute preparation set');
  const ready = await takeStaffAction({ actorTelegramId: staffTelegramId, orderId: order.id, action: 'MARK_READY' });
  assert.equal(ready.status, 'READY');
  const saved = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { events: true } });
  assert.equal(saved.events.length, 3);
  assert.equal(saved.prepMinutes, 15);
  assert.ok(saved.readyAt);
  console.log('[OK] READY status, timestamps and 3 audit events');
  console.log('[PASS] Restaurant workflow + staff authorization + DB audit');
} catch (err) {
  console.error('[FAIL] Restaurant DB smoke:', err);
  process.exitCode = 1;
} finally {
  try {
    if (orderId) {
      await db.payment.deleteMany({ where: { orderId } });
      await db.order.deleteMany({ where: { id: orderId } });
    }
    if (customerId) await db.customer.deleteMany({ where: { id: customerId } });
    if (restaurantId) await db.restaurant.deleteMany({ where: { id: restaurantId } });
  } catch (error) {
    console.error('[CLEANUP ERROR] Manual cleanup may be necessary:', error);
    process.exitCode = 1;
  } finally { await db.$disconnect(); }
}
