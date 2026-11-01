import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { CheckoutError, placeOrder, validateCheckout } from '../modules/orders/service.js';
import { FEE_LINE_SOM_KEY, FEE_LINE_WAIVED_KEY, FEE_MODE_KEY, FEE_PERCENT_KEY, setFeeMode } from '../modules/pricing/config.js';
import { restaurantMenu } from '../modules/miniapp/views.js';
import { promoRef, publicBanners, setBannerImage, setPromotionActive, setPromotionCap, setPromotionProducts } from '../modules/promotions/service.js';

// Packaging ("soboy idishi") and the 1+1 promotion at checkout, plus the home banners. ds_delivery_test only, MOCK payments. The fee mode is a
// platform-wide setting: run this file on its own - it flips the mode and restores the previous rows at the end.
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
const P: Record<'osh' | 'box' | 'big' | 'mid' | 'small' | 'cola', string> = { osh: '', box: '', big: '', mid: '', small: '', cola: '' };
let promoId = '';
let savedAdmin: string | undefined;
let savedSettings: Array<{ key: string; value: string }> = [];
const cardsLast4: string[] = [];

const check = (items: Array<{ productId: string; quantity: number }>) => validateCheckout(db, { restaurantId, items });
const place = (items: Array<{ productId: string; quantity: number }>) => placeOrder(engine, {
  restaurantId, telegramUserId: customerTg, customerName: 'Tester', phone: '+998901234567', addressText: 'Test manzil',
  taxiCompanyId: taxiId, checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'MOCK', items,
});

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  savedAdmin = process.env.SUPPORT_ADMIN_1_TELEGRAM_ID;
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = ADMIN;
  savedSettings = await db.platformSetting.findMany({ where: { key: { in: FEE_KEYS } }, select: { key: true, value: true } });
  await db.platformSetting.deleteMany({ where: { key: { in: FEE_KEYS } } });
  restaurantId = (await db.restaurant.create({ data: { slug: `pp-${nonce}`, name: `PP ${nonce}`, pickupAddress: 'Pickup', pickupPhone: '+998900000001', defaultPrepMinutes: 30 } })).id;
  const mk = (key: keyof typeof P, label: string, priceSom: number, extra: Record<string, unknown> = {}) =>
    db.product.create({ data: { restaurantId, name: `${label}-${nonce}`, priceSom, ...extra } }).then(p => { P[key] = p.id; });
  await mk('box', 'Soboy idishi', 5000, { isPackaging: true });
  await mk('osh', 'Osh', 35_000, { packagingProductId: P.box });
  await mk('big', 'LAVASH KATTA', 43_000);
  await mk('mid', 'LAVASH ORTACHA', 33_000);
  await mk('small', 'LAVASH KICHKINA', 28_000);
  await mk('cola', 'Cola', 8000);
  taxiId = (await db.taxiCompany.create({ data: { name: `PP Taxi ${randomUUID()}`, operatorTelegramUserId: String(randomInt(900000000001, 990000000000)), isActive: true } })).id;
  for (;;) {
    const c = String(randomInt(1000, 9999));
    if (await db.card.findUnique({ where: { last4: c } })) continue;
    cardsLast4.push(c); await engine.addCard(c, true, restaurantId); break;
  }
  promoId = (await db.promotion.create({ data: { restaurantId, title: 'Lavash' } })).id;
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
  const pays = await db.payment.findMany({ where: { restaurantId }, select: { id: true, matchedTransactionId: true } });
  await db.payment.deleteMany({ where: { id: { in: pays.map(p => p.id) } } });
  await db.incomingTransaction.deleteMany({ where: { cardLast4: { in: cardsLast4 } } });
  await db.order.deleteMany({ where: { restaurantId } });
  await db.banner.deleteMany({ where: { restaurantId } });
  await db.banner.deleteMany({ where: { promotionId: promoId } });
  await db.promotion.deleteMany({ where: { restaurantId } });
  const cards = await db.card.findMany({ where: { restaurantId }, select: { id: true } });
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards.map(c => c.id) } } });
  await db.card.deleteMany({ where: { restaurantId } });
  await db.customer.deleteMany({ where: { telegramUserId: customerTg } });
  await db.product.updateMany({ where: { restaurantId }, data: { packagingProductId: null } });
  await db.product.deleteMany({ where: { restaurantId } });
  await db.taxiCompany.deleteMany({ where: { id: taxiId } });
  await db.restaurant.deleteMany({ where: { id: restaurantId } });
  await db.$disconnect();
});

test('packaging: one box per dish unit is added by the server as its own line and priced', async () => {
  const r = await check([{ productId: P.osh, quantity: 2 }]);
  assert.ok(r.ok);
  const box = r.lines.find(l => l.packaging);
  assert.ok(box);
  assert.equal(box.productId, P.box);
  assert.equal(box.quantity, 2);
  assert.equal(box.subtotalSom, 10_000);
  assert.equal(r.totalSom, 70_000 + 10_000);
});

test('packaging: a box the client sends itself is ignored (never doubled), and a box alone is not an order', async () => {
  const r = await check([{ productId: P.osh, quantity: 1 }, { productId: P.box, quantity: 5 }]);
  assert.ok(r.ok);
  assert.equal(r.lines.find(l => l.packaging)!.quantity, 1);
  assert.equal(r.totalSom, 40_000);
  const alone = await check([{ productId: P.box, quantity: 1 }]);
  assert.equal(alone.ok, false);
});

test('packaging: the menu hides the box and hangs it on the dish; a box that is switched off is simply not added', async () => {
  const menu = await restaurantMenu(restaurantId);
  assert.ok(menu);
  assert.equal(menu.products.some(p => p.id === P.box), false);
  assert.deepEqual(menu.products.find(p => p.id === P.osh)!.packaging, { id: P.box, name: `Soboy idishi-${nonce}`, priceSom: 5000 });
  await db.product.update({ where: { id: P.box }, data: { isAvailable: false } });
  try {
    const off = await check([{ productId: P.osh, quantity: 1 }]);
    assert.ok(off.ok);
    assert.equal(off.totalSom, 35_000);
    assert.equal((await restaurantMenu(restaurantId))!.products.find(p => p.id === P.osh)!.packaging, null);
  } finally { await db.product.update({ where: { id: P.box }, data: { isAvailable: true } }); }
});

test('promotion: nothing happens while it is off; it cannot be switched on without dishes', async () => {
  await db.promotionProduct.create({ data: { promotionId: promoId, productId: P.big } });
  await db.promotionProduct.create({ data: { promotionId: promoId, productId: P.mid } });
  const r = await check([{ productId: P.big, quantity: 1 }, { productId: P.mid, quantity: 1 }]);
  assert.ok(r.ok);
  assert.equal(r.totalSom, 76_000);
  assert.equal(r.lines.some(l => l.free), false);
  const empty = await db.promotion.create({ data: { restaurantId, title: 'Bo‘sh' } });
  await assert.rejects(() => setPromotionActive(ADMIN, promoRef(empty.id), true), /AKSIYADA_TAOM_YOQ/);
  await db.promotion.delete({ where: { id: empty.id } });
});

test('promotion: set by dish name, switched on by the administrator; the cheaper dish of the pair is free', async () => {
  await assert.rejects(() => setPromotionProducts(ADMIN, promoRef(promoId), ['Bunday taom yoq']), /TAOM_TOPILMADI/);
  await setPromotionProducts(ADMIN, promoRef(promoId), [`LAVASH KATTA-${nonce}`, `lavash ortacha-${nonce}`, `LAVASH KICHKINA-${nonce}`]);
  await setPromotionActive(ADMIN, promoRef(promoId), true);
  const r = await check([{ productId: P.big, quantity: 1 }, { productId: P.mid, quantity: 1 }]);
  assert.ok(r.ok);
  assert.equal(r.totalSom, 43_000);
  const free = r.lines.find(l => l.free)!;
  assert.equal(free.productId, P.mid);
  assert.equal(free.quantity, 1);
  assert.equal(free.subtotalSom, 0);
  assert.equal(r.fee.promoDiscountSom, 33_000);
  // a dish outside the offer is paid in full, and three lavash still give one free
  const mixed = await check([{ productId: P.big, quantity: 3 }, { productId: P.cola, quantity: 1 }]);
  assert.ok(mixed.ok);
  assert.equal(mixed.totalSom, 2 * 43_000 + 8000);
  assert.equal((await restaurantMenu(restaurantId))!.promotions.length, 1);
});

test('promotion: the cap per order limits the free units', async () => {
  await setPromotionCap(ADMIN, promoRef(promoId), 1);
  try {
    const r = await check([{ productId: P.small, quantity: 6 }]);
    assert.ok(r.ok);
    assert.equal(r.lines.find(l => l.free)!.quantity, 1);
    assert.equal(r.totalSom, 5 * 28_000);
  } finally { await setPromotionCap(ADMIN, promoRef(promoId), 0); }
});

test('LINE mode: an order with a free unit has its platform line waived (crossed out, nothing charged); without one it is charged', async () => {
  await setFeeMode({ adminId: ADMIN, mode: 'LINE', lineSom: 5000, lineWaived: false });
  const withFree = await check([{ productId: P.big, quantity: 2 }]);
  assert.ok(withFree.ok);
  assert.equal(withFree.totalSom, 43_000);
  assert.equal(withFree.fee.ruleCode, 'LINE_FREE_5000');
  assert.equal(withFree.fee.feeSom, 0);
  const noFree = await check([{ productId: P.big, quantity: 1 }]);
  assert.ok(noFree.ok);
  assert.equal(noFree.totalSom, 48_000);
  assert.equal(noFree.fee.ruleCode, 'LINE_5000');
});

test('placing the order stores the free line (priced 0), the paid lines, the box and the discount', async () => {
  const placed = await place([{ productId: P.big, quantity: 1 }, { productId: P.mid, quantity: 1 }, { productId: P.osh, quantity: 1 }]);
  const o = await db.order.findUniqueOrThrow({ where: { id: placed!.id }, include: { items: true } });
  assert.equal(o.totalSom, 43_000 + 35_000 + 5000);
  assert.equal(o.promoDiscountSom, 33_000);
  assert.equal(o.feeRuleCode, 'LINE_FREE_5000');
  assert.equal(o.serviceFeeSom, 0);
  const sum = o.items.reduce((s, i) => s + i.subtotalSom, 0);
  assert.equal(sum, o.totalSom);
  const freeLine = o.items.find(i => i.unitSom === 0)!;
  assert.match(freeLine.name, /bepul/);
  assert.equal(freeLine.productId, P.mid);
  assert.ok(o.items.some(i => i.productId === P.box && i.quantity === 1));
  assert.equal(o.items.reduce((n, i) => n + (i.productId === P.mid ? i.quantity : 0), 0), 1);
});

test('a price the app showed that no longer matches is refused, free and box lines never trip the per-product price check', async () => {
  const quote = await placeOrder(engine, {
    restaurantId, telegramUserId: customerTg, customerName: 'Tester', phone: '+998901234567', addressText: 'Test manzil', taxiCompanyId: taxiId,
    checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'MOCK', items: [{ productId: P.big, quantity: 2 }, { productId: P.osh, quantity: 1 }],
    expectedTotalSom: 43_000 + 40_000, expectedUnitPrices: { [P.big]: 43_000, [P.osh]: 35_000 },
  });
  assert.ok(quote);
  await assert.rejects(() => placeOrder(engine, {
    restaurantId, telegramUserId: customerTg, customerName: 'Tester', phone: '+998901234567', addressText: 'Test manzil', taxiCompanyId: taxiId,
    checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'MOCK', items: [{ productId: P.big, quantity: 2 }], expectedTotalSom: 86_000,
  }), (e: unknown) => e instanceof CheckoutError && e.message === 'NARX_OZGARGAN');
});

test('banners: a slide of a promotion shows only while the promotion is on and has a dish; a plain slide shows while it is on', async () => {
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(1500, 7)]);
  const promoBanner = await db.banner.create({ data: { title: 'Lavash 1+1', promotionId: promoId, restaurantId } });
  const plain = await db.banner.create({ data: { title: 'Yangilik', restaurantId, position: 5 } });
  const mine = async () => (await publicBanners()).filter(b => [promoBanner.id, plain.id].includes(b.id));
  assert.equal((await mine()).length, 0, 'no picture yet: nothing to show');
  await setBannerImage(promoBanner.id, png);
  await setBannerImage(plain.id, png);
  const both = await mine();
  assert.deepEqual(both.map(b => b.id), [promoBanner.id, plain.id]);
  assert.deepEqual(both[0]!.target, { restaurantId, promo: true });
  assert.deepEqual(both[1]!.target, { restaurantId, promo: false });
  await setPromotionActive(ADMIN, promoRef(promoId), false);
  assert.deepEqual((await mine()).map(b => b.id), [plain.id]);
  await setPromotionActive(ADMIN, promoRef(promoId), true);
  await db.banner.update({ where: { id: plain.id }, data: { endsAt: new Date(Date.now() - 1000) } });
  assert.deepEqual((await mine()).map(b => b.id), [promoBanner.id]);
  await assert.rejects(() => setBannerImage(plain.id, Buffer.from('not an image'.repeat(200))), /RASM_NOTOGRI/);
});
