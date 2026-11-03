import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { CheckoutError, placeOrder } from '../modules/orders/service.js';
import { attemptKey, setRestaurantPassword } from '../modules/restaurant-auth/service.js';
import { decideCard, luhnValid, cardNumberSchema, maskCard, groupCard } from '../modules/restaurant-cards/service.js';
import { announcePendingCards, renderPendingCard } from '../bot/card-admin.js';
import { payeeNumber } from '../modules/payment/requisites.js';

// Stage 8B: restaurant-managed payee cards. Everything runs on ds_delivery_test with no Telegram, no money and no taxi worker.
process.env.MAX_OPEN_UNPAID_ORDERS = '0';
process.env.RESTAURANT_LOGIN_MAX_FAILURES = '50';
process.env.RESTAURANT_LOGIN_IP_MAX_FAILURES = '1000';
process.env.CARD_ADD_PER_15MIN = '40';

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const app = buildApp(engine);
const nonce = randomUUID().slice(0, 8);
const slugA = `cd-a-${nonce}`;
const slugB = `cd-b-${nonce}`;
const PW_A = `Alpha-${randomUUID()}`;
const PW_B = `Bravo-${randomUUID()}`;
const customerTg = String(randomInt(700000000001, 800000000000));
const operatorTg = String(randomInt(900000000001, 990000000000));
const ids: Record<string, string> = {};
const ips: string[] = [];
let taxiId = '';
let tokenA = '';
let tokenB = '';

const ip = () => { const v = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`; ips.push(v); return v; };
/** A syntactically valid (Luhn) 16-digit number whose last four digits are unused by any card in the test database. */
async function freshNumber(prefix = '8600'): Promise<string> {
  for (;;) {
    const body = prefix + String(randomInt(0, 100_000_000_000)).padStart(11, '0');
    let sum = 0;
    for (let i = 0; i < 15; i++) { let d = Number(body[14 - i]); if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } sum += d; }
    const n = body + String((10 - (sum % 10)) % 10);
    if (!(await db.card.findUnique({ where: { last4: n.slice(-4) } }))) return n;
  }
}
async function login(slug: string, password: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/v1/restaurant/auth/login', payload: { slug, password }, remoteAddress: ip() });
  assert.equal(r.statusCode, 200);
  return r.json().accessToken;
}
const call = (method: 'GET' | 'POST', url: string, token: string | null, payload?: unknown) =>
  app.inject({ method, url: `/api/v1/restaurant${url}`, payload: payload as object | undefined, headers: token ? { authorization: `Bearer ${token}` } : {} });
const addCard = (token: string, number: string, password = PW_A) => call('POST', '/cards', token, { number, password });
const row = (id: string) => db.card.findUniqueOrThrow({ where: { id } });
const events = async (id: string) => (await db.cardEvent.findMany({ where: { cardId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(e => e.action);
async function realOrder(restaurantId: string) {
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
  ids.a = (await db.restaurant.create({ data: { slug: slugA, name: `CD A ${nonce}`, pickupAddress: 'Pickup 1', pickupPhone: '+998900000001' } })).id;
  ids.b = (await db.restaurant.create({ data: { slug: slugB, name: `CD B ${nonce}`, pickupAddress: 'Pickup 2' } })).id;
  await setRestaurantPassword({ slug: slugA, password: PW_A });
  await setRestaurantPassword({ slug: slugB, password: PW_B });
  taxiId = (await db.taxiCompany.create({ data: { name: `CD Taxi ${randomUUID()}`, operatorTelegramUserId: operatorTg, isActive: true } })).id;
  tokenA = await login(slugA, PW_A);
  tokenB = await login(slugB, PW_B);
});

after(async () => {
  const rids = Object.values(ids);
  const orders = (await db.order.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(o => o.id);
  const pays = await db.payment.findMany({ where: { OR: [{ orderId: { in: orders } }, { restaurantId: { in: rids } }] }, select: { id: true } });
  const cards = await db.card.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } });
  await db.restaurantLoginAttempt.deleteMany({ where: { keyHash: { in: [slugA, slugB].map(s => attemptKey('slug', s)).concat(ips.map(i => attemptKey('ip', i))) } } });
  await db.taxiDispatch.deleteMany({ where: { orderId: { in: orders } } });
  await db.paymentEvent.deleteMany({ where: { paymentId: { in: pays.map(p => p.id) } } });
  await db.payment.deleteMany({ where: { id: { in: pays.map(p => p.id) } } });
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards.map(c => c.id) } } });
  await db.cardEvent.deleteMany({ where: { cardId: { in: cards.map(c => c.id) } } });
  await db.card.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.order.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.customer.deleteMany({ where: { telegramUserId: customerTg } });
  await db.product.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.restaurant.deleteMany({ where: { id: { in: rids } } });
  await db.taxiCompany.deleteMany({ where: { id: taxiId } });
  await app.close();
  await db.$disconnect();
});

test('number validation: Luhn typo guard, 16 digits, spaces and dashes accepted, masking never shows the number', async () => {
  const n = await freshNumber();
  assert.equal(luhnValid(n), true);
  assert.equal(luhnValid(n.slice(0, 15) + String((Number(n[15]) + 1) % 10)), false);
  assert.equal(cardNumberSchema.parse(`${n.slice(0, 4)} ${n.slice(4, 8)}-${n.slice(8, 12)} ${n.slice(12)}`), n);
  for (const bad of ['', '1234', 'abcd efgh ijkl mnop', n + '0', n.slice(0, 15)]) assert.equal(cardNumberSchema.safeParse(bad).success, false, bad);
  assert.equal(maskCard('1234'), '**** **** **** 1234');
  assert.equal(groupCard('8600123456781234'), '8600 1234 5678 1234');
});

test('adding a card needs a session but no password; a typo or a foreign field creates nothing; an old app that still sends a password keeps working', async () => {
  const n = await freshNumber();
  assert.equal((await call('POST', '/cards', null, { number: n })).statusCode, 401);
  assert.equal((await call('POST', '/cards', tokenA, { number: n.slice(0, 15) + String((Number(n[15]) + 1) % 10) })).statusCode, 400);
  assert.equal((await call('POST', '/cards', tokenA, { number: n, restaurantId: ids.b })).statusCode, 400, 'strict body: a client-sent restaurantId is refused');
  assert.equal(await db.card.count({ where: { last4: n.slice(-4) } }), 0);
  assert.equal((await call('GET', '/cards', null)).statusCode, 401);
  const noPassword = await call('POST', '/cards', tokenA, { number: n });
  assert.equal(noPassword.statusCode, 201);
  assert.equal(noPassword.json().card.status, 'PENDING', 'no password, but still needs the administrator before it is used');
  const m = await freshNumber();
  assert.equal((await addCard(tokenB, m, 'whatever-an-old-app-sends')).statusCode, 201, 'the old field is accepted and ignored');
});

test('a new card is PENDING and inactive: masked in the response, never assignable, enabling is refused', async () => {
  const n = await freshNumber();
  const r = await addCard(tokenA, n);
  assert.equal(r.statusCode, 201);
  const card = r.json().card;
  assert.equal(card.status, 'PENDING');
  assert.equal(card.masked, `**** **** **** ${n.slice(-4)}`);
  assert.ok(!r.body.includes(n) && !r.body.includes(n.slice(0, 12)), 'the full number is never sent back to the restaurant');
  const stored = await row(card.id);
  assert.equal(stored.active, false);
  assert.equal(stored.approvalStatus, 'PENDING');
  assert.equal(stored.number, n);
  assert.equal(stored.isTest, false);
  assert.equal(stored.restaurantId, ids.a);
  const list = await call('GET', '/cards', tokenA);
  assert.ok(!list.body.includes(n));
  assert.ok(list.json().cards.some((c: { id: string; status: string }) => c.id === card.id && c.status === 'PENDING'));
  const enable = await call('POST', `/cards/${card.id}/enable`, tokenA);
  assert.equal(enable.statusCode, 409);
  assert.equal(enable.json().error, 'NOT_APPROVED');
  assert.equal((await call('POST', `/cards/${card.id}/disable`, tokenA)).statusCode, 409, 'a pending card has nothing to disable');
  // the engine only ever assigns active cards, so a REAL payment for this restaurant finds none
  await assert.rejects(realOrder(ids.a!), (e: unknown) => e instanceof CheckoutError && e.message === 'RESTORAN_TOLOV_QABUL_QILMAYDI' && e.statusCode === 409);
  assert.deepEqual(await events(card.id), ['ADDED']);
});

test('the database itself forbids an active unapproved card and a malformed number', async () => {
  const pending = await db.card.findFirstOrThrow({ where: { restaurantId: ids.a, approvalStatus: 'PENDING' } });
  await assert.rejects(db.card.update({ where: { id: pending.id }, data: { active: true } }), /Card_unapproved_is_inactive|check constraint/i);
  await assert.rejects(db.card.update({ where: { id: pending.id }, data: { number: '86001111222233' } }), /Card_number_format|check constraint/i);
  await assert.rejects(db.card.update({ where: { id: pending.id }, data: { number: '8600111122223333' } }), /Card_number_format|check constraint/i, 'last four must match');
  await assert.rejects(db.card.update({ where: { id: pending.id }, data: { approvalStatus: 'MAYBE' } }), /Card_approval_status_valid|check constraint/i);
});

test('only an administrator makes a card usable; two admins at once produce exactly one decision', async () => {
  const pending = await db.card.findFirstOrThrow({ where: { restaurantId: ids.a, approvalStatus: 'PENDING' } });
  const [x, y] = await Promise.all([
    decideCard({ cardId: pending.id, adminId: '111', decision: 'APPROVE' }),
    decideCard({ cardId: pending.id, adminId: '222', decision: 'APPROVE' }),
  ]);
  assert.deepEqual([x.result, y.result].sort(), ['ALREADY_DECIDED', 'APPROVED']);
  const approved = await row(pending.id);
  assert.equal(approved.active, true);
  assert.equal(approved.approvalStatus, 'APPROVED');
  assert.ok(['111', '222'].includes(approved.decidedBy ?? ''));
  assert.equal((await events(pending.id)).filter(a => a === 'APPROVED').length, 1);
  assert.equal((await decideCard({ cardId: pending.id, adminId: '111', decision: 'REJECT' })).result, 'ALREADY_DECIDED', 'a later reject cannot undo it');
  assert.equal((await decideCard({ cardId: 'does-not-exist', adminId: '111', decision: 'APPROVE' })).result, 'NOT_FOUND');
  // customers now get this card and its approved number
  const placed = await realOrder(ids.a!);
  const pay = await db.payment.findFirstOrThrow({ where: { orderId: placed!.id }, include: { card: true } });
  assert.equal(pay.cardId, pending.id);
  assert.equal(payeeNumber(pay.card!), approved.number);
});

test('the restaurant can disable (checkout then refuses) and re-enable an approved card; another restaurant cannot touch it', async () => {
  const card = await db.card.findFirstOrThrow({ where: { restaurantId: ids.a, approvalStatus: 'APPROVED' } });
  assert.equal((await call('POST', `/cards/${card.id}/disable`, tokenB)).statusCode, 404, 'foreign card = not found');
  assert.equal((await call('POST', `/cards/${card.id}/enable`, tokenB)).statusCode, 404);
  assert.equal((await call('POST', `/cards/${card.id}/disable`, tokenA)).json().card.status, 'DISABLED');
  assert.equal((await call('POST', `/cards/${card.id}/disable`, tokenA)).statusCode, 200, 'repeat is harmless');
  await assert.rejects(realOrder(ids.a!), (e: unknown) => e instanceof CheckoutError && e.message === 'RESTORAN_TOLOV_QABUL_QILMAYDI');
  assert.equal((await call('POST', `/cards/${card.id}/enable`, tokenA)).json().card.status, 'ACTIVE');
  await realOrder(ids.a!);
  assert.deepEqual((await events(card.id)).filter(a => a !== 'ADDED' && a !== 'APPROVED'), ['DISABLED', 'ENABLED']);
});

test('the same last four digits cannot exist twice (the bank e-mail is matched on them), even across restaurants', async () => {
  const mine = await db.card.findFirstOrThrow({ where: { restaurantId: ids.a, approvalStatus: 'APPROVED' } });
  // another number with the same last four, valid for Luhn: search a prefix whose check digit leaves the same last four
  let clash = '';
  for (let i = 0; i < 5000 && !clash; i++) {
    const candidate = '9860' + String(randomInt(0, 100_000_000)).padStart(8, '0') + mine.last4;
    if (luhnValid(candidate)) clash = candidate;
  }
  assert.ok(clash, 'found a Luhn-valid number with the same last four');
  const r = await addCard(tokenB, clash, PW_B);
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().error, 'CARD_TAKEN');
  const again = await addCard(tokenA, clash);
  assert.equal(again.json().error, 'CARD_EXISTS', 'own card with that suffix: the restaurant is told to enable it instead');
  assert.equal(await db.card.count({ where: { last4: mine.last4 } }), 1);
});

test('limits: at most 2 pending, and a rejected card can be submitted again', async () => {
  const [n1, n2, n3] = [await freshNumber(), await freshNumber(), await freshNumber()];
  const c1 = (await addCard(tokenB, n1, PW_B)).json().card;
  const c2 = (await addCard(tokenB, n2, PW_B)).json().card;
  const third = await addCard(tokenB, n3, PW_B);
  assert.equal(third.statusCode, 409);
  assert.equal(third.json().error, 'CARD_PENDING_LIMIT');
  assert.equal((await decideCard({ cardId: c1.id, adminId: '111', decision: 'REJECT' })).result, 'REJECTED');
  assert.equal((await row(c1.id)).active, false);
  assert.equal((await call('POST', `/cards/${c1.id}/enable`, tokenB)).statusCode, 409, 'a rejected card cannot be enabled by the restaurant');
  // a pending slot is free again; the rejected card is resubmitted (same row, back to PENDING, announced again)
  const resubmitted = await addCard(tokenB, n1, PW_B);
  assert.equal(resubmitted.statusCode, 201);
  assert.equal(resubmitted.json().card.id, c1.id);
  const again = await row(c1.id);
  assert.equal(again.approvalStatus, 'PENDING');
  assert.equal(again.adminNotifiedAt, null);
  assert.ok((await events(c1.id)).includes('RESUBMITTED'));
  void c2;
});

test('admin Telegram announcement: full number to every admin once, marked only after a delivery, retried after a failure', async () => {
  const saved = { a: process.env.SUPPORT_ADMIN_1_TELEGRAM_ID, b: process.env.SUPPORT_ADMIN_2_TELEGRAM_ID };
  process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = '111'; process.env.SUPPORT_ADMIN_2_TELEGRAM_ID = '222';
  try {
    // make every pending card of this test known first, then add one fresh card and watch only it
    const sentEarlier: string[] = [];
    await announcePendingCards({ telegram: { async sendMessage(id: string, text: string) { sentEarlier.push(`${id}:${text}`); } } }, () => undefined);
    const n = await freshNumber();
    const c = (await addCard(tokenA, n)).json().card;
    const failing = { telegram: { async sendMessage() { throw new Error('Forbidden: bot was blocked'); } } };
    assert.equal(await announcePendingCards(failing, () => undefined), 0);
    assert.equal((await row(c.id)).adminNotifiedAt, null, 'nobody received it: it stays unannounced');
    const got: Array<{ to: string; text: string; markup: unknown }> = [];
    const ok = { telegram: { async sendMessage(to: string, text: string, extra?: { reply_markup?: unknown }) { got.push({ to, text, markup: extra?.reply_markup }); } } };
    assert.ok(await announcePendingCards(ok, () => undefined) >= 1);
    const mine = got.filter(g => g.text.includes(n.slice(0, 4) + ' ' + n.slice(4, 8)));
    assert.deepEqual(mine.map(g => g.to).sort(), ['111', '222']);
    assert.match(mine[0]!.text, /CD A/);
    assert.ok(JSON.stringify(mine[0]!.markup).includes(`card:ask:${c.id}`), 'approval is a two-step action');
    assert.notEqual((await row(c.id)).adminNotifiedAt, null);
    const before = got.length;
    await announcePendingCards(ok, () => undefined);
    assert.equal(got.length, before, 'announced once');
    // once decided it is no longer rendered as actionable
    await decideCard({ cardId: c.id, adminId: '111', decision: 'REJECT' });
    assert.equal(await renderPendingCard(c.id), null);
    // no admin configured: nothing is sent and the card stays unannounced
    delete process.env.SUPPORT_ADMIN_1_TELEGRAM_ID; delete process.env.SUPPORT_ADMIN_2_TELEGRAM_ID;
    const c2 = (await addCard(tokenA, await freshNumber())).json().card;
    assert.equal(await announcePendingCards(ok, () => undefined), 0);
    assert.equal((await row(c2.id)).adminNotifiedAt, null);
  } finally {
    if (saved.a === undefined) delete process.env.SUPPORT_ADMIN_1_TELEGRAM_ID; else process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = saved.a;
    if (saved.b === undefined) delete process.env.SUPPORT_ADMIN_2_TELEGRAM_ID; else process.env.SUPPORT_ADMIN_2_TELEGRAM_ID = saved.b;
  }
});

test('legacy cards without a stored number keep using the operator configuration', () => {
  assert.equal(payeeNumber({ last4: '8167', number: null }, { BOT_REAL_CARD_NUMBERS_JSON: '{"8167":"8600123456788167"}' }), '8600123456788167');
  assert.equal(payeeNumber({ last4: '8167', number: null }, {}), null, 'no number anywhere: the customer is told not to pay');
  assert.equal(payeeNumber({ last4: '8167', number: '8600123456788167' }, {}), '8600123456788167');
  assert.equal(payeeNumber({ last4: '1111', number: '8600123456788167' }, {}), null, 'a stored number that does not end in last4 is never shown');
});

test('RESTAURANT_CARD_SELF_ADD=false: the app cannot add a card (409 with the code whose text says "contact the administrator"); an administrator can, and it is PENDING', async () => {
  const saved = process.env.RESTAURANT_CARD_SELF_ADD;
  const adminSaved = process.env.SUPPORT_ADMIN_1_TELEGRAM_ID;
  try {
    process.env.RESTAURANT_CARD_SELF_ADD = 'false';
    process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = '424242';
    const n = await freshNumber();
    const refused = await call('POST', '/cards', tokenA, { number: n });
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().error, 'CARD_TAKEN');
    assert.equal(await db.card.count({ where: { last4: n.slice(-4) } }), 0, 'nothing was created');
    assert.equal((await call('GET', '/cards', tokenA)).statusCode, 200, 'listing still works');

    await db.card.updateMany({ where: { restaurantId: ids.a, approvalStatus: 'PENDING' }, data: { approvalStatus: 'REJECTED', active: false } }); // earlier tests left pending cards
    const { addRestaurantCardAsAdmin } = await import('../modules/payment/pool-admin.js');
    const slug = (await db.restaurant.findUniqueOrThrow({ where: { id: ids.a } })).slug;
    const added = await addRestaurantCardAsAdmin({ adminId: '424242', slug, number: n, holderName: 'ISM F.' });
    assert.equal(added.ok, true, JSON.stringify(added));
    const row = await db.card.findUniqueOrThrow({ where: { last4: n.slice(-4) } });
    assert.equal(row.restaurantId, ids.a);
    assert.equal(row.approvalStatus, 'PENDING');
    assert.equal(row.active, false);
    assert.equal(row.holderName, 'ISM F.');
    assert.equal((await addRestaurantCardAsAdmin({ adminId: '424242', slug: 'no-such-slug-xyz', number: await freshNumber(), holderName: 'ISM F.' })).ok, false);
    await assert.rejects(addRestaurantCardAsAdmin({ adminId: '1', slug, number: await freshNumber(), holderName: 'ISM F.' }), /ADMIN_RUXSAT_YOQ/);

    delete process.env.RESTAURANT_CARD_SELF_ADD;
    assert.equal((await call('POST', '/cards', tokenA, { number: await freshNumber() })).statusCode, 201, 'unset = restaurants may add again');
  } finally {
    if (saved === undefined) delete process.env.RESTAURANT_CARD_SELF_ADD; else process.env.RESTAURANT_CARD_SELF_ADD = saved;
    if (adminSaved === undefined) delete process.env.SUPPORT_ADMIN_1_TELEGRAM_ID; else process.env.SUPPORT_ADMIN_1_TELEGRAM_ID = adminSaved;
  }
});
