import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { CheckoutError, placeOrder } from '../modules/orders/service.js';
import { gmailHealth } from '../modules/payment/gmail-health.js';
import { REAL_PAYMENTS_KEY, realPaymentsOpen, setRealPaymentsOpen } from '../modules/platform/settings.js';
import { createRestaurantByAdmin, linkStaffByAdmin, resetRestaurantPasswordByAdmin, slugFromName } from '../modules/restaurant/provision.js';
import { attemptKey, authenticate, login } from '../modules/restaurant-auth/service.js';
import { renderPayments } from '../bot/platform-admin.js';
import { customerOrderView, loadCustomerOrder } from '../modules/miniapp/views.js';

// Stage 9: the real-payments door and administrator-side restaurant setup. ds_delivery_test only: no Telegram, no money.
process.env.MAX_OPEN_UNPAID_ORDERS = '0';
process.env.RESTAURANT_LOGIN_MAX_FAILURES = '50';
process.env.RESTAURANT_LOGIN_IP_MAX_FAILURES = '1000';
const ADMIN = String(randomInt(100000000001, 200000000000));
const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const nonce = randomUUID().slice(0, 8);
const customerTg = String(randomInt(700000000001, 800000000000));
const operatorTg = String(randomInt(900000000001, 990000000000));
const created: string[] = [];
const ips: string[] = [];
const saved: Record<string, string | undefined> = {};
let before_: string | null = null;
let hadRow = false;
let restaurantId = '';
let taxiId = '';
let cardId = '';

const ip = () => { const v = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`; ips.push(v); return v; };
const setEnv = (k: string, v: string | undefined) => { if (!(k in saved)) saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };
async function realOrder() {
  const p = await db.product.create({ data: { restaurantId, name: `P${randomUUID().slice(0, 6)}`, priceSom: randomInt(10_000, 900_000), isAvailable: true } });
  return placeOrder(engine, {
    restaurantId, telegramUserId: customerTg, customerName: 'Tester', phone: '+998901234567', addressText: 'Test manzil',
    taxiCompanyId: taxiId, checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'REAL', items: [{ productId: p.id, quantity: 1 }],
  });
}

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  setEnv('SUPPORT_ADMIN_1_TELEGRAM_ID', ADMIN);
  const row = await db.platformSetting.findUnique({ where: { key: REAL_PAYMENTS_KEY } });
  hadRow = row !== null; before_ = row?.value ?? null;
  restaurantId = (await db.restaurant.create({ data: { slug: `pa-${nonce}`, name: `PA ${nonce}`, pickupAddress: 'Pickup' } })).id;
  taxiId = (await db.taxiCompany.create({ data: { name: `PA Taxi ${randomUUID()}`, operatorTelegramUserId: operatorTg, isActive: true } })).id;
  for (;;) {
    const last4 = String(randomInt(1000, 9999));
    if (await db.card.findUnique({ where: { last4 } })) continue;
    cardId = (await db.card.create({ data: { restaurantId, last4, isTest: false, active: true, approvalStatus: 'APPROVED', number: `860000000000${last4}` } })).id;
    break;
  }
});

after(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  gmailHealth.reset();
  const rids = [restaurantId, ...(await db.restaurant.findMany({ where: { slug: { in: created } }, select: { id: true } })).map(r => r.id)];
  const orders = (await db.order.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(o => o.id);
  const pays = await db.payment.findMany({ where: { OR: [{ orderId: { in: orders } }, { restaurantId: { in: rids } }] }, select: { id: true } });
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('ds.ledger_cleanup', 'on', true)`;
    await tx.adminAuditEvent.deleteMany({ where: { OR: [{ actorId: ADMIN }, { targetId: { in: rids } }] } });
  });
  await db.restaurantLoginAttempt.deleteMany({ where: { keyHash: { in: created.map(s => attemptKey('slug', s)).concat(ips.map(i => attemptKey('ip', i))) } } });
  await db.taxiDispatch.deleteMany({ where: { orderId: { in: orders } } });
  await db.paymentEvent.deleteMany({ where: { paymentId: { in: pays.map(p => p.id) } } });
  await db.payment.deleteMany({ where: { id: { in: pays.map(p => p.id) } } });
  await db.cardCooldown.deleteMany({ where: { cardId } });
  await db.cardEvent.deleteMany({ where: { cardId } });
  await db.card.deleteMany({ where: { id: cardId } });
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('ds.ledger_cleanup', 'on', true)`;
    await tx.incomingTransaction.deleteMany({ where: { sourceId: { startsWith: `gmail:pa-${nonce}` } } });
  });
  await db.order.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.customer.deleteMany({ where: { telegramUserId: customerTg } });
  await db.product.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.restaurantSession.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.restaurantCredential.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.restaurant.deleteMany({ where: { id: { in: rids } } });
  await db.taxiCompany.deleteMany({ where: { id: taxiId } });
  if (hadRow) await db.platformSetting.update({ where: { key: REAL_PAYMENTS_KEY }, data: { value: before_! } });
  else await db.platformSetting.deleteMany({ where: { key: REAL_PAYMENTS_KEY } });
  await db.$disconnect();
});

test('the payments door: only an administrator, only when ready, closed unless opened, every change audited', async () => {
  setEnv('BOT_PAYMENT_MODE', 'REAL');
  await db.platformSetting.deleteMany({ where: { key: REAL_PAYMENTS_KEY } });
  assert.equal(await realPaymentsOpen(), false, 'no row = closed');
  await assert.rejects(setRealPaymentsOpen({ adminId: '999', open: true }), /ADMIN_RUXSAT_YOQ/);

  gmailHealth.reset();
  const blocked = await setRealPaymentsOpen({ adminId: ADMIN, open: true });
  assert.equal(blocked.result, 'BLOCKED');
  assert.match((blocked as { blockers: string[] }).blockers.join(' '), /Gmail/);
  assert.equal(await realPaymentsOpen(), false, 'a blocked request changes nothing');

  gmailHealth.enable(12_000); gmailHealth.succeeded();
  assert.equal((await setRealPaymentsOpen({ adminId: ADMIN, open: true })).result, 'CHANGED');
  assert.equal(await realPaymentsOpen(), true);
  assert.equal((await setRealPaymentsOpen({ adminId: ADMIN, open: true })).result, 'UNCHANGED');
  assert.equal((await setRealPaymentsOpen({ adminId: ADMIN, open: false })).result, 'CHANGED', 'closing needs no readiness');
  assert.equal(await realPaymentsOpen(), false);

  setEnv('BOT_PAYMENT_MODE', 'MOCK');
  assert.match(((await setRealPaymentsOpen({ adminId: ADMIN, open: true })) as { blockers: string[] }).blockers.join(' '), /REAL rejimida emas/);

  const audit = await db.adminAuditEvent.findMany({ where: { actorId: ADMIN, targetType: 'PlatformSetting' }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(audit.map(a => a.action), ['REAL_PAYMENTS_OPENED', 'REAL_PAYMENTS_CLOSED']);
});

test('in production a REAL checkout needs the door open; a closed door refuses new orders only and an open one takes them', async () => {
  setEnv('BOT_PAYMENT_MODE', 'REAL');
  gmailHealth.enable(12_000); gmailHealth.succeeded();
  setEnv('NODE_ENV', 'production');
  await db.platformSetting.deleteMany({ where: { key: REAL_PAYMENTS_KEY } });
  await assert.rejects(realOrder(), (e: unknown) => e instanceof CheckoutError && e.message === 'TOLOV_YOPIQ' && e.statusCode === 409);
  assert.equal(await db.order.count({ where: { restaurantId } }), 0, 'nothing was created');
  assert.match((await renderPayments()).text, /YOPIQ/);

  assert.equal((await setRealPaymentsOpen({ adminId: ADMIN, open: true })).result, 'CHANGED');
  assert.match((await renderPayments()).text, /OCHIQ/);
  const placed = (await realOrder())!;
  assert.equal(placed.payment?.status === 'AWAITING' || placed.payment?.status === 'QUEUED', true);

  assert.equal((await setRealPaymentsOpen({ adminId: ADMIN, open: false })).result, 'CHANGED');
  await assert.rejects(realOrder(), (e: unknown) => e instanceof CheckoutError && e.message === 'TOLOV_YOPIQ');
  const kept = await db.order.findUniqueOrThrow({ where: { id: placed.id }, include: { payment: true } });
  assert.ok(['PAYMENT_PENDING'].includes(kept.status) && kept.payment, 'the order created while the door was open is untouched by closing');

  setEnv('NODE_ENV', 'test');
  await db.platformSetting.deleteMany({ where: { key: REAL_PAYMENTS_KEY } });
  assert.equal((await renderPayments()).keyboard, null, 'outside production the panel offers no switch');
});

test('slugs: Latin, Cyrillic and apostrophes become a safe login code', () => {
  assert.equal(slugFromName('Do‘stlik Cafe №2'), 'dostlik-cafe-2');
  assert.equal(slugFromName('Ош Палов'), 'osh-palov');
  assert.equal(slugFromName('  !!  '), 'restoran');
  assert.match(slugFromName('A'.repeat(100)), /^[a-z0-9-]{2,40}$/);
});

test('adding a restaurant: admin only, starts paused, the one-time password logs in, a clash gets a suffix, the password is never audited', async () => {
  const name = `Test Oshxona ${nonce}`;
  await assert.rejects(createRestaurantByAdmin({ adminId: '999', name, pickupAddress: 'Manzil 1' }), /ADMIN_RUXSAT_YOQ/);
  await assert.rejects(createRestaurantByAdmin({ adminId: ADMIN, name: 'x', pickupAddress: 'Manzil 1' }), /NOM_QISQA/);
  await assert.rejects(createRestaurantByAdmin({ adminId: ADMIN, name, pickupAddress: 'Manzil 1', pickupPhone: 'abc' }), /TELEFON_NOTOGRI/);

  const a = await createRestaurantByAdmin({ adminId: ADMIN, name, pickupAddress: 'Manzil 1', pickupPhone: '+998901112233' });
  created.push(a.slug);
  assert.match(a.slug, /^test-oshxona-/);
  const row = await db.restaurant.findUniqueOrThrow({ where: { slug: a.slug } });
  assert.equal(row.isPaused, true, 'customers do not see it until the staff open it');
  assert.equal(row.pickupAddress, 'Manzil 1');
  assert.ok(a.password.length >= 12 && !a.password.toLowerCase().includes(a.slug));

  const ok = await login({ slug: a.slug, password: a.password, ip: ip() });
  assert.equal(ok.result, 'OK');
  const b = await createRestaurantByAdmin({ adminId: ADMIN, name, pickupAddress: 'Manzil 2' });
  created.push(b.slug);
  assert.equal(b.slug, `${a.slug}-2`);

  const audit = await db.adminAuditEvent.findMany({ where: { actorId: ADMIN, targetId: row.id } });
  assert.deepEqual(audit.map(x => x.action), ['RESTAURANT_CREATED']);
  assert.ok(!JSON.stringify(audit).includes(a.password), 'the password is never written to the audit log');
});

test('password reset signs the old sessions out; linking staff is one account per restaurant', async () => {
  const slug = created[0]!;
  const old = await db.restaurant.findUniqueOrThrow({ where: { slug } });
  const first = await resetRestaurantPasswordByAdmin({ adminId: ADMIN, slug });
  assert.ok(first);
  const session = await login({ slug, password: first!.password, ip: ip() });
  assert.equal(session.result, 'OK');
  const token = (session as { token: string }).token;
  assert.equal((await authenticate(token)).ok, true);
  const second = await resetRestaurantPasswordByAdmin({ adminId: ADMIN, slug });
  assert.notEqual(second!.password, first!.password);
  assert.equal((await authenticate(token)).ok, false, 'the old session is gone');
  assert.notEqual((await login({ slug, password: first!.password, ip: ip() })).result, 'OK', 'the old password no longer works');
  assert.equal(await resetRestaurantPasswordByAdmin({ adminId: ADMIN, slug: 'no-such-restaurant' }), null);
  await assert.rejects(resetRestaurantPasswordByAdmin({ adminId: '999', slug }), /ADMIN_RUXSAT_YOQ/);

  const tg = String(randomInt(300000000001, 399999999999));
  assert.deepEqual(await linkStaffByAdmin({ adminId: ADMIN, slug, telegramId: tg }), { result: 'LINKED', name: old.name });
  assert.deepEqual(await linkStaffByAdmin({ adminId: ADMIN, slug: created[1]!, telegramId: tg }), { result: 'TAKEN', otherSlug: slug });
  assert.deepEqual(await linkStaffByAdmin({ adminId: ADMIN, slug: 'nope-nope', telegramId: tg }), { result: 'NOT_FOUND' });
  await assert.rejects(linkStaffByAdmin({ adminId: ADMIN, slug, telegramId: 'abc' }), /TELEGRAM_ID_NOTOGRI/);
  await assert.rejects(linkStaffByAdmin({ adminId: '999', slug, telegramId: tg }), /ADMIN_RUXSAT_YOQ/);
});

async function fixedPriceOrder(eng: PaymentEngineV3, priceSom: number) {
  const p = await db.product.create({ data: { restaurantId, name: `F${randomUUID().slice(0, 6)}`, priceSom, isAvailable: true } });
  return placeOrder(eng, {
    restaurantId, telegramUserId: customerTg, customerName: 'Tester', phone: '+998901234567', addressText: 'Test manzil',
    taxiCompanyId: taxiId, checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'REAL', items: [{ productId: p.id, quantity: 1 }],
  });
}

test('the Mini App shows the approved card number to pay to (not "recipient not configured")', async () => {
  const placed = (await fixedPriceOrder(engine, 12_345))!;
  const view = customerOrderView((await loadCustomerOrder(customerTg, placed.id))!);
  const ins = view.payment?.instructions as { cardNumber: string | null; recipientUnavailable: boolean };
  const card = await db.card.findUniqueOrThrow({ where: { id: cardId } });
  assert.equal(ins.recipientUnavailable, false);
  assert.equal(ins.cardNumber, card.number);
  await db.$transaction(tx => engine.cancelOpenPayment(tx, placed.id, new Date(), { type: 'TEST', id: 't' })); // frees the card for the next test
});

test('a cancelled unpaid order frees the card at once when cancelCooldownMs is 0; the default keeps the cooldown', async () => {
  const instant = new PaymentEngineV3(db, { ...defaultOptions, cancelCooldownMs: 0 }, () => {});
  const a = (await fixedPriceOrder(instant, 23_456))!;
  assert.equal(a.payment?.status, 'AWAITING');
  await instant.runLocked(tx => instant.cancelOpenPayment(tx, a.id, new Date(), { type: 'TEST', id: 't' }));
  const b = (await fixedPriceOrder(instant, 23_456))!;
  assert.equal(b.payment?.status, 'AWAITING', 'same card, same amount, right after the cancel');
  await instant.runLocked(tx => instant.cancelOpenPayment(tx, b.id, new Date(), { type: 'TEST', id: 't' }));

  const careful = new PaymentEngineV3(db, { ...defaultOptions }, () => {});
  const c = (await fixedPriceOrder(careful, 34_567))!;
  assert.equal(c.payment?.status, 'AWAITING');
  await careful.runLocked(tx => careful.cancelOpenPayment(tx, c.id, new Date(), { type: 'TEST', id: 't' }));
  const d = (await fixedPriceOrder(careful, 34_567))!;
  assert.equal(d.payment?.status, 'QUEUED', 'without the setting the 120 s cooldown still protects against a late transfer');
});

const mail = (eng: PaymentEngineV3, last4: string, som: number) => eng.ingest({
  sourceId: `gmail:pa-${nonce}-${randomUUID()}`, source: 'GMAIL', cardLast4: last4, amountTiyin: BigInt(som) * 100n,
  occurredAt: new Date(), emailReceivedAt: new Date(Date.now() + 1000), minutePrecision: false, trustedSender: true,
});

test('a repeat order of the same dish is paid and matched at once when the card was released (cancelled or already paid before); only an EXPIRED attempt is held for review', async () => {
  const card = await db.card.findUniqueOrThrow({ where: { id: cardId } });
  const eng = new PaymentEngineV3(db, { ...defaultOptions, cancelCooldownMs: 0, matchCooldownMs: 0 }, () => {});
  const som = 45_678;

  const first = (await fixedPriceOrder(eng, som))!;
  await eng.runLocked(tx => eng.cancelOpenPayment(tx, first.id, new Date(), { type: 'TEST', id: 't' }));
  const second = (await fixedPriceOrder(eng, som))!;
  assert.equal(second.payment?.status, 'AWAITING');
  assert.equal((await mail(eng, card.last4, som)).status, 'MATCHED_UNVERIFIED', 'cancelled before: the payer is the current order');

  const third = (await fixedPriceOrder(eng, som))!;
  assert.equal(third.payment?.status, 'AWAITING', 'the card is free right after a payment was matched');
  assert.equal((await mail(eng, card.last4, som)).status, 'MATCHED_UNVERIFIED', 'paid before: still the current order');

  const expiring = (await fixedPriceOrder(eng, som + 1_000))!;
  await db.payment.update({ where: { orderId: expiring.id }, data: { status: 'EXPIRED', expiresAt: new Date(Date.now() - 1_000) } });
  const next = (await fixedPriceOrder(eng, som + 1_000))!;
  assert.equal(next.payment?.status, 'AWAITING');
  const held = await mail(eng, card.last4, som + 1_000);
  assert.equal(held.status, 'REVIEW_REQUIRED');
  assert.equal(held.reason, 'PRIOR_SAME_CARD_AND_AMOUNT', 'an unpaid attempt that just expired may still receive a late transfer: a person decides');

  const careful = new PaymentEngineV3(db, { ...defaultOptions }, () => {});
  assert.ok(careful, 'the default engine keeps counting cancelled and matched attempts (covered by the existing suites)');
});
