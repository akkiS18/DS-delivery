import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { CheckoutError, placeOrder, validateCheckout } from '../modules/orders/service.js';
import { FEE_LINE_SOM_KEY, FEE_LINE_WAIVED_KEY, FEE_MODE_KEY, FEE_PERCENT_KEY, setFeeMode } from '../modules/pricing/config.js';
import { restaurantMenu } from '../modules/miniapp/views.js';

// Owner request 2026-11-28 (Bobosher): "Soboy idish" by size - a small one holds 3 osh (5 000), a big one 6 osh (10 000) - added by the
// server from the number of osh. ds_delivery_test only, MOCK payments. The fee mode is platform-wide: run this file on its own - it flips the
// mode and restores the previous rows at the end.
delete process.env.RESTAURANT_MANUAL_ACCEPTANCE;
delete process.env.COMMISSION_FLAT_SOM;
process.env.MAX_OPEN_UNPAID_ORDERS = '0';
const ADMIN = String(randomInt(100000000001, 200000000000));
const FEE_KEYS = [FEE_MODE_KEY, FEE_PERCENT_KEY, FEE_LINE_SOM_KEY, FEE_LINE_WAIVED_KEY];

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const nonce = randomUUID().slice(0, 8);
const customerTg = String(randomInt(700000000001, 800000000000));
let restaurantId = '';
let taxiId = '';
const P: Record<'osh' | 'toy' | 'small' | 'big' | 'salad' | 'cup', string> = { osh: '', toy: '', small: '', big: '', salad: '', cup: '' };
let savedAdmin: string | undefined;
let savedSettings: Array<{ key: string; value: string }> = [];
const cardsLast4: string[] = [];

const check = (items: Array<{ productId: string; quantity: number }>, expectedTotalSom?: number) => validateCheckout(db, { restaurantId, items, expectedTotalSom });
const place = (items: Array<{ productId: string; quantity: number }>, expectedTotalSom?: number) => placeOrder(engine, {
  restaurantId, telegramUserId: customerTg, customerName: 'Tester', phone: '+998901234567', addressText: 'Test manzil',
  taxiCompanyId: taxiId, checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'MOCK', items, ...(expectedTotalSom !== undefined ? { expectedTotalSom } : {}),
});
const packOf = (lines: Array<{ productId: string; quantity: number; packaging?: boolean }>) =>
  Object.fromEntries(lines.filter(l => l.packaging).map(l => [l.productId === P.small ? 'small' : l.productId === P.big ? 'big' : l.productId === P.cup ? 'cup' : l.productId, l.quantity]));

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  savedAdmin = process.env.SUPPORT_ADMIN_1_TELEGRAM_ID;
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = ADMIN;
  savedSettings = await db.platformSetting.findMany({ where: { key: { in: FEE_KEYS } }, select: { key: true, value: true } });
  await db.platformSetting.deleteMany({ where: { key: { in: FEE_KEYS } } });
  restaurantId = (await db.restaurant.create({ data: { slug: `ps-${nonce}`, name: `PS ${nonce}`, pickupAddress: 'Pickup', pickupPhone: '+998900000001', defaultPrepMinutes: 30 } })).id;
  const mk = (key: keyof typeof P, label: string, priceSom: number, extra: Record<string, unknown> = {}) =>
    db.product.create({ data: { restaurantId, name: `${label}-${nonce}`, priceSom, ...extra } }).then(p => { P[key] = p.id; });
  await mk('small', 'Soboy idish (3 osh)', 5000, { isPackaging: true, packagingCapacity: 3 });
  await mk('big', 'Soboy idish (6 osh)', 10_000, { isPackaging: true, packagingCapacity: 6, packagingBaseId: P.small });
  await mk('cup', 'Kosa', 2000, { isPackaging: true }); // the old rule: no capacity = one per dish unit
  await mk('osh', 'Osh', 35_000, { packagingProductId: P.small });
  await mk('toy', 'To‘y oshi', 40_000, { packagingProductId: P.small });
  await mk('salad', 'Salat', 10_000, { packagingProductId: P.cup });
  taxiId = (await db.taxiCompany.create({ data: { name: `PS Taxi ${randomUUID()}`, operatorTelegramUserId: String(randomInt(900000000001, 990000000000)), isActive: true } })).id;
  for (;;) {
    const c = String(randomInt(1000, 9999));
    if (await db.card.findUnique({ where: { last4: c } })) continue;
    cardsLast4.push(c); await engine.addCard(c, true, restaurantId); break;
  }
});

after(async () => {
  if (savedAdmin === undefined) delete process.env.SUPPORT_ADMIN_1_TELEGRAM_ID; else process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = savedAdmin;
  await db.platformSetting.deleteMany({ where: { key: { in: FEE_KEYS } } });
  for (const s of savedSettings) await db.platformSetting.create({ data: s });
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('ds.ledger_cleanup', 'on', true)`;
    await tx.adminAuditEvent.deleteMany({ where: { actorId: ADMIN } });
  });
  const orders = (await db.order.findMany({ where: { restaurantId }, select: { id: true } })).map(o => o.id);
  await db.notificationLog.deleteMany({ where: { orderId: { in: orders } } });
  await db.payment.deleteMany({ where: { restaurantId } });
  await db.incomingTransaction.deleteMany({ where: { cardLast4: { in: cardsLast4 } } });
  await db.order.deleteMany({ where: { restaurantId } });
  const cards = await db.card.findMany({ where: { restaurantId }, select: { id: true } });
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards.map(c => c.id) } } });
  await db.card.deleteMany({ where: { restaurantId } });
  await db.customer.deleteMany({ where: { telegramUserId: customerTg } });
  await db.product.updateMany({ where: { restaurantId }, data: { packagingProductId: null, packagingBaseId: null } });
  await db.product.deleteMany({ where: { restaurantId } });
  await db.taxiCompany.deleteMany({ where: { id: taxiId } });
  await db.restaurant.deleteMany({ where: { id: restaurantId } });
  await db.$disconnect();
});

test('sizes: the server picks the containers from the number of osh; the cost is ceil(n / 3) x 5 000', async () => {
  const want: Record<number, Record<string, number>> = {
    1: { small: 1 }, 2: { small: 1 }, 3: { small: 1 }, 4: { big: 1 }, 5: { big: 1 }, 6: { big: 1 },
    7: { big: 1, small: 1 }, 9: { big: 1, small: 1 }, 10: { big: 2 }, 12: { big: 2 }, 13: { big: 2, small: 1 },
  };
  for (const [n, units] of Object.entries(want).map(([k, v]) => [Number(k), v] as const)) {
    const r = await check([{ productId: P.osh, quantity: n }]);
    assert.ok(r.ok, `ok for ${n}`);
    assert.deepEqual(packOf(r.lines), units, `containers for ${n}`);
    assert.equal(r.totalSom, n * 35_000 + Math.ceil(n / 3) * 5000, `total for ${n}`);
    assert.equal(r.lines.reduce((s, l) => s + l.subtotalSom, 0), r.totalSom, `lines add up for ${n}`);
  }
});

test('sizes: two osh dishes share the containers; another packaging without capacity keeps one per unit; client-sent boxes are ignored', async () => {
  const r = await check([{ productId: P.osh, quantity: 2 }, { productId: P.toy, quantity: 2 }, { productId: P.salad, quantity: 3 }, { productId: P.small, quantity: 9 }, { productId: P.big, quantity: 1 }]);
  assert.ok(r.ok);
  assert.deepEqual(packOf(r.lines), { big: 1, cup: 3 });
  assert.equal(r.totalSom, 2 * 35_000 + 2 * 40_000 + 3 * 10_000 + 10_000 + 3 * 2000);
});

test('sizes: the menu gives the dish its sizes; a switched-off size is not used; a switched-off base leaves the big one', async () => {
  const menu = await restaurantMenu(restaurantId);
  assert.ok(menu);
  assert.equal(menu.products.some(p => p.id === P.small || p.id === P.big || p.id === P.cup), false);
  const osh = menu.products.find(p => p.id === P.osh)!.packaging!;
  assert.equal(osh.id, P.small);
  assert.equal(osh.priceSom, 5000);
  assert.deepEqual(osh.sizes?.map(s => [s.id, s.capacity, s.priceSom]).sort(), [[P.big, 6, 10_000], [P.small, 3, 5000]].sort());
  assert.deepEqual(menu.products.find(p => p.id === P.salad)!.packaging, { id: P.cup, name: `Kosa-${nonce}`, priceSom: 2000 });

  await db.product.update({ where: { id: P.big }, data: { isAvailable: false } });
  try {
    const r = await check([{ productId: P.osh, quantity: 7 }]);
    assert.ok(r.ok);
    assert.deepEqual(packOf(r.lines), { small: 3 });
  } finally { await db.product.update({ where: { id: P.big }, data: { isAvailable: true } }); }

  await db.product.update({ where: { id: P.small }, data: { isAvailable: false } });
  try {
    const r = await check([{ productId: P.osh, quantity: 2 }]);
    assert.ok(r.ok);
    assert.deepEqual(packOf(r.lines), { big: 1 });
    const m = await restaurantMenu(restaurantId);
    const pk = m!.products.find(p => p.id === P.osh)!.packaging!;
    assert.equal(pk.id, P.small); // still grouped by the base
    assert.equal(pk.priceSom, 10_000); // what an older app would charge per unit
  } finally { await db.product.update({ where: { id: P.small }, data: { isAvailable: true } }); }
});

test('placing the order: the containers are their own lines, items add up to the total, and the payment asks for exactly the total', async () => {
  const placed = await place([{ productId: P.osh, quantity: 7 }], 7 * 35_000 + 15_000);
  assert.ok(placed);
  const o = await db.order.findUniqueOrThrow({ where: { id: placed.id }, include: { items: true, payment: true } });
  assert.equal(o.totalSom, 7 * 35_000 + 15_000);
  assert.equal(o.items.reduce((s, i) => s + i.subtotalSom, 0), o.totalSom);
  assert.equal(Number(o.payment!.amountTiyin / 100n), o.totalSom);
  assert.ok(o.items.some(i => i.productId === P.big && i.quantity === 1 && i.name === `Soboy idish (6 osh)-${nonce}` && i.subtotalSom === 10_000));
  assert.ok(o.items.some(i => i.productId === P.small && i.quantity === 1 && i.subtotalSom === 5000));
});

test('an app built before sizes (one box per osh) still orders, at the lower server total; any other total is refused', async () => {
  // 4 osh: the old app shows 4 x 5 000 boxes; the server charges one big container (10 000).
  const oldTotal = 4 * 35_000 + 4 * 5000;
  const placed = await place([{ productId: P.osh, quantity: 4 }], oldTotal);
  assert.ok(placed);
  assert.equal(placed.totalSom, 4 * 35_000 + 10_000);
  assert.equal(placed.payment!.amountSom, placed.totalSom);
  for (const wrong of [oldTotal + 5000, 4 * 35_000 + 5000]) {
    await assert.rejects(() => place([{ productId: P.osh, quantity: 4 }], wrong), (e: unknown) => e instanceof CheckoutError && e.message === 'NARX_OZGARGAN');
  }
  // A restaurant without sizes is not loosened at all: one box per unit or the order is refused.
  await assert.rejects(() => place([{ productId: P.salad, quantity: 2 }], 2 * 10_000 + 2000), (e: unknown) => e instanceof CheckoutError && e.message === 'NARX_OZGARGAN');
});

test('PERCENT fee: the containers carry the fee like any line, the service fee is frozen and the payment equals the total', async () => {
  await setFeeMode({ adminId: ADMIN, mode: 'PERCENT', percentBp: 800 });
  try {
    const r = await check([{ productId: P.osh, quantity: 5 }]);
    assert.ok(r.ok);
    assert.deepEqual(packOf(r.lines), { big: 1 });
    assert.equal(r.fee.baseTotalSom, 5 * 35_000 + 10_000);
    assert.equal(r.totalSom, r.fee.baseTotalSom + r.fee.feeSom);
    const placed = await place([{ productId: P.osh, quantity: 5 }], r.totalSom);
    const o = await db.order.findUniqueOrThrow({ where: { id: placed!.id }, include: { items: true, payment: true } });
    assert.equal(o.totalSom, r.totalSom);
    assert.equal(o.serviceFeeSom, r.fee.feeSom);
    assert.equal(o.items.reduce((s, i) => s + i.subtotalSom, 0), o.totalSom);
    assert.equal(Number(o.payment!.amountTiyin / 100n), o.totalSom);
    const box = o.items.find(i => i.productId === P.big)!;
    assert.equal(box.baseUnitSom, 10_000);
  } finally { await setFeeMode({ adminId: ADMIN, mode: 'FLAT' }); }
});

test('the DB refuses a nonsense capacity and a size that is its own base', async () => {
  await assert.rejects(() => db.product.update({ where: { id: P.big }, data: { packagingCapacity: 0 } }), /packagingCapacity_valid/);
  await assert.rejects(() => db.product.update({ where: { id: P.big }, data: { packagingBaseId: P.big } }), /packagingBase_not_self/);
});
