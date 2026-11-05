import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { signInitData } from '../modules/miniapp/auth.js';
import { hashToken } from '../modules/miniapp/guest.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { db as appDb } from '../lib/db.js';

// Account deletion (Google Play policy) against ds_delivery_test: personal data is erased, accounting rows stay, open money/food blocks it, a block survives it,
// it is idempotent and safe under concurrency, and it never touches another customer. Rows are deleted by id in after(); AdminAuditEvent is append-only
// by design (DB trigger), so its rows (unique customer ids) stay.
const BOT_TOKEN = '123456789:AAFakeAccountDeletionToken_0123456789';
process.env.BOT_TOKEN = BOT_TOKEN;
process.env.MINIAPP_ENABLED = 'true';
process.env.ANDROID_GUEST_ENABLED = 'true';
process.env.GUEST_BOOTSTRAP_PER_IP_HOUR = '1000';
const { deleteCustomerAccount, DELETED_TEXT } = await import('../modules/miniapp/account-deletion.js');

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const app = buildApp(engine);
const nonce = randomUUID().slice(0, 8);
const customerIds = new Set<string>();
let restaurantId = '';

async function guest(): Promise<{ auth: string; id: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/miniapp/guest/session', payload: { installationId: `ad${nonce}-${randomUUID()}` } });
  assert.equal(res.statusCode, 201, res.body);
  const token = res.json().token as string;
  const g = await db.guestSession.findFirstOrThrow({ where: { tokenHash: hashToken(token) } });
  customerIds.add(g.customerId);
  return { auth: `Bearer ${token}`, id: g.customerId };
}
const del = (auth: string) => app.inject({ method: 'DELETE', url: '/api/v1/miniapp/me', headers: { authorization: auth } });
const order = (customerId: string, over: Record<string, unknown> = {}) =>
  db.order.create({ data: { restaurantId, customerId, addressText: 'Chilonzor 5-uy', totalSom: 10_000, createdViaBot: true, status: 'COMPLETED', phoneSnapshot: '+998901112233', deliveryLat: 41.3, deliveryLng: 69.2, ...over } });

/** A guest with everything a real customer would have stored. */
async function fullCustomer() {
  const g = await guest();
  await db.customer.update({ where: { id: g.id }, data: { phone: '+998901112233', displayName: 'Ali Valiyev' } });
  await db.customerAddress.create({ data: { customerId: g.id, label: 'Uy', addressText: 'Chilonzor 5-uy', lat: 41.3, lng: 69.2, isDefault: true } });
  const o = await order(g.id);
  await db.orderRating.create({ data: { orderId: o.id, restaurantId, customerId: g.id, stars: 2, reasons: [], note: 'Sovuq keldi, telefon 901112233' } });
  const t = await db.supportTicket.create({ data: { orderId: o.id, customerId: g.id, message: 'Mening raqamim +998901112233' } });
  await db.supportTicketMessage.create({ data: { ticketId: t.id, senderType: 'CUSTOMER', senderTelegramId: `app:${g.id}`, senderName: 'Ali', clientKey: `ck-${randomUUID()}`, text: 'Salom, +998901112233' } });
  await db.supportTicketMessage.create({ data: { ticketId: t.id, senderType: 'ADMIN', senderTelegramId: `adm-${randomUUID()}`, telegramMessageId: 1, text: 'Javob berdik' } });
  return { ...g, orderId: o.id, ticketId: t.id };
}

before(async () => {
  await db.$connect();
  restaurantId = (await db.restaurant.create({ data: { slug: `acc-del-${nonce}`, name: `Account deletion ${nonce}` } })).id;
});
after(async () => {
  const all = [...customerIds];
  await db.refundRequest.deleteMany({ where: { order: { restaurantId } } });
  await db.payment.deleteMany({ where: { restaurantId } });
  await db.order.deleteMany({ where: { restaurantId } }); // cascades ratings and tickets
  await db.guestSession.deleteMany({ where: { customerId: { in: all } } });
  await db.telegramLinkAttempt.deleteMany({ where: { guestCustomerId: { in: all } } });
  await db.customerStrike.deleteMany({ where: { customerId: { in: all } } });
  await db.customer.deleteMany({ where: { id: { in: all } } });
  await db.restaurant.deleteMany({ where: { id: restaurantId } });
  await app.close();
  await db.$disconnect();
  await appDb.$disconnect();
});

test('a guest deletes the account: personal data is gone everywhere, the order and its money rows stay, the session dies, another customer is untouched', async () => {
  const me = await fullCustomer();
  const other = await fullCustomer();

  const res = await del(me.auth);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json(), { deleted: true, result: 'DELETED' });

  const c = await db.customer.findUniqueOrThrow({ where: { id: me.id } });
  assert.equal(c.phone, null); assert.equal(c.displayName, null); assert.equal(c.telegramUserId, null);
  assert.ok(c.deletedAt, 'the row stays, marked deleted');
  assert.equal(await db.customerAddress.count({ where: { customerId: me.id } }), 0);
  const o = await db.order.findUniqueOrThrow({ where: { id: me.orderId } });
  assert.equal(o.phoneSnapshot, null); assert.equal(o.addressText, DELETED_TEXT); assert.equal(o.deliveryLat, null); assert.equal(o.deliveryLng, null);
  assert.equal(o.totalSom, 10_000, 'the accounting fields are untouched');
  assert.equal(o.status, 'COMPLETED');
  assert.equal((await db.orderRating.findUniqueOrThrow({ where: { orderId: me.orderId } })).note, null);
  assert.equal((await db.orderRating.findUniqueOrThrow({ where: { orderId: me.orderId } })).stars, 2, 'the number stays, the free text goes');
  assert.equal((await db.supportTicket.findUniqueOrThrow({ where: { id: me.ticketId } })).message, DELETED_TEXT);
  const msgs = await db.supportTicketMessage.findMany({ where: { ticketId: me.ticketId }, orderBy: { createdAt: 'asc' } });
  assert.equal(msgs.find(m => m.senderType === 'CUSTOMER')!.text, DELETED_TEXT);
  assert.equal(msgs.find(m => m.senderType === 'ADMIN')!.text, 'Javob berdik', 'the staff side of the conversation is not the customer\'s data');
  const sessions = await db.guestSession.findMany({ where: { customerId: me.id } });
  assert.ok(sessions.length > 0 && sessions.every(s => s.revokedAt && s.installationId === null && s.revokedReason === 'ACCOUNT_DELETED'));
  const audit = await db.adminAuditEvent.findMany({ where: { targetType: 'Customer', targetId: me.id, action: 'CUSTOMER_ACCOUNT_DELETED' } });
  assert.equal(audit.length, 1); assert.equal(audit[0]!.actorId, `customer:${me.id}`);

  // the old credential is dead
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/miniapp/me', headers: { authorization: me.auth } })).statusCode, 401);

  // the other customer is exactly as before
  const oc = await db.customer.findUniqueOrThrow({ where: { id: other.id } });
  assert.equal(oc.phone, '+998901112233'); assert.equal(oc.deletedAt, null);
  assert.equal(await db.customerAddress.count({ where: { customerId: other.id } }), 1);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: other.orderId } })).phoneSnapshot, '+998901112233');
  assert.equal((await db.guestSession.count({ where: { customerId: other.id, revokedAt: null } })), 1);
});

test('an unfinished order blocks the deletion and nothing is changed', async () => {
  const g = await guest();
  await db.customer.update({ where: { id: g.id }, data: { phone: '+998905550000' } });
  const open = await order(g.id, { status: 'PREPARING' });
  const res = await del(g.auth);
  assert.equal(res.statusCode, 409);
  assert.match(res.body, /OPEN_ORDER/);
  const c = await db.customer.findUniqueOrThrow({ where: { id: g.id } });
  assert.equal(c.phone, '+998905550000'); assert.equal(c.deletedAt, null);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: open.id } })).phoneSnapshot, '+998901112233');
  assert.equal((await db.guestSession.count({ where: { customerId: g.id, revokedAt: null } })), 1, 'still signed in');
  // once it is finished the same call works
  await db.order.update({ where: { id: open.id }, data: { status: 'CANCELLED' } });
  assert.equal((await del(g.auth)).statusCode, 200);
});

test('an open refund blocks the deletion', async () => {
  const g = await guest();
  const o = await order(g.id);
  const pay = await db.payment.create({ data: { orderId: o.id, restaurantId, amountTiyin: 1_000_000n, status: 'CONFIRMED_MANUAL', method: 'CARD', isTest: true } });
  await db.refundRequest.create({ data: { orderId: o.id, paymentId: pay.id, kind: 'CUSTOMER_CANCEL', status: 'REQUESTED', reasonCode: 'OTHER', paidAmountTiyin: 1_000_000n, orderStatusBefore: 'COMPLETED', paymentStatusAtRequest: 'CONFIRMED_MANUAL', requestedBy: 'test', requestedByType: 'CUSTOMER' } });
  const res = await del(g.auth);
  assert.equal(res.statusCode, 409);
  assert.match(res.body, /OPEN_REFUND/);
  await db.refundRequest.deleteMany({ where: { orderId: o.id } });
  await db.payment.deleteMany({ where: { orderId: o.id } });
});

test('a blocked customer can delete the account but keeps the Telegram id on the row, so the block still follows them', async () => {
  const tg = String(randomInt(800_000_000, 900_000_000));
  const c = await db.customer.create({ data: { telegramUserId: tg, displayName: 'Blok', phone: '+998907776655', blockedAt: new Date(), blockedBy: 'test', blockNote: 'test' } });
  customerIds.add(c.id);
  await db.customerAddress.create({ data: { customerId: c.id, label: 'Uy', addressText: 'Yunusobod 1-uy' } });
  const r = await deleteCustomerAccount(c.id, 'test-actor');
  assert.equal(r.result, 'DELETED'); assert.equal(r.keptTelegramId, true);
  const after = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(after.telegramUserId, tg); assert.ok(after.blockedAt); assert.equal(after.phone, null); assert.equal(after.displayName, null);
  assert.equal(await db.customerAddress.count({ where: { customerId: c.id } }), 0);
});

test('a Telegram customer deletes through the Mini App API: the Telegram id is freed, a returning user starts as a new customer', async () => {
  const tgId = randomInt(900_000_001, 999_999_999);
  const init = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: tgId, first_name: 'Tg' }), query_id: 'x' }, BOT_TOKEN);
  const auth = `tma ${init}`;
  const c = await db.customer.create({ data: { telegramUserId: String(tgId), displayName: 'Tg', phone: '+998903334455' } });
  customerIds.add(c.id);
  const res = await del(auth);
  assert.equal(res.statusCode, 200, res.body);
  const after = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(after.telegramUserId, null); assert.equal(after.phone, null); assert.ok(after.deletedAt);
  // a Telegram user with nothing stored: 204, nothing created
  const nobody = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: tgId + 1, first_name: 'Nobody' }), query_id: 'y' }, BOT_TOKEN);
  assert.equal((await del(`tma ${nobody}`)).statusCode, 204);
  assert.equal(await db.customer.count({ where: { telegramUserId: String(tgId + 1) } }), 0);
});

test('the same deletion five times at once acts once: one audit row, the others are ALREADY_DELETED', async () => {
  const me = await fullCustomer();
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => deleteCustomerAccount(me.id, 'race')));
  assert.equal(results.filter(r => r.result === 'DELETED').length, 1);
  assert.equal(results.filter(r => r.result === 'ALREADY_DELETED').length, 4);
  assert.equal(await db.adminAuditEvent.count({ where: { targetType: 'Customer', targetId: me.id, action: 'CUSTOMER_ACCOUNT_DELETED' } }), 1);
  // and a later call changes nothing and writes nothing
  assert.equal((await deleteCustomerAccount(me.id, 'later')).result, 'ALREADY_DELETED');
  assert.equal(await db.adminAuditEvent.count({ where: { targetType: 'Customer', targetId: me.id, action: 'CUSTOMER_ACCOUNT_DELETED' } }), 1);
});

test('an unknown id is "not found"', async () => {
  await assert.rejects(deleteCustomerAccount('does-not-exist', 'x'), (e: { statusCode?: number }) => e.statusCode === 404);
});
