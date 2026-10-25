import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { CheckoutError, placeOrder } from '../modules/orders/service.js';
import { quoteCheckout } from '../modules/orders/contract.js';
import { accrueCommissionTx } from '../modules/commission/ledger.js';
import { FEE_MODE_KEY, FEE_PERCENT_KEY, loadFeeConfig, setFeeMode } from '../modules/pricing/config.js';
import { restaurantMenu } from '../modules/miniapp/views.js';
import { attemptKey, setRestaurantPassword } from '../modules/restaurant-auth/service.js';

// Service fee baked into dish prices. ds_delivery_test only, MOCK payments. The fee mode is a platform-wide setting: run this file on its own
// (not in parallel with other DB suites) - it flips the mode and restores the previous rows at the end.
delete process.env.RESTAURANT_MANUAL_ACCEPTANCE;
delete process.env.COMMISSION_FLAT_SOM;
process.env.MAX_OPEN_UNPAID_ORDERS = '0';
process.env.RESTAURANT_LOGIN_MAX_FAILURES = '50';
process.env.RESTAURANT_LOGIN_IP_MAX_FAILURES = '1000';
const ADMIN = String(randomInt(100000000001, 200000000000));

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const app = buildApp(engine);
const nonce = randomUUID().slice(0, 8);
const slug = `sf-${nonce}`;
const PW = `Alpha-${randomUUID()}`;
const customerTg = String(randomInt(700000000001, 800000000000));
const ids: Record<string, string> = {};
const prices = { osh: 25_000, lavash: 15_000, big: 100_000 };
const product: Record<keyof typeof prices, string> = { osh: '', lavash: '', big: '' };
const cardsLast4: string[] = [];
let taxiId = '';
let token = '';
let savedAdmin: string | undefined;
let savedSettings: Array<{ key: string; value: string }> = [];
const ip = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`;

const items = (osh: number, lavash: number, big = 0) => [
  ...(osh ? [{ productId: product.osh, quantity: osh }] : []), ...(lavash ? [{ productId: product.lavash, quantity: lavash }] : []), ...(big ? [{ productId: product.big, quantity: big }] : []),
];
const place = (list: ReturnType<typeof items>, over: Partial<Parameters<typeof placeOrder>[1]> = {}) => placeOrder(engine, {
  restaurantId: ids.r!, telegramUserId: customerTg, customerName: 'Tester', phone: '+998901234567', addressText: 'Test manzil',
  taxiCompanyId: taxiId, checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'MOCK', items: list, ...over,
});
const row = (id: string) => db.order.findUniqueOrThrow({ where: { id }, include: { items: true, payment: true } });

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  savedAdmin = process.env.SUPPORT_ADMIN_1_TELEGRAM_ID;
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = ADMIN;
  savedSettings = await db.platformSetting.findMany({ where: { key: { in: [FEE_MODE_KEY, FEE_PERCENT_KEY] } }, select: { key: true, value: true } });
  await db.platformSetting.deleteMany({ where: { key: { in: [FEE_MODE_KEY, FEE_PERCENT_KEY] } } });
  ids.r = (await db.restaurant.create({ data: { slug, name: `SF ${nonce}`, pickupAddress: 'Pickup', pickupPhone: '+998900000001', defaultPrepMinutes: 30 } })).id;
  await setRestaurantPassword({ slug, password: PW });
  for (const k of Object.keys(prices) as Array<keyof typeof prices>) {
    product[k] = (await db.product.create({ data: { restaurantId: ids.r, name: `${k}-${nonce}`, priceSom: prices[k] } })).id;
  }
  taxiId = (await db.taxiCompany.create({ data: { name: `SF Taxi ${randomUUID()}`, operatorTelegramUserId: String(randomInt(900000000001, 990000000000)), isActive: true } })).id;
  for (;;) {
    const c = String(randomInt(1000, 9999));
    if (await db.card.findUnique({ where: { last4: c } })) continue;
    cardsLast4.push(c); await engine.addCard(c, true, ids.r); break;
  }
  const login = await app.inject({ method: 'POST', url: '/api/v1/restaurant/auth/login', payload: { slug, password: PW }, remoteAddress: ip });
  assert.equal(login.statusCode, 200);
  token = login.json().accessToken;
});

after(async () => {
  if (savedAdmin === undefined) delete process.env.SUPPORT_ADMIN_1_TELEGRAM_ID; else process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = savedAdmin;
  await db.platformSetting.deleteMany({ where: { key: { in: [FEE_MODE_KEY, FEE_PERCENT_KEY] } } });
  for (const s of savedSettings) await db.platformSetting.create({ data: s });
  await db.$transaction(async tx => { // the audit trail is append-only too
    await tx.$executeRaw`SELECT set_config('ds.ledger_cleanup', 'on', true)`;
    await tx.adminAuditEvent.deleteMany({ where: { actorId: ADMIN } });
  });
  const orders = (await db.order.findMany({ where: { restaurantId: ids.r }, select: { id: true } })).map(o => o.id);
  await db.$transaction(async tx => { // the ledger is append-only; this switch exists for exactly this cleanup
    await tx.$executeRaw`SELECT set_config('ds.ledger_cleanup', 'on', true)`;
    await tx.commissionEvent.deleteMany({ where: { entry: { restaurantId: ids.r } } });
    await tx.commissionEntry.deleteMany({ where: { restaurantId: ids.r } });
  });
  await db.notificationLog.deleteMany({ where: { orderId: { in: orders } } });
  const pays = await db.payment.findMany({ where: { restaurantId: ids.r }, select: { id: true, matchedTransactionId: true } });
  await db.payment.deleteMany({ where: { id: { in: pays.map(p => p.id) } } });
  await db.incomingTransaction.deleteMany({ where: { OR: [{ id: { in: pays.map(p => p.matchedTransactionId).filter((x): x is string => !!x) } }, { cardLast4: { in: cardsLast4 } }] } });
  await db.restaurantLoginAttempt.deleteMany({ where: { keyHash: { in: [attemptKey('slug', slug), attemptKey('ip', ip)] } } });
  await db.order.deleteMany({ where: { restaurantId: ids.r } });
  const cards = await db.card.findMany({ where: { restaurantId: ids.r }, select: { id: true } });
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards.map(c => c.id) } } });
  await db.card.deleteMany({ where: { restaurantId: ids.r } });
  await db.customer.deleteMany({ where: { telegramUserId: customerTg } });
  await db.product.deleteMany({ where: { restaurantId: ids.r } });
  await db.taxiCompany.deleteMany({ where: { id: taxiId } });
  await db.restaurant.deleteMany({ where: { id: ids.r } });
  await db.$disconnect();
});

test('FLAT (no setting): the customer pays the menu prices and nothing is stored as a fee', async () => {
  assert.equal((await loadFeeConfig(db)).mode, 'FLAT');
  const o = await place(items(2, 1));
  const r = await row(o!.id);
  assert.equal(r.totalSom, 65_000);
  assert.equal(r.serviceFeeSom, null);
  assert.equal(r.baseTotalSom, null);
  assert.ok(r.items.every(i => i.baseUnitSom === null));
  assert.equal(r.payment!.amountTiyin, 6_500_000n);
  const menu = await restaurantMenu(slug);
  assert.equal(menu!.pricing.mode, 'FLAT');
  assert.equal(menu!.products.find(p => p.id === product.osh)!.priceSom, 25_000);
});

test('only a support administrator can change the mode; every change is audited', async () => {
  await assert.rejects(setFeeMode({ adminId: '1', mode: 'TIERED' }), /ADMIN_RUXSAT_YOQ/);
  await assert.rejects(setFeeMode({ adminId: ADMIN, mode: 'PERCENT', percentBp: 5 }), /XIZMAT_HAQI_FOIZI_NOTOGRI/);
  assert.equal((await setFeeMode({ adminId: ADMIN, mode: 'TIERED' })).result, 'CHANGED');
  assert.equal((await setFeeMode({ adminId: ADMIN, mode: 'TIERED' })).result, 'UNCHANGED');
  assert.equal((await loadFeeConfig(db)).mode, 'TIERED');
  assert.equal(await db.adminAuditEvent.count({ where: { actorId: ADMIN, action: 'SERVICE_FEE_MODE_CHANGED' } }), 1);
  await db.platformSetting.update({ where: { key: FEE_MODE_KEY }, data: { value: 'garbage' } });
  assert.equal((await loadFeeConfig(db)).mode, 'FLAT', 'an unreadable value falls back to the legacy behaviour');
  await setFeeMode({ adminId: ADMIN, mode: 'TIERED' });
});

test('TIERED: server prices the basket, the order freezes base, fee and rule; the payment is what the customer saw', async () => {
  const list = items(2, 1); // 2 x 25 000 + 15 000 = 65 000 -> 27 100 / 16 300 = 70 500
  const q = await quoteCheckout({ restaurantId: ids.r!, items: list });
  assert.ok(q.ok);
  assert.equal(q.totalSom, 70_500);
  assert.equal(q.baseTotalSom, 65_000);
  assert.deepEqual(q.lines.map(l => [l.productId, l.unitSom, l.baseUnitSom]).sort(), [[product.lavash, 16_300, 15_000], [product.osh, 27_100, 25_000]].sort());

  const o = await place(list, { expectedTotalSom: q.totalSom, expectedUnitPrices: { [product.osh]: 27_100, [product.lavash]: 16_300 } });
  const r = await row(o!.id);
  assert.equal(r.totalSom, 70_500);
  assert.equal(r.baseTotalSom, 65_000);
  assert.equal(r.serviceFeeSom, 5_500);
  assert.equal(r.totalSom, r.baseTotalSom! + r.serviceFeeSom!);
  assert.equal(r.feeRuleCode, 'TIERED_50000_1000_300');
  assert.equal(r.payment!.amountTiyin, 7_050_000n);
  assert.equal(r.items.find(i => i.productId === product.osh)!.baseUnitSom, 25_000);

  const menu = await restaurantMenu(slug);
  assert.equal(menu!.pricing.mode, 'TIERED');
  assert.equal(menu!.products.find(p => p.id === product.osh)!.priceSom, 25_000, 'the menu API keeps the restaurant price; the app adds the fee locally');
});

test('a client that still shows the menu total is refused instead of being charged more (NARX_OZGARGAN)', async () => {
  await assert.rejects(
    place(items(2, 1), { expectedTotalSom: 65_000 }),
    (e: unknown) => e instanceof CheckoutError && e.message === 'NARX_OZGARGAN' && e.statusCode === 409
      && (e.details as { currentTotalSom: number }).currentTotalSom === 70_500,
  );
  await assert.rejects(place(items(2, 1), { expectedTotalSom: 70_500, expectedUnitPrices: { [product.osh]: 25_000 } }), /NARX_OZGARGAN/);
});

test('changing the mode never touches an existing order', async () => {
  const o = await place(items(0, 0, 1)); // 100 000 -> 106 500
  assert.equal((await row(o!.id)).totalSom, 106_500);
  await setFeeMode({ adminId: ADMIN, mode: 'FLAT' });
  const r = await row(o!.id);
  assert.equal(r.totalSom, 106_500);
  assert.equal(r.serviceFeeSom, 6_500);
  assert.equal((await place(items(0, 0, 1))) && (await db.order.findFirstOrThrow({ where: { restaurantId: ids.r }, orderBy: { createdAt: 'desc' } })).totalSom, 100_000);
  await setFeeMode({ adminId: ADMIN, mode: 'TIERED' });
});

test('PERCENT mode bakes one percentage into every dish', async () => {
  await setFeeMode({ adminId: ADMIN, mode: 'PERCENT', percentBp: 800 });
  const o = await place(items(2, 0)); // 25 000 * 1.08 = 27 000
  const r = await row(o!.id);
  assert.deepEqual([r.totalSom, r.baseTotalSom, r.serviceFeeSom, r.feeRuleCode], [54_000, 50_000, 4_000, 'PERCENT_800']);
  await setFeeMode({ adminId: ADMIN, mode: 'TIERED' });
});

test('the restaurant sees its own prices plus the platform share; the total is what to look for on the card', async () => {
  const o = await place(items(2, 1));
  const view = (await app.inject({ method: 'GET', url: `/api/v1/restaurant/orders/${o!.id}`, headers: { authorization: `Bearer ${token}` } })).json();
  const order = view.order ?? view;
  assert.equal(order.totalSom, 70_500);
  assert.equal(order.serviceFeeSom, 5_500);
  const osh = order.items.find((i: { name: string }) => i.name.startsWith('osh'));
  assert.deepEqual([osh.unitSom, osh.subtotalSom], [25_000, 50_000]);
  const sum = order.items.reduce((s: number, i: { subtotalSom: number }) => s + i.subtotalSom, 0);
  assert.equal(sum + order.serviceFeeSom, order.totalSom);
});

/** What the delivery stage does: the order reaches COMPLETED with proof, then the commission accrues. */
async function deliver(orderId: string) {
  const o = await row(orderId);
  const matched = await db.incomingTransaction.create({ data: { sourceId: `sf-${randomUUID()}`, source: 'test', cardLast4: '0000', amountTiyin: o.payment!.amountTiyin, occurredAt: new Date() } });
  await db.payment.update({ where: { id: o.payment!.id }, data: { status: 'CONFIRMED_MANUAL', isTest: false, matchedTransactionId: matched.id } });
  await db.order.update({ where: { id: orderId }, data: { paymentIsTest: false } });
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
    await tx.order.update({ where: { id: orderId }, data: { status: 'COMPLETED' } });
    await tx.orderEvent.create({ data: { orderId, actorTelegramId: 'test', actorType: 'SYSTEM', action: 'TEST_DELIVERY', fromStatus: 'PAYMENT_CONFIRMED', toStatus: 'COMPLETED' } });
    return accrueCommissionTx(tx, orderId, { id: 'system', type: 'SYSTEM' });
  });
}

test('commission: a fee order owes exactly its frozen fee (once); a legacy order still owes the flat 5 000', async () => {
  const feeOrder = await place(items(2, 1));
  const first = await deliver(feeOrder!.id);
  assert.deepEqual([first.result, (first as { amountSom: number }).amountSom], ['ACCRUED', 5_500]);
  const entry = await db.commissionEntry.findUniqueOrThrow({ where: { orderId: feeOrder!.id } });
  assert.deepEqual([entry.amountSom, entry.ruleCode, entry.orderTotalSom], [5_500, 'SERVICE_FEE', 70_500]);
  const again = await db.$transaction(tx => accrueCommissionTx(tx, feeOrder!.id, { id: 'system', type: 'SYSTEM' }));
  assert.equal(again.result, 'ALREADY_ACCRUED');

  await setFeeMode({ adminId: ADMIN, mode: 'FLAT' });
  const legacy = await place(items(2, 1));
  assert.equal((await row(legacy!.id)).serviceFeeSom, null);
  const flat = await deliver(legacy!.id);
  assert.deepEqual([flat.result, (flat as { amountSom: number }).amountSom], ['ACCRUED', 5_000]);
  assert.equal((await db.commissionEntry.findUniqueOrThrow({ where: { orderId: legacy!.id } })).ruleCode, 'FLAT_SOM');
  await setFeeMode({ adminId: ADMIN, mode: 'TIERED' });
});

test('the database refuses an order whose total is not base + fee', async () => {
  const o = await place(items(1, 0));
  await assert.rejects(db.order.update({ where: { id: o!.id }, data: { serviceFeeSom: 1 } }), /Order_service_fee_consistent|check constraint/);
});
