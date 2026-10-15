import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db.js';
import { takeStaffAction } from '../modules/restaurant/service.js';
import { respondToTaxi } from '../modules/taxi/service.js';
import { runTaxiDispatchCycle } from '../modules/taxi/worker.js';
import type { Telegraf } from 'telegraf';

// Creates an isolated MOCK-only order; never sends real Telegram messages.
const nonce = randomUUID().replace(/-/g, '').slice(0, 10);
const uid = BigInt('0x' + nonce).toString().slice(0, 11);
const staffId = '81' + uid;
const customerTelegramId = '82' + uid;
const firstId = '83' + uid;
const secondId = '84' + uid;
const sent: { chatId: string; message: string }[] = [];
let messageId = 1;
const fakeBot = {
  telegram: {
    sendMessage: async (chatId: string, message: string) => {
      sent.push({ chatId: String(chatId), message });
      return { message_id: messageId++ };
    },
  },
} as unknown as Telegraf<any>;
let restaurantId: string | undefined;
let customerId: string | undefined;
let orderId: string | undefined;
let firstCompanyId: string | undefined;
let secondCompanyId: string | undefined;

try {
  console.log('[SMOKE TAXI] Isolated PostgreSQL + fake Telegram transport');
  const restaurant = await db.restaurant.create({
    data: { slug: `taxi-test-${nonce}`, name: 'Restoran TAXI TEST', pickupAddress: 'TEST pickup',
      pickupPhone: '+998901234567', staffTelegramUserId: staffId, staffLinkedAt: new Date() },
  });
  restaurantId = restaurant.id;
  const customer = await db.customer.create({ data: { telegramUserId: customerTelegramId, displayName: 'Taxi smoke customer' } });
  customerId = customer.id;
  const company1 = await db.taxiCompany.create({ data: {
    name: `Taxi A TEST ${nonce}`, operatorTelegramUserId: firstId, operatorLinkedAt: new Date(),
  } });
  firstCompanyId = company1.id;
  const company2 = await db.taxiCompany.create({ data: {
    name: `!SMOKE taxi B ${nonce}`, operatorTelegramUserId: secondId, operatorLinkedAt: new Date(),
  } });
  secondCompanyId = company2.id;
  const order = await db.order.create({ data: {
    restaurantId: restaurant.id, customerId: customer.id, taxiCompanyId: company1.id,
    addressText: 'TEST: mustaqillik 12', phoneSnapshot: '+998901112233',
    totalSom: 21_000, status: 'PAYMENT_MATCHED_UNVERIFIED', createdViaBot: true, allowTaxiFallback: true,
    payment: { create: { restaurantId: restaurant.id, isTest: true, status: 'MATCHED_UNVERIFIED', amountTiyin: 2_100_000n } },
  } });
  orderId = order.id;
  await takeStaffAction({ actorTelegramId: staffId, orderId: order.id, action: 'VERIFY_PAYMENT' });
  const preparing = await takeStaffAction({ actorTelegramId: staffId, orderId: order.id, action: 'START_PREPARING', prepMinutes: 10 });
  assert.equal(preparing.status, 'PREPARING');
  let dispatches = await db.taxiDispatch.findMany({ where: { orderId: order.id } });
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0]!.status, 'SCHEDULED');
  assert.ok(dispatches[0]!.dueAt.getTime() > Date.now());
  console.log('[OK] One persistent scheduled dispatch before food READY');
  // Simulate expected food being ready earlier: staff button advances taxi schedule.
  await takeStaffAction({ actorTelegramId: staffId, orderId: order.id, action: 'MARK_READY' });
  assert.equal((await db.taxiDispatch.findUniqueOrThrow({ where: { id: dispatches[0]!.id } })).status, 'SCHEDULED');
  await runTaxiDispatchCycle(fakeBot, order.id);
  assert.ok(sent.some(x => x.chatId === firstId && x.message.includes('Taxi A TEST')));
  assert.equal((await db.taxiDispatch.findUniqueOrThrow({ where: { id: dispatches[0]!.id } })).status, 'REQUESTED');
  console.log('[OK] Food READY advances schedule; authorized taxi operator notified');
  // DB-level partial unique index prevents a second simultaneously active dispatcher.
  await assert.rejects(() => db.taxiDispatch.create({ data: {
    orderId: order.id, taxiCompanyId: company2.id, attemptNo: 2,
    status: 'SCHEDULED', dueAt: new Date(),
  } }));
  console.log('[OK] DB unique index rejects two active taxi requests');
  // Force the operator timeout without waiting 3 minutes.
  await db.taxiDispatch.update({ where: { id: dispatches[0]!.id },
    data: { expiresAt: new Date(Date.now() - 1_000) } });
  await runTaxiDispatchCycle(fakeBot, order.id);
  const timedOut = await db.taxiDispatch.findUniqueOrThrow({ where: { id: dispatches[0]!.id } });
  assert.equal(timedOut.status, 'CANCELLATION_PENDING');
  assert.equal(await db.taxiDispatch.count({ where: { orderId: order.id } }), 1);
  assert.ok(sent.some(x => x.chatId === firstId && x.message.includes('javob muddati tugadi')));
  console.log('[OK] Timeout requests acknowledgement, does NOT call a second taxi');
  await assert.rejects(() => respondToTaxi({ actorTelegramId: secondId, dispatchId: dispatches[0]!.id, action: 'SENT' }), /RUXSAT_YOQ/);
  console.log('[OK] Second operator cannot act on first company request');
  const rejected = await respondToTaxi({ actorTelegramId: firstId, dispatchId: dispatches[0]!.id, action: 'NO_TAXI' });
  assert.equal(rejected.finalStatus, 'DECLINED');
  assert.ok(rejected.fallbackCompany?.includes('SMOKE taxi B'));
  assert.ok(rejected.nextDispatchId);
  assert.equal((await respondToTaxi({ actorTelegramId: firstId, dispatchId: dispatches[0]!.id, action: 'SENT' })).changed, false);
  console.log('[OK] Explicit NO_TAXI + consent fallback; late first operator blocked');
  await runTaxiDispatchCycle(fakeBot, order.id);
  assert.ok(sent.some(x => x.chatId === secondId && x.message.includes('SMOKE taxi B')));
  assert.equal((await db.taxiDispatch.findUniqueOrThrow({ where: { id: rejected.nextDispatchId! } })).status, 'REQUESTED');
  const accepted = await respondToTaxi({ actorTelegramId: secondId, dispatchId: rejected.nextDispatchId!, action: 'SENT' });
  assert.equal(accepted.finalStatus, 'ASSIGNED');
  assert.equal((await respondToTaxi({ actorTelegramId: secondId, dispatchId: rejected.nextDispatchId!, action: 'SENT' })).changed, false);
  await runTaxiDispatchCycle(fakeBot, order.id);
  assert.ok(sent.some(x => x.chatId === customerTelegramId && x.message.includes('haydovchi')));
  assert.ok(sent.some(x => x.chatId === staffId && x.message.includes('haydovchi')));
  const active = await db.taxiDispatch.count({
    where: { orderId: order.id, status: { in: ['SCHEDULED','SENDING','REQUESTED','CANCELLATION_PENDING','ASSIGNED','NEEDS_HELP'] } },
  });
  assert.equal(active, 1);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'READY');
  console.log('[OK] Only 1 active driver, repeat callback ignored; customer & staff informed');
  console.log('[PASS] PostgreSQL dispatch schedule + transport + fallback + authorization + deduplication');
} catch (err) {
  console.error('[FAIL] TAXI smoke:', err);
  process.exitCode = 1;
} finally {
  try {
    if (orderId) {
      await db.taxiDispatch.deleteMany({ where: { orderId } });
      await db.orderEvent.deleteMany({ where: { orderId } });
      await db.payment.deleteMany({ where: { orderId } });
      await db.order.delete({ where: { id: orderId } });
    }
    if (customerId) await db.customer.delete({ where: { id: customerId } });
    if (restaurantId) await db.restaurant.delete({ where: { id: restaurantId } });
    for (const id of [firstCompanyId, secondCompanyId]) {
      if (id) await db.taxiCompany.delete({ where: { id } });
    }
  } catch (err) {
    console.error('[TAXI SMOKE CLEANUP FAILED]', err);
    process.exitCode = 1;
  } finally { await db.$disconnect(); }
}
