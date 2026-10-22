import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient, type OrderStatus } from '@prisma/client';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { takeStaffAction } from '../modules/restaurant/service.js';
import { db as appDb } from '../lib/db.js';
import { fakePng, useTempReceiptDir } from './receipt-fixtures.js';

const ADMIN = String(randomInt(100000000000, 400000000000));
process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = ADMIN; // read per call by the support helpers
const receiptDir = useTempReceiptDir();
const { storeReceipt } = await import('../modules/refunds/receipts.js');
const {
  adminConfirmRefund, cancelUnpaidOrder, customerAnswerRefund, decideRefund, markRefundSent, requestCancellation,
} = await import('../modules/refunds/service.js');

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const staffId = String(randomInt(400000000001, 600000000000));
const otherStaffId = String(randomInt(600000000001, 700000000000));
const customerTg = String(randomInt(700000000001, 800000000000));
const strangerTg = String(randomInt(800000000001, 900000000000));
let restaurantId = '';
let otherRestaurantId = '';
let taxiId = '';
let customerId = '';
let testLast4 = '';
const PAID = 2_100_000n; // 21,000 so'm

const cb = () => randomUUID();
/** A stored, valid receipt photo (unique bytes, so a unique SHA-256). */
const rcpt = () => storeReceipt(fakePng());

/** A paid-looking order. Payments are isTest (the only kind that may be forced into a matched state without a mail). */
async function paidOrder(status: OrderStatus = 'PAYMENT_CONFIRMED', payStatus = 'CONFIRMED_MANUAL', som = 21_000) {
  const order = await db.order.create({ data: {
    restaurantId, customerId, addressText: 'x', totalSom: som, createdViaBot: true, taxiCompanyId: taxiId, status,
    // A waiting order has no payment at all (a DB trigger forbids it).
    ...(status.startsWith('WAITING') ? {} : { payment: { create: { restaurantId, amountTiyin: BigInt(som) * 100n, status: payStatus, isTest: true } } }),
  } });
  return order;
}
const order = (id: string) => db.order.findUniqueOrThrow({ where: { id } });
const refundOf = (orderId: string) => db.refundRequest.findFirstOrThrow({ where: { orderId }, orderBy: { requestedAt: 'desc' } });
const customerRequest = (orderId: string, actor = customerTg) =>
  requestCancellation({ actorType: 'CUSTOMER', actorTelegramId: actor, orderId, reasonCode: 'CHANGED_MIND' });
const staffCancel = (orderId: string, actor = staffId) =>
  requestCancellation({ actorType: 'RESTAURANT_STAFF', actorTelegramId: actor, orderId, reasonCode: 'OUT_OF_STOCK' });
const approve = (refundId: string, actor = staffId) => decideRefund({ actorTelegramId: actor, refundId, decision: 'APPROVE' });
const dispatch = (orderId: string, status: 'SCHEDULED' | 'REQUESTED') => db.taxiDispatch.create({
  data: { orderId, taxiCompanyId: taxiId, attemptNo: 1, status, dueAt: new Date(Date.now() + 3_600_000) } });
async function approvedRefund() {
  const o = await paidOrder();
  const r = await customerRequest(o.id);
  assert.equal(r.result, 'REQUESTED');
  if (r.result !== 'REQUESTED') throw new Error('unreachable');
  assert.equal((await approve(r.refundId)).result, 'DONE');
  return { o, refundId: r.refundId };
}
const actionsOf = async (refundId: string) => (await db.refundEvent.findMany({ where: { refundId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(e => e.action);

before(async () => {
  await db.$connect();
  restaurantId = (await db.restaurant.create({ data: { slug: `refund-${randomUUID()}`, name: 'Refund test', staffTelegramUserId: staffId } })).id;
  otherRestaurantId = (await db.restaurant.create({ data: { slug: `refund-o-${randomUUID()}`, name: 'Other', staffTelegramUserId: otherStaffId } })).id;
  taxiId = (await db.taxiCompany.create({ data: { name: `Taxi ${randomUUID()}`, operatorTelegramUserId: String(randomInt(900000000001, 990000000000)), isActive: true } })).id;
  customerId = (await db.customer.create({ data: { telegramUserId: customerTg } })).id;
  await db.customer.create({ data: { telegramUserId: strangerTg } });
  for (;;) { const a = String(randomInt(1000, 9999)); if (!await db.card.findUnique({ where: { last4: a } })) { testLast4 = a; break; } }
  await engine.addCard(testLast4, true, restaurantId);
});
after(async () => {
  const orders = (await db.order.findMany({ where: { restaurantId }, select: { id: true } })).map(o => o.id);
  await db.refundRequest.deleteMany({ where: { orderId: { in: orders } } }); // cascades RefundEvent
  const pays = (await db.payment.findMany({ where: { restaurantId }, select: { id: true } })).map(p => p.id);
  await db.incomingTransaction.deleteMany({ where: { OR: [{ matchedPaymentId: { in: pays } }, { cardLast4: testLast4 }] } });
  await db.payment.deleteMany({ where: { id: { in: pays } } });
  const cards = (await db.card.findMany({ where: { restaurantId }, select: { id: true } })).map(c => c.id);
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards } } });
  await db.card.deleteMany({ where: { restaurantId } });
  await db.order.deleteMany({ where: { restaurantId } }); // cascades dispatches and events
  await db.customer.deleteMany({ where: { telegramUserId: { in: [customerTg, strangerTg] } } });
  await db.taxiCompany.delete({ where: { id: taxiId } });
  await db.restaurant.deleteMany({ where: { id: { in: [restaurantId, otherRestaurantId] } } });
  await db.$disconnect();
  await appDb.$disconnect();
});

// ------------------------------------------------------------------ unpaid cancellation
test('unpaid cancellation: owner only, payment attempt cancelled (kept), card cooldown, late mail goes to manual review', async () => {
  const { order: o, payment } = await engine.createCheckout(tx => tx.order.create({ data: {
    restaurantId, customerId, addressText: 'x', totalSom: 21_000, createdViaBot: true } }), true);
  assert.equal(payment.status, 'AWAITING');
  assert.deepEqual(await cancelUnpaidOrder(engine, { telegramUserId: strangerTg, orderId: o.id }), { result: 'NOT_FOUND' });
  assert.equal((await order(o.id)).status, 'PAYMENT_PENDING');
  assert.deepEqual(await cancelUnpaidOrder(engine, { telegramUserId: customerTg, orderId: o.id }), { result: 'CANCELLED' });
  const row = await order(o.id);
  assert.equal(row.status, 'CANCELLED');
  assert.equal(row.cancelledBy, customerTg);
  assert.equal(row.cancelReason, 'CUSTOMER_UNPAID');
  const pay = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
  assert.equal(pay.status, 'CANCELLED'); // history kept, never deleted
  assert.equal(pay.amountTiyin, PAID);
  assert.deepEqual((await db.paymentEvent.findMany({ where: { paymentId: pay.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(e => e.action), ['CREATED', 'ASSIGNED', 'CANCELLED']);
  assert.equal((await cancelUnpaidOrder(engine, { telegramUserId: customerTg, orderId: o.id })).result, 'NOT_CANCELLABLE');
  // the card/amount pair is cooling down: a new identical order does not get the card right away
  const again = await engine.createCheckout(tx => tx.order.create({ data: { restaurantId, customerId, addressText: 'x', totalSom: 21_000, createdViaBot: true } }), true);
  assert.notEqual(again.payment.status, 'AWAITING');
  // a transfer that was already on its way is NOT matched; it becomes a manual-review item (Stage 4A)
  const late = await engine.ingestMock(PAID, testLast4);
  assert.equal(late.status, 'REVIEW_REQUIRED');
  assert.equal(late.reason, 'LATE_FOR_EXPIRED_PAYMENT');
  assert.equal((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status, 'CANCELLED');
  assert.equal((await order(o.id)).status, 'CANCELLED');
});

test('unpaid cancellation racing a payment match: never a cancelled order with a matched payment', async () => {
  for (let i = 0; i < 3; i++) {
    const som = 30_000 + i * 1_000;
    const { order: o, payment } = await engine.createCheckout(tx => tx.order.create({ data: { restaurantId, customerId, addressText: 'x', totalSom: som, createdViaBot: true } }), true);
    if (payment.status !== 'AWAITING') continue; // cooldown from an earlier loop; nothing to race
    const card = await db.card.findUniqueOrThrow({ where: { id: payment.cardId! } });
    const [c, m] = await Promise.all([cancelUnpaidOrder(engine, { telegramUserId: customerTg, orderId: o.id }), engine.ingestMock(payment.amountTiyin, card.last4)]);
    const [ord, pay] = [await order(o.id), await db.payment.findUniqueOrThrow({ where: { id: payment.id } })];
    if (c.result === 'CANCELLED') {
      assert.deepEqual([ord.status, pay.status, m.status], ['CANCELLED', 'CANCELLED', 'REVIEW_REQUIRED']);
    } else {
      assert.equal(c.result, 'USE_REFUND_REQUEST');
      assert.deepEqual([ord.status, pay.status, m.status], ['PAYMENT_MATCHED_UNVERIFIED', 'MATCHED_UNVERIFIED', 'MATCHED_UNVERIFIED']);
    }
  }
});

// ------------------------------------------------------------------ paid cancellation -> refund request
test('customer cancellation of a paid order creates ONE request, freezes the order, and is owner-scoped', async () => {
  const o = await paidOrder();
  assert.deepEqual(await customerRequest(o.id, strangerTg), { result: 'NOT_FOUND' });
  await assert.rejects(requestCancellation({ actorType: 'CUSTOMER', actorTelegramId: customerTg, orderId: o.id, reasonCode: 'BOGUS' }), /SABAB_NOTOGRI/);
  const rs = await Promise.all(Array.from({ length: 6 }, () => customerRequest(o.id)));
  assert.equal(rs.filter(r => r.result === 'REQUESTED').length, 1);
  assert.equal(rs.filter(r => r.result === 'ALREADY_REQUESTED').length, 5);
  const r = await refundOf(o.id);
  assert.deepEqual([r.status, r.kind, r.paidAmountTiyin, r.orderStatusBefore, r.paymentStatusAtRequest, r.requestedBy, r.requestedByType, r.reasonCode],
    ['REQUESTED', 'CUSTOMER_CANCEL', PAID, 'PAYMENT_CONFIRMED', 'CONFIRMED_MANUAL', customerTg, 'CUSTOMER', 'CHANGED_MIND']);
  assert.equal(r.approvedAmountTiyin, null);
  assert.equal((await order(o.id)).status, 'CANCELLATION_REQUESTED');
  assert.equal(await db.refundRequest.count({ where: { orderId: o.id } }), 1);
  assert.deepEqual(await actionsOf(r.id), ['REQUESTED']);
  // frozen: staff cannot start cooking or verify until the restaurant decides
  await assert.rejects(takeStaffAction({ actorTelegramId: staffId, orderId: o.id, action: 'START_PREPARING', prepMinutes: 15 }));
  assert.equal((await order(o.id)).status, 'CANCELLATION_REQUESTED');
  // payment history untouched
  const pay = await db.payment.findUniqueOrThrow({ where: { orderId: o.id } });
  assert.deepEqual([pay.status, pay.amountTiyin], ['CONFIRMED_MANUAL', PAID]);
});

test('invalid cancellation transitions are refused without changing anything', async () => {
  for (const [status, expected] of [['COMPLETED', 'NOT_ALLOWED'], ['READY', 'NOT_ALLOWED'], ['DELIVERY_ASSUMED', 'NOT_ALLOWED'],
    ['CANCELLED', 'NOT_ALLOWED'], ['PAYMENT_EXPIRED', 'NOT_ALLOWED'], ['PAYMENT_PENDING', 'USE_UNPAID_CANCEL'], ['WAITING_RESTAURANT', 'USE_WAITING_CANCEL']] as const) {
    const o = await paidOrder(status);
    assert.equal((await customerRequest(o.id)).result, expected, status);
    assert.equal((await order(o.id)).status, status);
    assert.equal(await db.refundRequest.count({ where: { orderId: o.id } }), 0);
  }
  // order says paid but the payment disagrees (e.g. only a queued attempt): no refund can exist
  const odd = await paidOrder('PAYMENT_CONFIRMED', 'AWAITING');
  assert.equal((await customerRequest(odd.id)).result, 'NOT_ALLOWED');
  // restaurant cannot cancel something it has not verified
  const unverified = await paidOrder('PAYMENT_MATCHED_UNVERIFIED', 'MATCHED_UNVERIFIED');
  assert.equal((await staffCancel(unverified.id)).result, 'NOT_ALLOWED');
  assert.equal((await customerRequest(unverified.id)).result, 'REQUESTED'); // the customer may ask; the restaurant decides
});

test('only the order\'s own restaurant staff can decide; approval cancels the order and a scheduled taxi request', async () => {
  const o = await paidOrder('PREPARING');
  const taxi = await dispatch(o.id, 'SCHEDULED');
  const r = await customerRequest(o.id);
  assert.equal(r.result, 'REQUESTED');
  if (r.result !== 'REQUESTED') return;
  await assert.rejects(approve(r.refundId, otherStaffId), /RUXSAT_YOQ/);
  await assert.rejects(approve(r.refundId, customerTg), /RUXSAT_YOQ/);
  await assert.rejects(approve(r.refundId, ADMIN), /RUXSAT_YOQ/);
  assert.equal((await refundOf(o.id)).status, 'REQUESTED');
  const results = await Promise.all([approve(r.refundId), approve(r.refundId), decideRefund({ actorTelegramId: staffId, refundId: r.refundId, decision: 'REJECT', rejectReason: 'POLICY' })]);
  assert.equal(results.filter(x => x.result === 'DONE').length, 1);
  const refund = await refundOf(o.id);
  if (refund.status === 'APPROVED') {
    assert.equal(refund.approvedAmountTiyin, PAID);
    assert.equal(refund.taxiActiveAtDecision, false);
    assert.equal((await order(o.id)).status, 'CANCELLED');
    assert.equal((await db.taxiDispatch.findUniqueOrThrow({ where: { id: taxi.id } })).status, 'CANCELLED');
  } else {
    assert.equal(refund.status, 'REJECTED'); // lost the race to the rejection: order restored, taxi untouched
    assert.equal((await order(o.id)).status, 'PREPARING');
    assert.equal((await db.taxiDispatch.findUniqueOrThrow({ where: { id: taxi.id } })).status, 'SCHEDULED');
  }
  assert.ok((await actionsOf(refund.id)).includes('DECISION_REJECTED'));
});

test('rejection restores the exact previous state and allows a fresh request later', async () => {
  const o = await paidOrder('PAYMENT_CONFIRMED');
  const r1 = await customerRequest(o.id);
  if (r1.result !== 'REQUESTED') throw new Error('unreachable');
  await assert.rejects(decideRefund({ actorTelegramId: staffId, refundId: r1.refundId, decision: 'REJECT', rejectReason: 'BOGUS' }), /RAD_SABABI_NOTOGRI/);
  assert.equal((await decideRefund({ actorTelegramId: staffId, refundId: r1.refundId, decision: 'REJECT', rejectReason: 'ALREADY_PREPARED' })).result, 'DONE');
  assert.equal((await order(o.id)).status, 'PAYMENT_CONFIRMED');
  const rejected = await db.refundRequest.findUniqueOrThrow({ where: { id: r1.refundId } });
  assert.deepEqual([rejected.status, rejected.rejectReason, rejected.decidedBy], ['REJECTED', 'ALREADY_PREPARED', staffId]);
  assert.ok(rejected.decidedAt);
  assert.equal((await decideRefund({ actorTelegramId: staffId, refundId: r1.refundId, decision: 'APPROVE' })).result, 'STALE'); // terminal
  const r2 = await customerRequest(o.id);
  assert.equal(r2.result, 'REQUESTED');
  assert.equal(await db.refundRequest.count({ where: { orderId: o.id } }), 2); // history of both requests kept
});

test('cancellation request racing "start cooking": an open request always means a frozen CANCELLATION_REQUESTED order', async () => {
  for (let i = 0; i < 3; i++) {
    const o = await paidOrder('PAYMENT_CONFIRMED');
    await Promise.allSettled([customerRequest(o.id), takeStaffAction({ actorTelegramId: staffId, orderId: o.id, action: 'START_PREPARING', prepMinutes: 15 })]);
    const open = await db.refundRequest.count({ where: { orderId: o.id, status: 'REQUESTED' } });
    const status = (await order(o.id)).status;
    if (open) assert.equal(status, 'CANCELLATION_REQUESTED');
    else assert.equal(status, 'PREPARING');
    assert.ok(open <= 1);
  }
});

test('approval with a taxi already requested keeps that dispatch and flags it for manual follow-up', async () => {
  const o = await paidOrder('READY');
  const taxi = await dispatch(o.id, 'REQUESTED');
  const r = await staffCancel(o.id);
  assert.equal(r.result, 'APPROVED');
  assert.equal((await order(o.id)).status, 'CANCELLED');
  assert.equal((await db.taxiDispatch.findUniqueOrThrow({ where: { id: taxi.id } })).status, 'REQUESTED'); // not touched
  const refund = await refundOf(o.id);
  assert.equal(refund.taxiActiveAtDecision, true);
  assert.deepEqual([refund.kind, refund.status, refund.approvedAmountTiyin, refund.requestedByType], ['RESTAURANT_CANCEL', 'APPROVED', PAID, 'RESTAURANT_STAFF']);
  assert.equal((await staffCancel(o.id)).result, 'ALREADY_REQUESTED');
  assert.equal((await staffCancel(o.id, otherStaffId)).result, 'NOT_FOUND');
  assert.equal((await customerRequest(o.id)).result, 'ALREADY_REQUESTED');
});

// ------------------------------------------------------------------ manual refund confirmation
test('"sent" needs ONE receipt photo and is only a claim; the restaurant cannot confirm itself', async () => {
  const { o, refundId } = await approvedRefund();
  const r1 = await rcpt();
  await assert.rejects(markRefundSent({ actorTelegramId: otherStaffId, refundId, receipt: r1 }), /RUXSAT_YOQ/);
  await assert.rejects(markRefundSent({ actorTelegramId: customerTg, refundId, receipt: r1 }), /RUXSAT_YOQ/);
  await assert.rejects(markRefundSent({ actorTelegramId: staffId, refundId, receipt: r1, sentAmountTiyin: PAID - 100n }), /REFUND_SUMMASI_MOS_EMAS/);
  assert.equal((await db.refundRequest.findUniqueOrThrow({ where: { id: refundId } })).status, 'APPROVED');
  const rs = await Promise.all(Array.from({ length: 4 }, () => markRefundSent({ actorTelegramId: staffId, refundId, receipt: r1, sentAmountTiyin: PAID })));
  assert.equal(rs.filter(r => r.result === 'DONE').length, 1);
  assert.equal(rs.filter(r => r.result === 'STALE').length, 3);
  const sent = await db.refundRequest.findUniqueOrThrow({ where: { id: refundId } });
  assert.deepEqual([sent.status, sent.bankReference, sent.receiptKey, sent.receiptSha256, sent.sentBy, sent.confirmedBy], ['SENT', null, r1.key, r1.sha256, staffId, null]);
  assert.ok(sent.sentAt);
  // there is no restaurant path to CONFIRMED, and the database refuses an unattested confirmation
  await assert.rejects(db.$executeRaw`UPDATE "RefundRequest" SET "status" = 'CONFIRMED' WHERE "id" = ${refundId}`);
  await assert.rejects(db.$executeRaw`UPDATE "RefundRequest" SET "status" = 'CONFIRMED', "confirmedBy" = ${staffId}, "confirmedByType" = 'RESTAURANT_STAFF', "confirmedAt" = now() WHERE "id" = ${refundId}`);
  // money is "refunded" only after attestation; the order itself stays CANCELLED with its payment untouched
  assert.equal((await order(o.id)).status, 'CANCELLED');
  assert.equal((await db.payment.findUniqueOrThrow({ where: { orderId: o.id } })).status, 'CONFIRMED_MANUAL');
  // the audit row records the image fingerprint, not the image
  const ev = (await db.refundEvent.findMany({ where: { refundId, action: 'SENT' } }))[0]!;
  assert.equal((ev.details as { receiptSha256?: string }).receiptSha256, r1.sha256);
});

test('the same receipt image can never prove two refunds (unique SHA-256)', async () => {
  const a = await approvedRefund();
  const b = await approvedRefund();
  const shared = await rcpt();
  assert.equal((await markRefundSent({ actorTelegramId: staffId, refundId: a.refundId, receipt: shared })).result, 'DONE');
  await assert.rejects(markRefundSent({ actorTelegramId: staffId, refundId: b.refundId, receipt: shared }), /CHEK_RASMI_TAKROR/);
  assert.equal((await db.refundRequest.findUniqueOrThrow({ where: { id: b.refundId } })).status, 'APPROVED');
});

test('an unproven SENT/CONFIRMED refund cannot exist in the database; legacy typed references still satisfy the proof rule', async () => {
  const { refundId } = await approvedRefund();
  await assert.rejects(db.$executeRaw`UPDATE "RefundRequest" SET "status" = 'SENT' WHERE "id" = ${refundId}`);
  await assert.rejects(db.$executeRaw`UPDATE "RefundRequest" SET "status" = 'SENT', "bankReference" = 'ab', "sentBy" = ${staffId}, "sentAt" = now() WHERE "id" = ${refundId}`);
  // receipt columns are all-or-nothing, with a sane key, type, size and hash
  await assert.rejects(db.$executeRaw`UPDATE "RefundRequest" SET "receiptKey" = 'x.png' WHERE "id" = ${refundId}`);
  await assert.rejects(db.$executeRaw`UPDATE "RefundRequest" SET "receiptKey" = ${randomUUID() + '.png'}, "receiptMime" = 'application/pdf', "receiptBytes" = 2048, "receiptSha256" = ${'a'.repeat(64)} WHERE "id" = ${refundId}`);
  await assert.rejects(db.$executeRaw`UPDATE "RefundRequest" SET "receiptKey" = ${randomUUID() + '.png'}, "receiptMime" = 'image/png', "receiptBytes" = 10, "receiptSha256" = ${'a'.repeat(64)} WHERE "id" = ${refundId}`);
  // legacy rows (typed reference, no receipt) remain valid
  assert.equal(await db.$executeRaw`UPDATE "RefundRequest" SET "status" = 'SENT', "bankReference" = 'TRX-LEGACY-1', "sentBy" = ${staffId}, "sentAt" = now() WHERE "id" = ${refundId}`, 1);
  await db.$executeRaw`UPDATE "RefundRequest" SET "status" = 'APPROVED', "bankReference" = NULL, "sentBy" = NULL, "sentAt" = NULL WHERE "id" = ${refundId}`;
  await assert.rejects(db.$executeRaw`UPDATE "RefundRequest" SET "approvedAmountTiyin" = "paidAmountTiyin" + 1 WHERE "id" = ${refundId}`);
  await assert.rejects(db.$executeRaw`UPDATE "RefundRequest" SET "approvedAmountTiyin" = NULL WHERE "id" = ${refundId}`);
});

test('customer attestation: owner only, one winner between "received" and "not received"', async () => {
  const { refundId } = await approvedRefund();
  await markRefundSent({ actorTelegramId: staffId, refundId, receipt: await rcpt() });
  assert.deepEqual(await customerAnswerRefund({ telegramUserId: strangerTg, refundId, received: true }), { result: 'NOT_FOUND' });
  const rs = await Promise.all([customerAnswerRefund({ telegramUserId: customerTg, refundId, received: true }),
    customerAnswerRefund({ telegramUserId: customerTg, refundId, received: false }), customerAnswerRefund({ telegramUserId: customerTg, refundId, received: true })]);
  assert.equal(rs.filter(r => r.result === 'DONE').length, 1);
  const r = await db.refundRequest.findUniqueOrThrow({ where: { id: refundId } });
  assert.ok(r.status === 'CONFIRMED' || r.status === 'DISPUTED');
  if (r.status === 'CONFIRMED') assert.deepEqual([r.confirmedBy, r.confirmedByType], [customerTg, 'CUSTOMER']);
  else assert.ok(r.disputedAt);
});

test('dispute path: restaurant must re-send with a NEW receipt photo; admin confirms only with a typed note; terminal afterwards', async () => {
  const { o, refundId } = await approvedRefund();
  const first = await rcpt();
  await markRefundSent({ actorTelegramId: staffId, refundId, receipt: first });
  assert.equal((await customerAnswerRefund({ telegramUserId: customerTg, refundId, received: false })).result, 'DONE');
  assert.equal((await db.refundRequest.findUniqueOrThrow({ where: { id: refundId } })).status, 'DISPUTED');
  await assert.rejects(markRefundSent({ actorTelegramId: staffId, refundId, receipt: first }), /CHEK_RASMI_TAKROR/);
  // admin: must be a configured admin and give a real note
  await assert.rejects(adminConfirmRefund({ adminTelegramId: strangerTg, refundId, note: 'restoran hisobi tekshirildi' }), /ADMIN_RUXSAT_YOQ/);
  await assert.rejects(adminConfirmRefund({ adminTelegramId: staffId, refundId, note: 'restoran hisobi tekshirildi' }), /ADMIN_RUXSAT_YOQ/);
  await assert.rejects(adminConfirmRefund({ adminTelegramId: ADMIN, refundId, note: 'ok' }), /ADMIN_IZOH_NOTOGRI/);
  assert.equal((await db.refundRequest.findUniqueOrThrow({ where: { id: refundId } })).status, 'DISPUTED');
  assert.equal((await markRefundSent({ actorTelegramId: staffId, refundId, receipt: await rcpt() })).result, 'DONE');
  const note = 'Restoran hisobi ko‘chirmasi va mijoz bilan telefon orqali tekshirildi';
  assert.equal((await adminConfirmRefund({ adminTelegramId: ADMIN, refundId, note })).result, 'DONE');
  const done = await db.refundRequest.findUniqueOrThrow({ where: { id: refundId } });
  assert.deepEqual([done.status, done.confirmedBy, done.confirmedByType, done.confirmNote], ['CONFIRMED', ADMIN, 'ADMIN', note]);
  // terminal: nothing moves it again, and no new request is possible for the same payment/order
  assert.equal((await adminConfirmRefund({ adminTelegramId: ADMIN, refundId, note })).result, 'STALE');
  assert.equal((await customerAnswerRefund({ telegramUserId: customerTg, refundId, received: false })).result, 'STALE');
  assert.equal((await markRefundSent({ actorTelegramId: staffId, refundId, receipt: await rcpt() })).result, 'STALE');
  assert.equal((await customerRequest(o.id)).result, 'NOT_ALLOWED');
  await assert.rejects(db.refundRequest.create({ data: { orderId: o.id, paymentId: done.paymentId, kind: 'CUSTOMER_CANCEL', reasonCode: 'OTHER',
    paidAmountTiyin: PAID, orderStatusBefore: 'PAYMENT_CONFIRMED', paymentStatusAtRequest: 'CONFIRMED_MANUAL', requestedBy: customerTg, requestedByType: 'CUSTOMER' } })); // one refund per payment
  // full audit trail, including the rejected attempts
  const actions = await actionsOf(refundId);
  for (const a of ['REQUESTED', 'APPROVED', 'SENT', 'DISPUTED', 'CONFIRMED', 'ATTEST_REJECTED', 'SEND_REJECTED']) assert.ok(actions.includes(a), a);
});

// ------------------------------------------------------------------ history preservation
test('orders and payments that have a refund record cannot be deleted; the record keeps its snapshot', async () => {
  const { o, refundId } = await approvedRefund();
  await assert.rejects(db.order.delete({ where: { id: o.id } }));
  await assert.rejects(db.payment.delete({ where: { orderId: o.id } }));
  const r = await db.refundRequest.findUniqueOrThrow({ where: { id: refundId } });
  assert.deepEqual([r.paidAmountTiyin, r.paymentStatusAtRequest, r.orderStatusBefore], [PAID, 'CONFIRMED_MANUAL', 'PAYMENT_CONFIRMED']);
  assert.ok(r.requestedAt && r.decidedAt);
});
