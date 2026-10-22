import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { storeReceipt } from '../modules/refunds/receipts.js';
import { purgeExpiredReceipts, receiptRetentionDays } from '../modules/refunds/retention.js';
import { fakePng, useTempReceiptDir } from './receipt-fixtures.js';

// Stage 8C: refund receipt retention. ds_delivery_test only; files go to a throw-away directory.
const dir = useTempReceiptDir();
delete process.env.RECEIPT_RETENTION_DAYS;
const db = new PrismaClient();
const nonce = randomUUID().slice(0, 8);
let restaurantId = '';
let customerId = '';
const DAY = 86_400_000;

/** A refund row in the given state with a real stored photo, sent `ageDays` ago. */
async function refund(status: 'SENT' | 'CONFIRMED' | 'DISPUTED', ageDays: number, withFile = true) {
  const som = randomInt(10_000, 900_000);
  const matched = await db.incomingTransaction.create({
    data: { sourceId: `rr-${randomUUID()}`, source: 'test', cardLast4: '0000', amountTiyin: BigInt(som) * 100n, occurredAt: new Date() },
  });
  const order = await db.order.create({ data: {
    restaurantId, customerId, addressText: 'x', totalSom: som, createdViaBot: true, status: 'PAYMENT_CONFIRMED', paymentIsTest: false,
    payment: { create: { restaurantId, amountTiyin: BigInt(som) * 100n, status: 'CONFIRMED_MANUAL', isTest: false, matchedTransactionId: matched.id } },
  } });
  const pay = await db.payment.findUniqueOrThrow({ where: { orderId: order.id } });
  const stored = await storeReceipt(fakePng(), dir);
  if (!withFile) await import('node:fs/promises').then(fs => fs.rm(path.join(dir, stored.key)));
  const sentAt = new Date(Date.now() - ageDays * DAY);
  const row = await db.refundRequest.create({ data: {
    orderId: order.id, paymentId: pay.id, kind: 'CUSTOMER_CANCEL', status, reasonCode: 'CHANGED_MIND', paidAmountTiyin: pay.amountTiyin,
    orderStatusBefore: 'PAYMENT_CONFIRMED', paymentStatusAtRequest: 'CONFIRMED_MANUAL', requestedBy: 'c', requestedByType: 'CUSTOMER',
    approvedAmountTiyin: pay.amountTiyin, decidedBy: 's', decidedAt: sentAt, sentBy: 's', sentAt,
    receiptKey: stored.key, receiptMime: stored.mime, receiptBytes: stored.bytes, receiptSha256: stored.sha256,
    ...(status === 'CONFIRMED' ? { confirmedBy: 'c', confirmedAt: sentAt, confirmedByType: 'CUSTOMER' } : {}),
  } });
  return { row, stored };
}
const fresh = (id: string) => db.refundRequest.findUniqueOrThrow({ where: { id } });

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  restaurantId = (await db.restaurant.create({ data: { slug: `rr-${nonce}`, name: `RR ${nonce}`, pickupAddress: 'P' } })).id;
  customerId = (await db.customer.create({ data: { telegramUserId: String(randomInt(900000000001, 990000000000)) } })).id;
});

after(async () => {
  const orders = (await db.order.findMany({ where: { restaurantId }, select: { id: true } })).map(o => o.id);
  const pays = await db.payment.findMany({ where: { restaurantId }, select: { id: true, matchedTransactionId: true } });
  await db.refundRequest.deleteMany({ where: { orderId: { in: orders } } });
  await db.payment.deleteMany({ where: { id: { in: pays.map(p => p.id) } } });
  await db.incomingTransaction.deleteMany({ where: { id: { in: pays.map(p => p.matchedTransactionId).filter((x): x is string => !!x) } } });
  await db.order.deleteMany({ where: { restaurantId } });
  await db.customer.deleteMany({ where: { id: customerId } });
  await db.restaurant.deleteMany({ where: { id: restaurantId } });
  await db.$disconnect();
});

test('the retention period comes from RECEIPT_RETENTION_DAYS (default 365, sane range only)', () => {
  assert.equal(receiptRetentionDays({}), 365);
  assert.equal(receiptRetentionDays({ RECEIPT_RETENTION_DAYS: '90' }), 90);
  for (const bad of ['0', '29', '99999', 'x', '']) assert.equal(receiptRetentionDays({ RECEIPT_RETENTION_DAYS: bad }), 365, bad);
});

test('an old CONFIRMED refund loses its photo (file and key) but keeps type, size, hash and the purge time; a second pass changes nothing', async () => {
  const { row, stored } = await refund('CONFIRMED', 400);
  assert.equal(existsSync(path.join(dir, stored.key)), true);
  const r = await purgeExpiredReceipts(new Date(), dir);
  assert.ok(r.purged >= 1);
  assert.equal(existsSync(path.join(dir, stored.key)), false, 'the file is gone from the volume');
  const after = await fresh(row.id);
  assert.equal(after.receiptKey, null);
  assert.equal(after.receiptMime, stored.mime);
  assert.equal(after.receiptBytes, stored.bytes);
  assert.equal(after.receiptSha256, stored.sha256);
  assert.ok(after.receiptPurgedAt);
  assert.equal(after.status, 'CONFIRMED');
  assert.equal((await purgeExpiredReceipts(new Date(), dir)).purged, 0, 'idempotent');
});

test('recent, SENT and DISPUTED refunds are never purged (still evidence)', async () => {
  const young = await refund('CONFIRMED', 10);
  const sent = await refund('SENT', 800);
  const disputed = await refund('DISPUTED', 800);
  await purgeExpiredReceipts(new Date(), dir);
  for (const x of [young, sent, disputed]) {
    assert.ok((await fresh(x.row.id)).receiptKey, x.row.status);
    assert.equal(existsSync(path.join(dir, x.stored.key)), true, x.row.status);
  }
});

test('the period is configurable, and a photo that is already missing does not block the purge', async () => {
  const forty = await refund('CONFIRMED', 40);
  const missing = await refund('CONFIRMED', 60, false);
  const env = { RECEIPT_RETENTION_DAYS: '30' } as NodeJS.ProcessEnv;
  await purgeExpiredReceipts(new Date(), dir, env);
  assert.equal((await fresh(forty.row.id)).receiptKey, null);
  assert.equal(existsSync(path.join(dir, forty.stored.key)), false);
  assert.equal((await fresh(missing.row.id)).receiptKey, null, 'row settled although the file was already gone');
});

test('the database accepts a purged row, refuses half-states, and the same image still cannot prove a second refund', async () => {
  const purged = await db.refundRequest.findFirstOrThrow({ where: { order: { restaurantId }, receiptPurgedAt: { not: null } } });
  // a key removed without recording the purge is invalid; so is a purge time without the descriptive columns
  const live = await refund('CONFIRMED', 1);
  await assert.rejects(db.refundRequest.update({ where: { id: live.row.id }, data: { receiptKey: null } }), /RefundRequest_receipt_complete|check constraint/i);
  await assert.rejects(db.refundRequest.update({ where: { id: live.row.id }, data: { receiptPurgedAt: new Date() } }), /RefundRequest_receipt_complete|check constraint/i);
  // the purged refund's hash is still reserved by the unique index
  const another = await refund('SENT', 1);
  await assert.rejects(db.refundRequest.update({ where: { id: another.row.id }, data: { receiptSha256: purged.receiptSha256 } }), /Unique constraint|unique/i);
});
