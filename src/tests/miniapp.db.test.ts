import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { Prisma, PrismaClient } from '@prisma/client';
import { Telegraf } from 'telegraf';
import { buildApp } from '../app.js';
import { createClientBot } from '../bot/client.js';
import { initDataFromHeader, signInitData, verifyInitData } from '../modules/miniapp/auth.js';
import { registerMiniAppStatic } from '../modules/miniapp/static.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { RateLimiter } from '../lib/rate-limit.js';
import { localTime, openState } from '../modules/restaurant-operations/hours.js';
import { db as appDb } from '../lib/db.js';
import { fakeJpeg, useTempReceiptDir } from './receipt-fixtures.js';

// Mini App backend against ds_delivery_test. Telegram is never contacted (fake local server for the bot launcher test); the BOT_TOKEN
// below is a fixture used only to sign test initData. MOCK payments only, apart from REAL-mode boundary checks that never move money.
const BOT_TOKEN = '123456789:AAFakeMiniAppTokenLocalOnly_0123456789';
process.env.BOT_TOKEN = BOT_TOKEN;
useTempReceiptDir();
process.env.MINIAPP_ENABLED = 'true';
process.env.MINIAPP_URL = 'https://miniapp.example.test/app/';
process.env.MINIAPP_ORDER_RATE_PER_MINUTE = '500'; // the production default (10/min) has its own test below
delete process.env.BOT_PAYMENT_MODE;
delete process.env.RESTAURANT_MANUAL_ACCEPTANCE;
delete process.env.CHAT_CHECKOUT_ENABLED;
delete process.env.BOT_REAL_CARD_NUMBERS_JSON;

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const app = buildApp(engine);
const nonce = randomUUID().slice(0, 8);
const userA = String(randomInt(700000000001, 750000000000));
const userB = String(randomInt(750000000001, 800000000000));
const userC = String(randomInt(800000000001, 850000000000)); // a fresh profile for the checkout test (userA's address book is full by then)
const operatorTg = String(randomInt(900000000001, 990000000000));
process.env.TAXI_OPERATOR_ALLOWLIST = operatorTg;
const ids: Record<string, string> = {};
const cardLast4: string[] = [];
let realLast4 = '';
let mockLast4 = '';
let taxiId = '';
const tmpDirs: string[] = [];

const initFor = (userId: string, over: Record<string, string> = {}, token = BOT_TOKEN) => signInitData({
  auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
  user: JSON.stringify({ id: Number(userId), first_name: 'Test', last_name: 'User', username: 'tester', language_code: 'uz' }), ...over,
}, token);
const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, userId: string | null, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method, url: `/api/v1/miniapp${url}`, payload: payload as object | undefined,
    headers: { ...(userId ? { authorization: `tma ${initFor(userId)}` } : {}), ...headers } });
const row = (id: string) => db.order.findUniqueOrThrow({ where: { id } });
const counts = async () => ({ orders: await db.order.count({ where: { restaurantId: { in: Object.values(ids) } } }), payments: await db.payment.count({ where: { restaurantId: { in: Object.values(ids) } } }) });
async function product(price = randomInt(10_000, 900_000), available = true, restaurant = ids.a!) {
  return db.product.create({ data: { restaurantId: restaurant, name: `MP${randomUUID().slice(0, 6)}`, priceSom: price, isAvailable: available } });
}
async function checkout(userId: string, over: Record<string, unknown> = {}, p?: { id: string; priceSom: number }) {
  const prod = p ?? await product();
  const body = { checkoutKey: randomUUID(), restaurantId: ids.a!, items: [{ productId: prod.id, quantity: 2 }], expectedTotalSom: prod.priceSom * 2,
    address: { addressText: 'Chilonzor 7, 12-uy' }, phone: '+998901234567', ...over };
  return { res: await call('POST', '/orders', userId, body), body, prod };
}

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  ids.a = (await db.restaurant.create({ data: { slug: `mp-a-${nonce}`, name: `MP Resto ${nonce}`, pickupAddress: 'Pickup 1', pickupPhone: '+998900000001' } })).id;
  ids.b = (await db.restaurant.create({ data: { slug: `mp-b-${nonce}`, name: `MP Paused ${nonce}`, isPaused: true } })).id;
  taxiId = (await db.taxiCompany.create({ data: { name: `MP Taxi ${randomUUID()}`, isActive: true, operatorTelegramUserId: operatorTg } })).id;
  for (const isTest of [false, true]) {
    for (;;) {
      const c = String(randomInt(1000, 9999));
      if (cardLast4.includes(c) || await db.card.findUnique({ where: { last4: c } })) continue;
      cardLast4.push(c); await engine.addCard(c, isTest, ids.a!);
      if (isTest) mockLast4 = c; else realLast4 = c;
      break;
    }
  }
});
after(async () => {
  const rids = Object.values(ids);
  const customers = await db.customer.findMany({ where: { telegramUserId: { in: [userA, userB, userC] } }, select: { id: true } });
  const orders = (await db.order.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(o => o.id);
  await db.notificationLog.deleteMany({ where: { orderId: { in: orders } } });
  await db.refundRequest.deleteMany({ where: { orderId: { in: orders } } });
  const pays = await db.payment.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } });
  await db.incomingTransaction.deleteMany({ where: { OR: [{ matchedPaymentId: { in: pays.map(p => p.id) } }, { cardLast4: { in: cardLast4 } }] } });
  await db.taxiDispatch.deleteMany({ where: { orderId: { in: orders } } });
  await db.payment.deleteMany({ where: { id: { in: pays.map(p => p.id) } } });
  const cards = await db.card.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } });
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards.map(c => c.id) } } });
  await db.card.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.order.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.customer.deleteMany({ where: { id: { in: customers.map(c => c.id) } } }); // addresses cascade
  await db.product.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.restaurant.deleteMany({ where: { id: { in: rids } } });
  await db.taxiCompany.deleteMany({ where: { id: taxiId } });
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
  await app.close();
  await db.$disconnect();
  await appDb.$disconnect();
});

// ------------------------------------------------------------------------------------------------ initData verification (pure)
test('initData: valid signature accepted; every tamper, wrong token, stale or future date and non-user is refused', () => {
  const now = Math.floor(Date.now() / 1000);
  const fields = { auth_date: String(now), query_id: 'AAH', user: JSON.stringify({ id: 4242, first_name: 'A', username: 'a' }) };
  const good = signInitData(fields, BOT_TOKEN);
  const ok = verifyInitData(good, BOT_TOKEN, { maxAgeSeconds: 3600 });
  assert.ok(ok.ok && ok.user.id === '4242' && ok.user.username === 'a');
  const refused = (raw: string, reason: string, maxAge = 3600, token = BOT_TOKEN) => {
    const r = verifyInitData(raw, token, { maxAgeSeconds: maxAge });
    assert.ok(!r.ok && r.reason === reason, `${reason}: ${JSON.stringify(r)}`);
  };
  refused(good, 'BAD_SIGNATURE', 3600, '999:AAOtherBotTokenOtherBotTokenOtherBot'); // signed for another bot
  const params = new URLSearchParams(good);
  params.set('user', JSON.stringify({ id: 1, first_name: 'Evil' }));
  refused(params.toString(), 'BAD_SIGNATURE');                                  // user swapped after signing
  const extra = new URLSearchParams(good); extra.set('start_param', 'x');
  refused(extra.toString(), 'BAD_SIGNATURE');                                   // added field
  const noHash = new URLSearchParams(good); noHash.delete('hash');
  refused(noHash.toString(), 'MALFORMED');
  refused('hash=abc&user=%7B%7D', 'MALFORMED');
  refused('', 'MALFORMED');
  refused(signInitData({ ...fields, auth_date: String(now - 7200) }, BOT_TOKEN), 'EXPIRED');
  refused(signInitData({ ...fields, auth_date: String(now + 3600) }, BOT_TOKEN), 'FUTURE');
  refused(signInitData({ auth_date: String(now), query_id: 'AAH' }, BOT_TOKEN), 'NO_USER');
  refused(signInitData({ ...fields, user: 'not json' }, BOT_TOKEN), 'NO_USER');
  refused(signInitData({ ...fields, user: JSON.stringify({ id: 5, first_name: 'Bot', is_bot: true }) }, BOT_TOKEN), 'NO_USER');
  refused(signInitData({ ...fields, user: JSON.stringify({ id: -3, first_name: 'X' }) }, BOT_TOKEN), 'NO_USER');
  refused(signInitData({ ...fields, user: JSON.stringify({ id: '4242', first_name: 'X' }) }, BOT_TOKEN), 'NO_USER'); // id must be a number
  assert.equal(initDataFromHeader('tma abc=1&hash=2'), 'abc=1&hash=2');
  assert.equal(initDataFromHeader('Bearer abc'), null);
  assert.equal(initDataFromHeader(undefined), null);
});

test('rate limiter: sliding window, rejected attempts do not extend it, memory is bounded', () => {
  let t = 1_000_000;
  const l = new RateLimiter(() => t, 10);
  for (let i = 0; i < 3; i++) assert.equal(l.allow('k', 3, 1000).allowed, true);
  const blocked = l.allow('k', 3, 1000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
  t += 1001;
  assert.equal(l.allow('k', 3, 1000).allowed, true, 'window slid');
  for (let i = 0; i < 100; i++) l.allow(`other${i}`, 1, 1000);
  t += 5000;
  l.allow('trigger', 1, 1000);
  assert.ok(l.size() <= 12, `bounded, size ${l.size()}`);
});

test('working hours are evaluated in the restaurant time zone, with boundaries and next opening', () => {
  const days = (open: string, close: string, closedDays: number[] = []) => [1, 2, 3, 4, 5, 6, 7].map(d => ({ dayOfWeek: d, isOpen: !closedDays.includes(d), openTime: open, closeTime: close }));
  const hours = days('09:00', '22:00', [7]) as unknown as Prisma.JsonValue;
  // 2026-10-19 is a Monday. 04:30 UTC = 09:30 in Tashkent (UTC+5)
  const monday0430utc = new Date('2026-10-19T04:30:00Z');
  assert.deepEqual(localTime(monday0430utc, 'Asia/Tashkent'), { dayOfWeek: 1, minutes: 9 * 60 + 30 });
  assert.equal(openState({ workingHours: hours, timezone: 'Asia/Tashkent' }, monday0430utc).open, true);
  // the same instant in New York is Sunday 00:30: closed there, because Sunday is closed
  assert.deepEqual(localTime(monday0430utc, 'America/New_York'), { dayOfWeek: 1, minutes: 0 * 60 + 30 });
  const nyClosed = openState({ workingHours: hours, timezone: 'America/New_York' }, monday0430utc);
  assert.equal(nyClosed.open, false);
  assert.deepEqual(nyClosed.open ? null : nyClosed.opensNext, { dayOffset: 0, dayOfWeek: 1, time: '09:00' });
  // boundaries: opens at 09:00 sharp, last second before 22:00 is open, 22:00 is closed
  assert.equal(openState({ workingHours: hours, timezone: 'Asia/Tashkent' }, new Date('2026-10-19T03:59:59Z')).open, false); // 08:59:59
  assert.equal(openState({ workingHours: hours, timezone: 'Asia/Tashkent' }, new Date('2026-10-19T04:00:00Z')).open, true);  // 09:00
  assert.equal(openState({ workingHours: hours, timezone: 'Asia/Tashkent' }, new Date('2026-10-19T16:59:59Z')).open, true);  // 21:59:59
  const late = openState({ workingHours: hours, timezone: 'Asia/Tashkent' }, new Date('2026-10-19T17:00:00Z'));             // 22:00
  assert.equal(late.open, false);
  assert.deepEqual(late.open ? null : late.opensNext, { dayOffset: 1, dayOfWeek: 2, time: '09:00' });
  // Saturday evening -> Sunday closed -> next opening is Monday
  const sat = openState({ workingHours: hours, timezone: 'Asia/Tashkent' }, new Date('2026-10-24T17:30:00Z'));
  assert.deepEqual(sat.open ? null : sat.opensNext, { dayOffset: 2, dayOfWeek: 1, time: '09:00' });
  assert.equal(openState({ workingHours: null, timezone: 'Asia/Tashkent' }, monday0430utc).open, true, 'no schedule configured = always open');
  assert.equal(openState({ workingHours: { nonsense: true } as never, timezone: 'Asia/Tashkent' }, monday0430utc).open, true);
  assert.equal(openState({ workingHours: hours, timezone: 'Not/AZone' }, monday0430utc).open, true, 'an invalid zone falls back to Asia/Tashkent');
});

// ------------------------------------------------------------------------------------------------ HTTP authentication
test('API: needs the feature flag and verified initData; every failure looks the same; floods are throttled', async () => {
  const noAuth = await call('GET', '/me', null);
  assert.equal(noAuth.statusCode, 401);
  const forged = await call('GET', '/me', null, undefined, { authorization: `tma ${initFor(userA, {}, '999:AAWrongTokenWrongTokenWrongTokenWrong')}` });
  const expired = await call('GET', '/me', null, undefined, { authorization: `tma ${initFor(userA, { auth_date: String(Math.floor(Date.now() / 1000) - 10 * 86_400) })}` });
  const garbage = await call('GET', '/me', null, undefined, { authorization: 'tma hash=' + 'a'.repeat(64) });
  for (const r of [forged, expired, garbage]) {
    assert.equal(r.statusCode, 401);
    assert.deepEqual(r.json(), noAuth.json(), 'no oracle: identical body whatever was wrong');
  }
  // the identity is never taken from anything but the signed user
  const spoof = await app.inject({ method: 'GET', url: '/api/v1/miniapp/me?telegramUserId=1&customerId=x', headers: { authorization: `tma ${initFor(userA)}`, 'x-telegram-user-id': '1' } });
  assert.equal(spoof.statusCode, 200);
  // flag off -> plain 404, even with a valid signature
  process.env.MINIAPP_ENABLED = 'false';
  try { assert.equal((await call('GET', '/me', userA)).statusCode, 404); } finally { process.env.MINIAPP_ENABLED = 'true'; }
  // repeated failures from one address are throttled
  const flood = [];
  for (let i = 0; i < 30; i++) flood.push(await app.inject({ method: 'GET', url: '/api/v1/miniapp/me', remoteAddress: '10.99.99.99', headers: { authorization: 'tma nope' } }));
  assert.ok(flood.some(r => r.statusCode === 429), 'throttled');
  assert.ok(flood.slice(0, 5).every(r => r.statusCode === 401));
});

// ------------------------------------------------------------------------------------------------ profile
test('profile: phone and addresses persist per Telegram user; one default; edit/delete; limit; strict isolation', async () => {
  assert.deepEqual((await call('GET', '/me', userA)).json().addresses, [], 'a new user has nothing');
  assert.equal((await call('PUT', '/me/phone', userA, { phone: '12345' })).statusCode, 400);
  assert.equal((await call('PUT', '/me/phone', userA, { phone: '+998901112233', telegramUserId: userB })).statusCode, 400, 'strict body');
  assert.equal((await call('PUT', '/me/phone', userA, { phone: '+998901112233' })).statusCode, 200);
  const home = (await call('POST', '/me/addresses', userA, { label: 'Uy', addressText: 'Chilonzor 7, 12-uy', lat: 41.3, lng: 69.2 })).json();
  assert.equal(home.isDefault, true, 'the first address becomes the default');
  const work = (await call('POST', '/me/addresses', userA, { label: 'Ish', addressText: 'Amir Temur 1' })).json();
  assert.equal(work.isDefault, false);
  assert.equal((await call('POST', '/me/addresses', userA, { label: 'x', addressText: 'ab' })).statusCode, 400, 'too short');
  assert.equal((await call('POST', '/me/addresses', userA, { label: 'x', addressText: 'Valid address', lat: 41 })).statusCode, 400, 'lat without lng');
  // "new session": a fresh initData for the same Telegram user sees the same saved data
  const again = (await call('GET', '/me', userA)).json();
  assert.equal(again.phone, '+998901112233');
  assert.deepEqual(again.addresses.map((a: { label: string }) => a.label), ['Uy', 'Ish']);
  assert.equal(again.defaultAddressId, home.id);
  // exactly one default, enforced by the database too
  assert.equal((await call('POST', `/me/addresses/${work.id}/default`, userA)).json().isDefault, true);
  const afterSwitch = (await call('GET', '/me/addresses', userA)).json();
  assert.equal(afterSwitch.filter((a: { isDefault: boolean }) => a.isDefault).length, 1);
  const cust = await db.customer.findUniqueOrThrow({ where: { telegramUserId: userA } });
  await assert.rejects(db.customerAddress.updateMany({ where: { customerId: cust.id }, data: { isDefault: true } }), /unique|Unique/);
  // edit
  const edited = await call('PUT', `/me/addresses/${home.id}`, userA, { label: 'Uy (yangi)', addressText: 'Chilonzor 9' });
  assert.equal(edited.json().label, 'Uy (yangi)');
  assert.equal(edited.json().lat, null, 'a full replace: omitted coordinates are cleared');
  // another customer: invisible and untouchable
  await call('PUT', '/me/phone', userB, { phone: '+998900000002' });
  assert.deepEqual((await call('GET', '/me', userB)).json().addresses, []);
  for (const [m, u, b] of [['PUT', `/me/addresses/${home.id}`, { label: 'hack', addressText: 'hacked address' }], ['POST', `/me/addresses/${home.id}/default`, undefined], ['DELETE', `/me/addresses/${home.id}`, undefined]] as const) {
    assert.equal((await call(m, u, userB, b)).statusCode, 404, `${m} ${u}`);
  }
  assert.equal((await db.customerAddress.findUniqueOrThrow({ where: { id: home.id } })).addressText, 'Chilonzor 9');
  // deleting the default promotes another one
  assert.equal((await call('DELETE', `/me/addresses/${work.id}`, userA)).statusCode, 204);
  const left = (await call('GET', '/me/addresses', userA)).json();
  assert.equal(left.length, 1);
  assert.equal(left[0].isDefault, true);
  // limit of 10, even when requests race
  const results = await Promise.all(Array.from({ length: 14 }, (_, i) => call('POST', '/me/addresses', userA, { label: `A${i}`, addressText: `Address number ${i}` })));
  assert.equal(results.filter(r => r.statusCode === 201).length, 9);
  assert.ok(results.filter(r => r.statusCode === 409).every(r => r.json().error === 'ADDRESS_LIMIT'));
  assert.equal(await db.customerAddress.count({ where: { customerId: cust.id } }), 10);
});

// ------------------------------------------------------------------------------------------------ catalog & quote
test('restaurants and menu show real availability, open/closed status and hours', async () => {
  const list = (await call('GET', '/restaurants', userA)).json().restaurants as Array<{ id: string; isOpen: boolean; closedReason: string | null }>;
  assert.equal(list.find(r => r.id === ids.a)!.isOpen, true);
  const paused = list.find(r => r.id === ids.b)!;
  assert.equal(paused.isOpen, false);
  assert.equal(paused.closedReason, 'PAUSED');
  assert.ok((await call('GET', `/restaurants?q=${encodeURIComponent('Paused')}`, userA)).json().restaurants.some((r: { id: string }) => r.id === ids.b));
  assert.ok(!(await call('GET', '/restaurants?q=zzzzzz-nothing', userA)).json().restaurants.length);
  const p = await product(15_000); const off = await product(9_000, false);
  const menu = (await call('GET', `/restaurants/${ids.a}/menu`, userA)).json();
  const byId = new Map<string, { isAvailable: boolean; priceSom: number }>(menu.products.map((x: { id: string; isAvailable: boolean; priceSom: number }) => [x.id, x]));
  assert.equal(byId.get(p.id)!.isAvailable, true);
  assert.equal(byId.get(off.id)!.isAvailable, false, 'unavailable products are listed but flagged');
  assert.equal((await call('GET', '/restaurants/does-not-exist/menu', userA)).statusCode, 404);
  // configured hours close the restaurant for new orders (closed all week)
  const closedWeek = [1, 2, 3, 4, 5, 6, 7].map(d => ({ dayOfWeek: d, isOpen: false, openTime: '09:00', closeTime: '22:00' }));
  await db.restaurant.update({ where: { id: ids.a! }, data: { workingHours: closedWeek } });
  try {
    const closed = (await call('GET', '/restaurants', userA)).json().restaurants.find((r: { id: string }) => r.id === ids.a);
    assert.equal(closed.isOpen, false);
    assert.equal(closed.closedReason, 'HOURS');
    const q = (await call('POST', '/quote', userA, { restaurantId: ids.a, items: [{ productId: p.id, quantity: 1 }] })).json();
    assert.equal(q.ok, false);
    assert.ok(q.issues.some((i: { kind: string }) => i.kind === 'RESTAURANT_CLOSED'));
    const { res } = await checkout(userA, {}, p);
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error, 'RESTORAN_YOPIQ');
  } finally { await db.restaurant.update({ where: { id: ids.a! }, data: { workingHours: Prisma.DbNull } }); }
  const q2 = (await call('POST', '/quote', userA, { restaurantId: ids.a, items: [{ productId: p.id, quantity: 3 }] })).json();
  assert.equal(q2.ok, true);
  assert.equal(q2.totalSom, 45_000);
  assert.equal(q2.estimatedPrepMinutes, 25);
});

// ------------------------------------------------------------------------------------------------ checkout
test('checkout: validated, frozen, PAYMENT_PENDING with the real MOCK card; idempotent under concurrent taps; remembers phone and address', async () => {
  const before = await counts();
  const { res, body, prod } = await checkout(userC, { address: { label: 'Mening uyim', addressText: 'Yunusobod 4-mavze 8', lat: 41.36, lng: 69.28, save: true }, phone: '+998935550101' });
  assert.equal(res.statusCode, 201, res.body);
  const o = res.json().order;
  assert.equal(o.status, 'PAYMENT_PENDING');
  assert.equal(o.stage, 'PAYMENT_PENDING');
  assert.equal(o.foodTotalSom, prod.priceSom * 2);
  assert.deepEqual(o.delivery, { feeSom: null, note: 'TAXI_TARIFF' }, 'delivery is never priced by the platform');
  assert.equal(o.payment.mode, 'MOCK');
  assert.equal(o.payment.instructions.isTest, true);
  assert.equal(o.payment.instructions.cardLast4, mockLast4, 'the restaurant\'s actual (test) card');
  assert.equal(o.payment.instructions.cardNumber, null, 'a MOCK payee has no number');
  assert.equal(o.payment.amountSom, prod.priceSom * 2);
  assert.ok(o.prep.minutes === 0 && o.prep.estimatedReadyAt === null, 'the customer is never promised a preparation time');
  const r = await row(o.id);
  assert.equal(r.createdViaBot, true);
  assert.equal(r.taxiCompanyId, null, 'no taxi chosen by the customer');
  assert.equal(r.allowTaxiFallback, true, 'automatic assignment may fall back to another company');
  assert.equal(r.restaurantDeadlineAt, null, 'no restaurant acceptance');
  // profile now remembers phone + saved address
  const profile = (await call('GET', '/me', userC)).json();
  assert.equal(profile.phone, '+998935550101');
  assert.ok(profile.addresses.some((a: { addressText: string; lat: number }) => a.addressText === 'Yunusobod 4-mavze 8' && a.lat === 41.36));
  // the same key again: same order, 200, nothing new
  const replay = await call('POST', '/orders', userC, body);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().order.id, o.id);
  assert.equal(replay.json().replayed, true);
  // six simultaneous taps with a fresh key: exactly one order
  const racing = { ...body, checkoutKey: randomUUID() };
  const rs = await Promise.all(Array.from({ length: 6 }, () => call('POST', '/orders', userC, racing)));
  assert.ok(rs.every(x => [200, 201].includes(x.statusCode)), rs.map(x => `${x.statusCode}:${x.body.slice(0, 120)}`).join(' | '));
  assert.equal(new Set(rs.map(x => x.json().order.id)).size, 1);
  assert.equal((await counts()).orders, before.orders + 2);
  // someone else's key is refused
  assert.equal((await call('POST', '/orders', userB, body)).statusCode, 409);
  // saved profile data is used when the request leaves phone out and names a saved address
  const saved = profile.addresses[0];
  const { res: r2 } = await checkout(userC, { phone: undefined, address: undefined, addressId: saved.id });
  assert.equal(r2.statusCode, 201, r2.body);
  assert.equal((await row(r2.json().order.id)).phoneSnapshot, '+998935550101');
});

test('checkout: price change, unavailable product, closed restaurant, missing phone and spoofed fields are all refused with nothing created', async () => {
  const p = await product(20_000);
  const before = await counts();
  const stale = await checkout(userB, { expectedTotalSom: 39_000 }, p);
  assert.equal(stale.res.statusCode, 409);
  assert.equal(stale.res.json().error, 'NARX_OZGARGAN');
  assert.equal(stale.res.json().details.currentTotalSom, 40_000);
  const perLine = await checkout(userB, { expectedUnitPrices: { [p.id]: 19_000 } }, p);
  assert.equal(perLine.res.json().error, 'NARX_OZGARGAN');
  const off = await product(5_000, false);
  assert.equal((await checkout(userB, {}, off)).res.json().error, 'MAHSULOT_MAVJUD_EMAS');
  const foreign = await product(5_000, true, ids.b!);
  assert.equal((await checkout(userB, {}, foreign)).res.json().error, 'MAHSULOT_MAVJUD_EMAS');
  assert.equal((await checkout(userB, { restaurantId: ids.b }, foreign)).res.json().error, 'RESTORAN_BUYURTMA_QABUL_QILMAYDI', 'paused restaurant');
  const noPhoneUser = String(randomInt(800000000001, 899999999999));
  const np = await checkout(noPhoneUser, { phone: undefined }, p);
  assert.equal(np.res.statusCode, 400);
  assert.equal(np.res.json().error, 'PHONE_REQUIRED');
  for (const extra of [{ telegramUserId: userA }, { customerId: 'x' }, { paymentMode: 'MOCK' }, { totalSom: 1 }, { cardNumber: '8600123412341234' }]) {
    assert.equal((await checkout(userB, extra, p)).res.statusCode, 400, JSON.stringify(extra));
  }
  assert.equal((await checkout(userB, { address: undefined, addressId: undefined }, p)).res.statusCode, 400, 'an address is required');
  assert.equal((await checkout(userB, { addressId: 'a'.repeat(5), address: { addressText: 'both given' } }, p)).res.statusCode, 400, 'exactly one of addressId / address');
  // another customer's saved address cannot be used
  const mine = (await call('GET', '/me', userA)).json().addresses[0];
  const theft = await checkout(userB, { address: undefined, addressId: mine.id }, p);
  assert.equal(theft.res.statusCode, 404);
  // no bookable taxi company: the order would stall after payment, so it is refused up front
  const saved = process.env.TAXI_OPERATOR_ALLOWLIST;
  process.env.TAXI_OPERATOR_ALLOWLIST = '1';
  try { assert.equal((await checkout(userB, {}, p)).res.json().error, 'TAKSI_XIZMATI_MAVJUD_EMAS'); } finally { process.env.TAXI_OPERATOR_ALLOWLIST = saved; }
  // a refused checkout stores nothing about the customer either
  assert.deepEqual(await counts(), before);
  assert.equal((await db.customer.findUnique({ where: { telegramUserId: noPhoneUser } }))?.phone ?? null, null);
  await db.customer.deleteMany({ where: { telegramUserId: noPhoneUser } });
});

test('taxi choice: the customer picks one of the bookable services; unknown or unreachable ones are refused; the order keeps the choice and no silent fallback', async () => {
  const listed = (await call('GET', '/taxi-companies', userA)).json().companies as Array<{ id: string; name: string }>;
  assert.ok(listed.some(c => c.id === taxiId), 'a bookable service is offered');
  assert.deepEqual(Object.keys(listed[0]!).sort(), ['id', 'name'], 'names only: no operator ids or logins');

  const chosen = await checkout(userA, { taxiCompanyId: taxiId });
  assert.equal(chosen.res.statusCode, 201);
  const row = await db.order.findUniqueOrThrow({ where: { id: chosen.res.json().order.id } });
  assert.equal(row.taxiCompanyId, taxiId);
  assert.equal(row.allowTaxiFallback, false, 'a chosen service is the customer’s decision: no silent switch to another company');
  assert.equal(chosen.res.json().order.taxiCompanyName.startsWith('MP Taxi'), true, 'the order shows the chosen service before any dispatch exists');

  // no choice (older app): the server still assigns one and may fall back
  const auto = await checkout(userA);
  const autoRow = await db.order.findUniqueOrThrow({ where: { id: auto.res.json().order.id } });
  assert.equal(autoRow.allowTaxiFallback, true);

  // unknown id, and an inactive service, look the same: not bookable
  assert.equal((await checkout(userA, { taxiCompanyId: 'no-such-company' })).res.json().error, 'TAKSI_XIZMATI_MAVJUD_EMAS');
  const idle = await db.taxiCompany.create({ data: { name: `MP Idle ${randomUUID()}`, isActive: false, operatorTelegramUserId: String(randomInt(800000000001, 899999999999)) } });
  try {
    assert.equal((await checkout(userA, { taxiCompanyId: idle.id })).res.json().error, 'TAKSI_XIZMATI_MAVJUD_EMAS');
    assert.ok(!((await call('GET', '/taxi-companies', userA)).json().companies as Array<{ id: string }>).some(c => c.id === idle.id), 'not offered either');
  } finally { await db.taxiCompany.deleteMany({ where: { id: idle.id } }); }
  // a company with neither a linked operator nor an app login cannot receive a booking
  const unreachable = await db.taxiCompany.create({ data: { name: `MP Dead ${randomUUID()}`, isActive: true } });
  try { assert.equal((await checkout(userA, { taxiCompanyId: unreachable.id })).res.json().error, 'TAKSI_XIZMATI_MAVJUD_EMAS'); }
  finally { await db.taxiCompany.deleteMany({ where: { id: unreachable.id } }); }
});

test('payment instructions carry the window length (the screen says "within N minutes" and counts down to expiresAt)', async () => {
  const { res } = await checkout(userA);
  const view = res.json().order;
  const ins = view.payment?.instructions;
  if (ins) {
    assert.ok(Number.isInteger(ins.windowSeconds) && ins.windowSeconds > 0);
    assert.equal(ins.windowSeconds, Math.round((Date.parse(ins.expiresAt) - Date.parse((await db.payment.findFirstOrThrow({ where: { orderId: view.id } })).assignedAt!.toISOString())) / 1000));
  }
});

// ------------------------------------------------------------------------------------------------ tracking, payment boundaries, cancellation
test('tracking: owner only; real stages from the backend; MOCK payment starts cooking; the ETA and overdue come from the server clock', async () => {
  const { res } = await checkout(userA);
  const id = res.json().order.id as string;
  assert.equal((await call('GET', `/orders/${id}`, userB)).statusCode, 404, 'another customer cannot see it');
  assert.equal((await call('POST', `/orders/${id}/mock-payment`, userB)).statusCode, 404);
  assert.equal((await call('POST', `/orders/${id}/cancel`, userB, {})).statusCode, 404);
  assert.ok(!(await call('GET', '/orders', userB)).json().orders.some((o: { id: string }) => o.id === id));
  assert.ok((await call('GET', '/orders', userA)).json().orders.some((o: { id: string }) => o.id === id));

  const paid = (await call('POST', `/orders/${id}/mock-payment`, userA)).json().order;
  assert.equal(paid.status, 'PREPARING', 'MOCK payment is verified safely and cooking starts by itself');
  assert.equal(paid.stage, 'PREPARING');
  // owner decision 2026-10-27: the customer is told nothing about time, whatever the restaurant did (no countdown, no "being determined" state)
  assert.equal(paid.prep.chosenMinutes, 0, 'not null: an older screen would show its "aniqlanmoqda" banner');
  assert.equal(paid.prep.estimatedReadyAt, null);
  assert.equal(paid.prep.remainingSeconds, null);
  assert.equal(paid.prep.minutes, 0);
  assert.equal((await call('POST', `/orders/${id}/mock-payment`, userA)).statusCode, 409, 'no second payment');
  assert.equal(paid.payment.instructions, null, 'instructions disappear once paid');
  assert.equal((await call('GET', '/orders', userA)).json().orders.find((o: { id: string }) => o.id === id).prep.estimatedReadyAt, null, 'the list hides it too');
  // even when the restaurant side holds a time (older app) and the order runs late, the customer sees no countdown and no lateness
  await db.order.update({ where: { id }, data: { prepMinutes: 25, prepChosenMinutes: 25, prepChosenAt: new Date(), preparingStartedAt: new Date(Date.now() - 50 * 60_000) } });
  const late = (await call('GET', `/orders/${id}`, userA)).json().order;
  assert.equal(late.status, 'PREPARING');
  assert.equal(late.prep.estimatedReadyAt, null);
  assert.equal(late.prep.remainingSeconds, null);
  assert.equal(late.prep.isOverdue, false);
  assert.equal(late.prep.overdueMinutes, 0);
  assert.ok(Math.abs(new Date(late.serverNow).getTime() - Date.now()) < 5_000);

  // taxi stages are the real dispatch rows (scheduled by the cooking start)
  const d = await db.taxiDispatch.findFirstOrThrow({ where: { orderId: id } });
  const stageOf = async () => (await call('GET', `/orders/${id}`, userA)).json().order.stage;
  assert.equal(await stageOf(), 'PREPARING', 'a merely scheduled taxi is not shown as requested');
  await db.order.update({ where: { id }, data: { status: 'READY', readyAt: new Date() } });
  assert.equal(await stageOf(), 'READY');
  for (const [status, expected] of [['REQUESTED', 'TAXI_REQUESTED'], ['ACCEPTED', 'TAXI_ACCEPTED'], ['ASSIGNED', 'TAXI_SENT'], ['NEEDS_HELP', 'NEEDS_HELP']] as const) {
    await db.taxiDispatch.update({ where: { id: d.id }, data: { status } });
    assert.equal(await stageOf(), expected, status);
  }
  await db.taxiDispatch.update({ where: { id: d.id }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
  await db.order.update({ where: { id }, data: { status: 'COMPLETED' } });
  const done = (await call('GET', `/orders/${id}`, userA)).json().order;
  assert.equal(done.stage, 'DELIVERED');
  assert.ok(done.deliveredAt, 'delivered time is the operator-confirmed one');
  assert.equal(done.cancel.allowed, false);
});

test('payment boundaries: REAL shows only the configured payee and never the MOCK path; a Gmail signal never verifies', async () => {
  process.env.BOT_PAYMENT_MODE = 'REAL';
  try {
    assert.equal((await call('GET', '/config', userA)).json().mockPaymentAvailable, false);
    const { res } = await checkout(userA);
    assert.equal(res.statusCode, 201, res.body);
    const o = res.json().order;
    assert.equal(o.payment.mode, 'REAL');
    assert.equal(o.isTest, false);
    assert.equal(o.payment.instructions.isTest, false);
    assert.equal(o.payment.instructions.cardLast4, realLast4);
    assert.equal(o.payment.instructions.cardNumber, null, 'no configured payee number: nothing is invented');
    assert.equal(o.payment.instructions.recipientUnavailable, true, 'the customer is told NOT to pay');
    assert.equal((await call('POST', `/orders/${o.id}/mock-payment`, userA)).statusCode, 409, 'MOCK path is closed in REAL mode');
    process.env.BOT_REAL_CARD_NUMBERS_JSON = JSON.stringify({ [realLast4]: `860012341234${realLast4}` });
    const shown = (await call('GET', `/orders/${o.id}`, userA)).json().order.payment.instructions;
    assert.equal(shown.cardNumber, `860012341234${realLast4}`);
    assert.equal(shown.recipientUnavailable, false);
    process.env.BOT_REAL_CARD_NUMBERS_JSON = JSON.stringify({ [realLast4]: '8600000000000000' }); // inconsistent with the card: refused, not shown
    assert.equal((await call('GET', `/orders/${o.id}`, userA)).json().order.payment.instructions.cardNumber, null);
    // an e-mail signal moves it to "checking" only
    const pay = await db.payment.findFirstOrThrow({ where: { orderId: o.id } });
    await engine.ingestGmail(`mp-${randomUUID()}`, { cardLast4: realLast4, amountTiyin: pay.amountTiyin, occurredAt: new Date(), emailReceivedAt: new Date(), minutePrecision: false, trustedSender: true });
    const after = (await call('GET', `/orders/${o.id}`, userA)).json().order;
    assert.equal(after.status, 'PAYMENT_MATCHED_UNVERIFIED');
    assert.equal(after.stage, 'PAYMENT_CHECKING');
    const { autoAdvanceMockOrders } = await import('../modules/restaurant-orders/auto.js');
    await autoAdvanceMockOrders();
    assert.equal((await row(o.id)).status, 'PAYMENT_MATCHED_UNVERIFIED', 'no automation touches real money');
    // paid-order cancellation: a refund REQUEST, nothing marked sent, and no bank fields are accepted from the customer
    assert.equal((await call('POST', `/orders/${o.id}/cancel`, userA, { reasonCode: 'CHANGED_MIND', bankReference: 'TRX-1' })).statusCode, 400);
    assert.equal((await call('POST', `/orders/${o.id}/cancel`, userA, { cardNumber: '8600123412341234' })).statusCode, 400);
    const c = await call('POST', `/orders/${o.id}/cancel`, userA, { reasonCode: 'CHANGED_MIND' });
    assert.equal(c.statusCode, 200, c.body);
    assert.equal(c.json().order.stage, 'CANCELLATION_REQUESTED');
    assert.equal(c.json().order.refund.status, 'REQUESTED');
    const refund = await db.refundRequest.findFirstOrThrow({ where: { orderId: o.id } });
    assert.equal(refund.sentAt, null);
    assert.equal(refund.bankReference, null);
    assert.equal((await call('POST', `/orders/${o.id}/cancel`, userA, {})).statusCode, 409, 'cannot be requested twice as a new cancellation');
  } finally { delete process.env.BOT_PAYMENT_MODE; delete process.env.BOT_REAL_CARD_NUMBERS_JSON; }
});

test('refund receipt photo: only the order owner can see it, and only once the restaurant has sent the refund', async () => {
  const { decideRefund, markRefundSent, requestCancellation } = await import('../modules/refunds/service.js');
  const { storeReceipt } = await import('../modules/refunds/receipts.js');
  const { res } = await checkout(userC);
  const id = res.json().order.id as string;
  assert.equal((await call('POST', `/orders/${id}/mock-payment`, userC)).statusCode, 200);
  assert.equal((await call('GET', `/orders/${id}/refund/receipt`, userC)).statusCode, 404, 'no refund yet');
  const c = await call('POST', `/orders/${id}/cancel`, userC, { reasonCode: 'CHANGED_MIND' });
  assert.equal(c.statusCode, 200, c.body);
  const refund = await db.refundRequest.findFirstOrThrow({ where: { orderId: id } });
  assert.equal(c.json().order.refund.hasReceipt, false);
  assert.equal((await decideRefund({ actorTelegramId: 'restaurant-api:test', restaurantId: ids.a!, refundId: refund.id, decision: 'APPROVE' })).result, 'DONE');
  assert.equal((await call('GET', `/orders/${id}/refund/receipt`, userC)).statusCode, 404, 'approved is not sent: there is no receipt yet');
  const photo = fakeJpeg(4096);
  const stored = await storeReceipt(photo);
  assert.equal((await markRefundSent({ actorTelegramId: 'restaurant-api:test', restaurantId: ids.a!, refundId: refund.id, receipt: stored })).result, 'DONE');
  const view = (await call('GET', `/orders/${id}`, userC)).json().order;
  assert.deepEqual(view.refund, { status: 'SENT', hasReceipt: true });
  const got = await call('GET', `/orders/${id}/refund/receipt`, userC);
  assert.equal(got.statusCode, 200);
  assert.equal(got.json().mime, 'image/jpeg');
  assert.ok(Buffer.from(got.json().dataBase64, 'base64').equals(photo), 'the exact bytes the restaurant uploaded');
  assert.equal((await call('GET', `/orders/${id}/refund/receipt`, userB)).statusCode, 404, "another customer's order looks like a missing one");
  assert.equal((await call('GET', `/orders/${id}/refund/receipt`, null)).statusCode, 401);
  assert.equal((await call('GET', `/orders/${id}-nope/refund/receipt`, userC)).statusCode, 404);
  // the customer-facing view never exposes the storage key
  assert.ok(!JSON.stringify(view).includes(stored.key));
});

test('unpaid cancellation needs no refund and is idempotent', async () => {
  const { res } = await checkout(userA);
  const id = res.json().order.id as string;
  const first = await call('POST', `/orders/${id}/cancel`, userA, {});
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().order.stage, 'CANCELLED');
  assert.equal(await db.refundRequest.count({ where: { orderId: id } }), 0);
  assert.equal((await call('POST', `/orders/${id}/cancel`, userA, {})).statusCode, 200, 'repeat is harmless');
  assert.equal((await call('POST', `/orders/${id}/mock-payment`, userA)).statusCode, 409, 'a cancelled order cannot be paid');
});

// ------------------------------------------------------------------------------------------------ serving the app + the bot launcher
test('static hosting: SPA fallback, hashed assets cached, traversal and missing assets refused, CSP for Telegram only', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ds-miniapp-'));
  tmpDirs.push(dir);
  await mkdir(path.join(dir, 'assets'));
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>x</title>');
  await writeFile(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  await writeFile(path.join(os.tmpdir(), 'ds-secret.txt'), 'top secret');
  const web = Fastify();
  await registerMiniAppStatic(web, dir);
  try {
    const root = await web.inject({ method: 'GET', url: '/app/' });
    assert.equal(root.statusCode, 200);
    assert.match(String(root.headers['content-type']), /text\/html/);
    assert.match(String(root.headers['content-security-policy']), /frame-ancestors https:\/\/web\.telegram\.org/);
    assert.equal(root.headers['cache-control'], 'no-store');
    assert.equal((await web.inject({ method: 'GET', url: '/app/orders/123' })).statusCode, 200, 'client-side route -> index.html');
    const asset = await web.inject({ method: 'GET', url: '/app/assets/app-abc123.js' });
    assert.equal(asset.statusCode, 200);
    assert.match(String(asset.headers['cache-control']), /immutable/);
    assert.equal(asset.headers['x-content-type-options'], 'nosniff');
    assert.equal((await web.inject({ method: 'GET', url: '/app/assets/missing.js' })).statusCode, 404);
    for (const evil of ['/app/..%2f..%2fds-secret.txt', '/app/%2e%2e/%2e%2e/ds-secret.txt', '/app/assets/..%2f..%2f..%2fds-secret.txt', '/app/%00']) {
      const r = await web.inject({ method: 'GET', url: evil });
      assert.ok([400, 404].includes(r.statusCode) || !r.body.includes('top secret'), `${evil} -> ${r.statusCode}`);
      assert.ok(!r.body.includes('top secret'));
    }
    process.env.MINIAPP_ENABLED = 'false';
    try { assert.equal((await web.inject({ method: 'GET', url: '/app/' })).statusCode, 404); } finally { process.env.MINIAPP_ENABLED = 'true'; }
  } finally { await web.close(); await rm(path.join(os.tmpdir(), 'ds-secret.txt'), { force: true }); }
});

test('customer bot: /start opens the Mini App launcher; the old chat checkout can be switched off without losing order status', async () => {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const fake = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; });
    req.on('end', () => {
      const method = req.url!.split('/').pop()!;
      const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      const reply = (r: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, result: r })); };
      if (method === 'getMe') return reply({ id: 123456789, is_bot: true, first_name: 'T', username: 'fake_bot' });
      calls.push({ method, body });
      reply(method === 'sendMessage' ? { message_id: calls.length, date: 0, chat: { id: Number(body.chat_id), type: 'private' }, text: String(body.text ?? '') } : true);
    });
  });
  await new Promise<void>(r => fake.listen(0, '127.0.0.1', r));
  const apiRoot = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  try {
    const bot: Telegraf<any> = createClientBot(BOT_TOKEN, engine, { apiRoot });
    bot.botInfo = await bot.telegram.getMe();
    const from = { id: Number(userA), is_bot: false, first_name: 'T' };
    const chat = { id: Number(userA), type: 'private' as const, first_name: 'T' };
    let u = 1;
    const say = (text: string) => bot.handleUpdate({ update_id: u++, message: { message_id: u, date: 0, chat, from, text, ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }] } : {}) } } as never);
    const press = (data: string) => bot.handleUpdate({ update_id: u++, callback_query: { id: randomUUID(), from, chat_instance: 'c', data, message: { message_id: 1, date: 0, chat, text: 'x' } } } as never);
    const webAppButtons = () => calls.filter(c => JSON.stringify(c.body.reply_markup ?? '').includes('web_app'));

    await say('/start');
    assert.ok(webAppButtons().length >= 1, 'a Buyurtma berish WebApp button');
    assert.ok(JSON.stringify(webAppButtons()[0]!.body.reply_markup).includes('https://miniapp.example.test/app/'));
    assert.ok(calls.some(c => c.method === 'sendMessage' && String(c.body.text).toLowerCase().includes('restoran')), 'chat checkout still available (rollback flag default)');

    process.env.CHAT_CHECKOUT_ENABLED = 'false';
    calls.length = 0;
    await press('restaurants');
    await press('checkout:start');
    await say('/cart');
    assert.equal(calls.filter(c => c.method === 'sendMessage').length, 3, 'each old entry point answers with the launcher');
    assert.equal(webAppButtons().length, 3);
    // existing orders remain reachable
    calls.length = 0;
    await press('orders:list');
    assert.ok(calls.some(c => c.method === 'sendMessage'));
    assert.equal(webAppButtons().length, 0);
    // WebApp URL must be https
    process.env.MINIAPP_URL = 'http://localhost:5173/';
    calls.length = 0;
    await say('/app');
    assert.equal(webAppButtons().length, 0, 'plain http / localhost is never offered to Telegram');
  } finally {
    delete process.env.CHAT_CHECKOUT_ENABLED;
    process.env.MINIAPP_URL = 'https://miniapp.example.test/app/';
    await new Promise<void>(r => fake.close(() => r()));
  }
});
