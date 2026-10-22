import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { startRestaurantOrderNotifier } from '../bot/restaurant-notify.js';
import { signInitData } from '../modules/miniapp/auth.js';
import { bindFromBot, botDecision } from '../modules/miniapp/telegram-link.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { RateLimiter } from '../lib/rate-limit.js';
import { db as appDb } from '../lib/db.js';

// Customer Android MVP (guest session + optional Telegram link) against ds_delivery_test. Telegram is never contacted; the bot token is a
// fixture used only to sign test initData. MOCK payments only. Every row created here is deleted by id in after().
const BOT_TOKEN = '123456789:AAFakeGuestAndroidTokenLocalOnly_0123456789';
process.env.BOT_TOKEN = BOT_TOKEN;
process.env.MINIAPP_ENABLED = 'true';
process.env.ANDROID_GUEST_ENABLED = 'true';
process.env.BOT_USERNAME = 'ds_fake_bot';
process.env.MINIAPP_ORDER_RATE_PER_MINUTE = '500';
process.env.GUEST_BOOTSTRAP_PER_IP_HOUR = '1000';
delete process.env.BOT_PAYMENT_MODE;
delete process.env.RESTAURANT_MANUAL_ACCEPTANCE;
delete process.env.RESTAURANT_ACCEPTANCE_MOCK;

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const app = buildApp(engine);
const nonce = randomUUID().slice(0, 8);
const inst = () => `ga${nonce}-${randomUUID()}`; // every guest made here is found (and deleted) by this prefix
const tgNo = () => String(randomInt(1_000_000_000_000, 1_900_000_000_000));
const tgUsers: string[] = [];
const customerIds = new Set<string>();
const restaurantIds: string[] = [];
const cardLast4: string[] = [];
let restaurantId = '';

const tma = (userId: string) => `tma ${signInitData({
  auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAH',
  user: JSON.stringify({ id: Number(userId), first_name: 'Tg', last_name: 'User', username: 'tguser' }),
}, BOT_TOKEN)}`;
const bearer = (t: string) => `Bearer ${t}`;
const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, auth: string | null, payload?: unknown, server = app) =>
  server.inject({ method, url: `/api/v1/miniapp${url}`, payload: payload as object | undefined, headers: auth ? { authorization: auth } : {} });

async function newGuest(server = app): Promise<{ token: string; auth: string; id: string }> {
  const res = await call('POST', '/guest/session', null, { installationId: inst() }, server);
  assert.equal(res.statusCode, 201, res.body);
  const token = res.json().token as string;
  const g = await db.guestSession.findFirstOrThrow({ where: { tokenHash: (await import('../modules/miniapp/guest.js')).hashToken(token) } });
  customerIds.add(g.customerId);
  return { token, auth: bearer(token), id: g.customerId };
}
async function product(price = randomInt(10_000, 900_000)) {
  return db.product.create({ data: { restaurantId, name: `GA${randomUUID().slice(0, 6)}`, priceSom: price, isAvailable: true } });
}
async function checkout(auth: string, over: Record<string, unknown> = {}) {
  const prod = await product();
  const body = { checkoutKey: randomUUID(), restaurantId, items: [{ productId: prod.id, quantity: 2 }], expectedTotalSom: prod.priceSom * 2,
    address: { addressText: 'Chilonzor 7, 12-uy', save: true }, phone: '+998901234567', ...over };
  return { res: await call('POST', '/orders', auth, body), body, prod };
}
/** Drives the whole link flow for `guest` as Telegram user `tg` and returns the app-side confirm response. */
async function startLink(guest: { auth: string }, tg: string, name = 'Link User') {
  const created = await call('POST', '/me/telegram-link', guest.auth);
  assert.equal(created.statusCode, 200, created.body);
  const { id, deepLink } = created.json() as { id: string; deepLink: string };
  const raw = deepLink.split('?start=lnk_')[1]!;
  const bound = await bindFromBot(raw, { id: tg, name, username: 'linkuser' });
  assert.equal(bound.result, 'BOUND');
  return { id, raw, deepLink };
}

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  restaurantId = (await db.restaurant.create({ data: { slug: `ga-${nonce}`, name: `GA Resto ${nonce}`, pickupAddress: 'Pickup 1', pickupPhone: '+998900000001' } })).id;
  restaurantIds.push(restaurantId);
  for (const isTest of [false, true]) {
    for (;;) {
      const c = String(randomInt(1000, 9999));
      if (cardLast4.includes(c) || await db.card.findUnique({ where: { last4: c } })) continue;
      cardLast4.push(c); await engine.addCard(c, isTest, restaurantId);
      break;
    }
  }
});

after(async () => {
  for (const tg of tgUsers) { const c = await db.customer.findUnique({ where: { telegramUserId: tg }, select: { id: true } }); if (c) customerIds.add(c.id); }
  for (const s of await db.guestSession.findMany({ where: { installationId: { startsWith: `ga${nonce}` } }, select: { customerId: true } })) customerIds.add(s.customerId);
  const cids = [...customerIds];
  // customers merged into one of ours are ours too
  for (const c of await db.customer.findMany({ where: { mergedIntoId: { in: cids } }, select: { id: true } })) customerIds.add(c.id);
  const all = [...customerIds];
  const orders = (await db.order.findMany({ where: { OR: [{ customerId: { in: all } }, { restaurantId: { in: restaurantIds } }] }, select: { id: true } })).map(o => o.id);
  await db.notificationLog.deleteMany({ where: { orderId: { in: orders } } });
  await db.refundRequest.deleteMany({ where: { orderId: { in: orders } } });
  const pays = await db.payment.findMany({ where: { restaurantId: { in: restaurantIds } }, select: { id: true } });
  await db.incomingTransaction.deleteMany({ where: { OR: [{ matchedPaymentId: { in: pays.map(p => p.id) } }, { cardLast4: { in: cardLast4 } }] } });
  await db.taxiDispatch.deleteMany({ where: { orderId: { in: orders } } });
  await db.payment.deleteMany({ where: { id: { in: pays.map(p => p.id) } } });
  const cards = await db.card.findMany({ where: { restaurantId: { in: restaurantIds } }, select: { id: true } });
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards.map(c => c.id) } } });
  await db.card.deleteMany({ where: { restaurantId: { in: restaurantIds } } });
  await db.order.deleteMany({ where: { id: { in: orders } } });
  await db.telegramLinkAttempt.deleteMany({ where: { guestCustomerId: { in: all } } });
  await db.guestSession.deleteMany({ where: { customerId: { in: all } } });
  // merged guests reference their target: delete the referencing rows first
  await db.customer.updateMany({ where: { id: { in: all } }, data: { mergedIntoId: null } });
  await db.customer.deleteMany({ where: { id: { in: all } } }); // addresses cascade
  await db.product.deleteMany({ where: { restaurantId: { in: restaurantIds } } });
  await db.restaurant.deleteMany({ where: { id: { in: restaurantIds } } });
  await app.close();
  await db.$disconnect();
  await appDb.$disconnect();
});

// ------------------------------------------------------------------------------------------------ first launch, reopen, expiry, revocation
test('guest: first launch needs no login, the session is restored on reopen, and an installation id alone opens nothing', async () => {
  const g = await newGuest();
  const row = await db.customer.findUniqueOrThrow({ where: { id: g.id } });
  assert.equal(row.telegramUserId, null, 'no fake Telegram id');
  const me1 = (await call('GET', '/me', g.auth)).json();
  assert.equal(me1.telegramLinked, false);
  assert.equal((await call('PUT', '/me/phone', g.auth, { phone: '+998901112233' })).statusCode, 200);
  const me2 = (await call('GET', '/me', g.auth)).json(); // "reopen": the same stored credential
  assert.equal(me2.phone, '+998901112233');
  const stored = await db.guestSession.findFirstOrThrow({ where: { customerId: g.id } });
  assert.notEqual(stored.tokenHash, g.token, 'only a hash is stored');
  assert.ok(stored.installationId && stored.installationId.length >= 16);
  // knowing the installation id is not a credential
  assert.equal((await call('GET', '/me', stored.installationId)).statusCode, 401);
  assert.equal((await call('GET', '/me', bearer(stored.installationId!))).statusCode, 401);
  assert.equal((await call('GET', '/me', null)).statusCode, 401);
  assert.equal((await call('GET', '/me', bearer('dsg_' + 'A'.repeat(43)))).statusCode, 401, 'well-formed but unknown');
  // expiry and revocation
  await db.guestSession.update({ where: { id: stored.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await call('GET', '/me', g.auth)).statusCode, 401, 'expired');
  const g2 = await newGuest();
  assert.equal((await call('DELETE', '/guest/session', g2.auth)).statusCode, 204);
  assert.equal((await call('GET', '/me', g2.auth)).statusCode, 401, 'revoked');
});

test('guest: parallel first-launch bootstraps each get their own working profile; bootstrap is rate limited and can be switched off', async () => {
  const rs = await Promise.all(Array.from({ length: 8 }, () => call('POST', '/guest/session', null, { installationId: inst() })));
  assert.ok(rs.every(r => r.statusCode === 201));
  const tokens = rs.map(r => r.json().token as string);
  assert.equal(new Set(tokens).size, 8);
  for (const t of tokens) {
    const s = await db.guestSession.findFirstOrThrow({ where: { tokenHash: (await import('../modules/miniapp/guest.js')).hashToken(t) } });
    customerIds.add(s.customerId);
    assert.equal((await call('GET', '/me', bearer(t))).statusCode, 200);
  }
  // the same installation id cannot mint unlimited profiles
  const same = inst();
  const outcomes = [];
  for (let i = 0; i < 7; i++) outcomes.push((await call('POST', '/guest/session', null, { installationId: same })).statusCode);
  assert.deepEqual(outcomes.filter(x => x === 429).length, 2, outcomes.join(','));
  // per-IP cap (own app => own limiter)
  process.env.GUEST_BOOTSTRAP_PER_IP_HOUR = '2';
  const small = buildApp(engine);
  try {
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await call('POST', '/guest/session', null, { installationId: inst() }, small)).statusCode);
    assert.deepEqual(codes, [201, 201, 429, 429]);
  } finally { process.env.GUEST_BOOTSTRAP_PER_IP_HOUR = '1000'; await small.close(); }
  assert.equal((await call('POST', '/guest/session', null, { installationId: 'short' })).statusCode, 400);
  process.env.ANDROID_GUEST_ENABLED = 'false';
  try {
    assert.equal((await call('POST', '/guest/session', null, { installationId: inst() })).statusCode, 404);
    const g = await newGuestDirect();
    assert.equal((await call('GET', '/me', g)).statusCode, 404, 'guest sessions are not honoured while the feature is off');
  } finally { process.env.ANDROID_GUEST_ENABLED = 'true'; }
});
async function newGuestDirect(): Promise<string> {
  const { createGuest } = await import('../modules/miniapp/guest.js');
  const g = await createGuest(inst());
  customerIds.add(g.customerId);
  return bearer(g.token);
}

// ------------------------------------------------------------------------------------------------ auth separation (Telegram regression)
test('auth methods stay separate: Telegram initData still works, and a bad Telegram header never becomes a guest', async () => {
  const tg = tgNo(); tgUsers.push(tg);
  const good = await call('GET', '/me', tma(tg));
  assert.equal(good.statusCode, 200);
  assert.equal(good.json().telegramLinked, true);
  const tampered = tma(tg).replace(/hash=[0-9a-f]{4}/, 'hash=0000');
  assert.equal((await call('GET', '/me', tampered)).statusCode, 401);
  assert.equal((await call('GET', '/me', 'tma not-init-data')).statusCode, 401);
  const g = await newGuest();
  assert.equal((await call('GET', '/me', `tma ${g.token}`)).statusCode, 401, 'a guest token is not initData');
  assert.equal((await call('GET', '/me', bearer(tma(tg).slice(4)))).statusCode, 401, 'initData is not a guest token');
  // a Telegram caller cannot start a link and cannot revoke "a guest session"
  assert.equal((await call('POST', '/me/telegram-link', tma(tg))).statusCode, 403);
  assert.equal((await call('DELETE', '/guest/session', tma(tg))).statusCode, 403);
  // the platform is not a claim: a header like X-Platform changes nothing
  const spoof = await app.inject({ method: 'GET', url: '/api/v1/miniapp/me', headers: { 'x-platform': 'android', 'x-ds-platform': 'android' } });
  assert.equal(spoof.statusCode, 401);
});

// ------------------------------------------------------------------------------------------------ guest checkout
test('guest checkout: idempotent, requires phone, isolated from other guests and from Telegram customers', async () => {
  const a = await newGuest(); const b = await newGuest();
  const noPhone = await checkout(a.auth, { phone: undefined });
  assert.equal(noPhone.res.statusCode, 400);
  assert.equal(noPhone.res.json().error, 'PHONE_REQUIRED');
  const { res, body } = await checkout(a.auth);
  assert.equal(res.statusCode, 201, res.body);
  const order = res.json().order;
  const row = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(row.customerId, a.id);
  assert.equal(row.paymentIsTest, true, 'MOCK');
  assert.equal(await db.commissionEntry.count({ where: { orderId: order.id } }), 0, 'a MOCK order never accrues commission');
  const replay = await call('POST', '/orders', a.auth, body);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().order.id, order.id);
  const racing = { ...body, checkoutKey: randomUUID() };
  const rs = await Promise.all(Array.from({ length: 6 }, () => call('POST', '/orders', a.auth, racing)));
  assert.ok(rs.every(x => [200, 201].includes(x.statusCode)), rs.map(x => x.body).join('|'));
  assert.equal(new Set(rs.map(x => x.json().order.id)).size, 1);
  assert.equal(await db.order.count({ where: { customerId: a.id } }), 2);
  // server-side price check still applies
  const stale = await checkout(a.auth, { expectedTotalSom: 1 });
  assert.equal(stale.res.statusCode, 409);
  // isolation
  assert.equal((await call('GET', `/orders/${order.id}`, b.auth)).statusCode, 404);
  assert.deepEqual((await call('GET', '/orders', b.auth)).json().orders, []);
  assert.equal((await call('POST', '/orders', b.auth, body)).statusCode, 409, "another guest's checkout key is refused");
  assert.equal((await call('POST', `/orders/${order.id}/cancel`, b.auth)).statusCode, 404);
  assert.equal((await call('POST', `/orders/${order.id}/mock-payment`, b.auth)).statusCode, 404);
  const tg = tgNo(); tgUsers.push(tg);
  assert.equal((await call('GET', `/orders/${order.id}`, tma(tg))).statusCode, 404);
  const mine = (await call('GET', '/orders', a.auth)).json().orders;
  assert.equal(mine.length, 2);
  // saved address belongs to a only
  assert.ok((await call('GET', '/me/addresses', a.auth)).json().length >= 1);
  assert.equal((await call('GET', '/me/addresses', b.auth)).json().length, 0);
  const addrId = (await call('GET', '/me/addresses', a.auth)).json()[0].id;
  assert.equal((await call('DELETE', `/me/addresses/${addrId}`, b.auth)).statusCode, 404);
  // MOCK payment + guest cancel of an unpaid order
  const pay = await call('POST', `/orders/${order.id}/mock-payment`, a.auth);
  assert.equal(pay.statusCode, 200, pay.body);
  const second = await checkout(a.auth);
  assert.equal(second.res.statusCode, 201);
  const cancelled = await call('POST', `/orders/${second.res.json().order.id}/cancel`, a.auth, {});
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  const ev = await db.orderEvent.findFirstOrThrow({ where: { orderId: second.res.json().order.id, action: 'CANCEL_UNPAID' } });
  assert.equal(ev.actorTelegramId, `guest:${a.id}`);
});

test('notifications: an unlinked guest is never messaged, and its pending notice does not block the queue', async () => {
  const a = await newGuest();
  const { res } = await checkout(a.auth);
  const id = res.json().order.id as string;
  await db.order.update({ where: { id }, data: { status: 'READY' } });
  const sent: Array<unknown> = [];
  const fakeBot = { telegram: { sendMessage: async (chat: unknown) => { sent.push(chat); return { message_id: 1 }; } } };
  const stop = startRestaurantOrderNotifier(fakeBot as never);
  try {
    let marker: string | null = null;
    for (let i = 0; i < 40 && marker !== 'READY'; i++) {
      await new Promise(r => setTimeout(r, 250));
      marker = (await db.order.findUniqueOrThrow({ where: { id } })).customerLastNotifiedStatus;
    }
    assert.equal(marker, 'READY', 'the notice is settled, not retried forever');
    assert.ok(!sent.some(c => c === null || c === undefined || String(c).startsWith('guest')), 'nothing was sent to a null/guest recipient');
  } finally { stop(); }
});

// ------------------------------------------------------------------------------------------------ Telegram link
test('link: needs the bot owner AND the app owner; replay, wrong session, expiry and cancel are refused', async () => {
  const g = await newGuest(); const other = await newGuest();
  const tg = tgNo(); const evil = tgNo(); tgUsers.push(tg);
  const created = await call('POST', '/me/telegram-link', g.auth);
  assert.equal(created.statusCode, 200);
  const { id, deepLink } = created.json();
  assert.match(deepLink, /^https:\/\/t\.me\/ds_fake_bot\?start=lnk_[A-Za-z0-9_-]{32}$/);
  assert.ok(deepLink.split('start=')[1].length <= 64);
  assert.ok(!JSON.stringify(created.json()).includes(g.token), 'the session secret is never in the link');
  const raw = deepLink.split('start=lnk_')[1];
  // the app cannot finish before the Telegram side did
  assert.equal((await call('POST', `/me/telegram-link/${id}/confirm`, g.auth)).statusCode, 409);
  // another session / guest sees nothing
  assert.equal((await call('GET', `/me/telegram-link/${id}`, other.auth)).statusCode, 404);
  assert.equal((await call('POST', `/me/telegram-link/${id}/confirm`, other.auth)).statusCode, 404);
  assert.equal((await call('POST', `/me/telegram-link/${id}/cancel`, other.auth)).statusCode, 404);
  // a malformed or unknown token is refused; the first valid /start owns the attempt, a second Telegram user is a replay
  assert.equal((await bindFromBot('x'.repeat(32), { id: tg, name: 'A', username: null })).result, 'INVALID');
  assert.equal((await bindFromBot(raw, { id: tg, name: 'Real Owner', username: 'real' })).result, 'BOUND');
  assert.equal((await bindFromBot(raw, { id: evil, name: 'Evil', username: 'evil' })).result, 'INVALID');
  assert.equal((await bindFromBot(raw, { id: tg, name: 'Real Owner', username: 'real' })).result, 'BOUND', 'same user may reopen the prompt');
  assert.equal((await call('GET', `/me/telegram-link/${id}`, g.auth)).json().telegram, null, 'identity is not shown before the Telegram user confirmed');
  assert.equal((await call('POST', `/me/telegram-link/${id}/confirm`, g.auth)).statusCode, 409, 'bound but not confirmed in Telegram');
  assert.equal(await botDecision(id, evil, true), 'INVALID', 'only the bound Telegram user can confirm');
  assert.equal(await botDecision(id, tg, true), 'CONFIRMED');
  const st = (await call('GET', `/me/telegram-link/${id}`, g.auth)).json();
  assert.equal(st.status, 'BOT_CONFIRMED');
  assert.deepEqual(st.telegram, { name: 'Real Owner', username: 'real' });
  assert.equal(st.existingAccount, false);
  // app side declines: the link is dead for good
  assert.equal((await call('POST', `/me/telegram-link/${id}/cancel`, g.auth)).json().status, 'CANCELLED');
  assert.equal((await call('POST', `/me/telegram-link/${id}/confirm`, g.auth)).statusCode, 409);
  assert.equal(await botDecision(id, tg, true), 'INVALID');
  assert.equal((await db.customer.findUniqueOrThrow({ where: { id: g.id } })).telegramUserId, null);
  assert.equal(await db.customer.count({ where: { telegramUserId: tg } }), 0, 'nothing was created for the Telegram account');

  // expiry
  const l2 = await startLink(g, tg);
  await db.telegramLinkAttempt.update({ where: { id: l2.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await call('GET', `/me/telegram-link/${l2.id}`, g.auth)).json().status, 'EXPIRED');
  assert.equal(await botDecision(l2.id, tg, true), 'INVALID');
  assert.equal((await bindFromBot(l2.raw, { id: tg, name: 'A', username: null })).result, 'INVALID');
  // a new attempt supersedes the live one; only one live attempt per guest exists
  const l3 = await startLink(g, tg);
  const l4 = await call('POST', '/me/telegram-link', g.auth);
  assert.equal((await db.telegramLinkAttempt.findUniqueOrThrow({ where: { id: l3.id } })).status, 'CANCELLED');
  assert.equal(await db.telegramLinkAttempt.count({ where: { guestCustomerId: g.id, status: { in: ['CREATED', 'BOT_BOUND', 'BOT_CONFIRMED'] } } }), 1);
  assert.equal(l4.statusCode, 200);
});

test('link: a new Telegram account gets the guest profile; the old credential dies, a fresh one works, parallel confirms act once', async () => {
  const g = await newGuest();
  const { res } = await checkout(g.auth);
  const orderId = res.json().order.id as string;
  const tg = tgNo(); tgUsers.push(tg);
  const l = await startLink(g, tg, 'Fresh Person');
  assert.equal(await botDecision(l.id, tg, true), 'CONFIRMED');
  const results = await Promise.all(Array.from({ length: 5 }, () => call('POST', `/me/telegram-link/${l.id}/confirm`, g.auth)));
  const done = results.filter(r => r.statusCode === 200 && r.json().session);
  assert.equal(done.length, 1, results.map(r => `${r.statusCode}:${r.body.slice(0, 80)}`).join(' | '));
  assert.ok(results.every(r => [200, 401].includes(r.statusCode)));
  const fresh = bearer(done[0]!.json().session.token);
  assert.equal(done[0]!.json().merged, false);
  assert.equal((await call('GET', '/me', g.auth)).statusCode, 401, 'the old guest credential is revoked');
  const me = (await call('GET', '/me', fresh)).json();
  assert.equal(me.telegramLinked, true);
  assert.equal((await call('GET', `/orders/${orderId}`, fresh)).statusCode, 200, 'history kept');
  const cust = await db.customer.findUniqueOrThrow({ where: { id: g.id } });
  assert.equal(cust.telegramUserId, tg);
  assert.equal(cust.displayName, 'Fresh Person');
  // Telegram initData for that same user now reaches the same profile and orders
  assert.equal((await call('GET', `/orders/${orderId}`, tma(tg))).statusCode, 200);
  // replay of the same deep link does nothing
  assert.equal((await bindFromBot(l.raw, { id: tgNo(), name: 'Late', username: null })).result, 'INVALID');
  // a linked profile cannot start another link
  assert.equal((await call('POST', '/me/telegram-link', fresh)).statusCode, 409);
});

test('link: an existing Telegram account keeps its history; guest data moves once, nothing is duplicated', async () => {
  const tg = tgNo(); tgUsers.push(tg);
  // the Telegram customer already ordered and has an address and a phone
  const t1 = await checkout(tma(tg), { phone: '+998905550000', address: { addressText: 'Shared Street 1', label: 'Uy', save: true } });
  assert.equal(t1.res.statusCode, 201, t1.res.body);
  const tgCustomer = await db.customer.findUniqueOrThrow({ where: { telegramUserId: tg } });
  const g = await newGuest();
  await call('PUT', '/me/phone', g.auth, { phone: '+998906660000' });
  const g1 = await checkout(g.auth, { phone: '+998906660000', address: { addressText: '  shared   STREET 1 ', label: 'Dup', save: true } });
  const g2 = await checkout(g.auth, { phone: '+998906660000', address: { addressText: 'Guest Only 9', label: 'Ish', save: true } });
  assert.equal(g1.res.statusCode, 201); assert.equal(g2.res.statusCode, 201);
  const ids = [t1.res.json().order.id, g1.res.json().order.id, g2.res.json().order.id] as string[];
  const snapshot = async () => ({
    orders: await db.order.count({ where: { id: { in: ids } } }),
    payments: await db.payment.count({ where: { orderId: { in: ids } } }),
    commission: await db.commissionEntry.count({ where: { orderId: { in: ids } } }),
    tgCustomers: await db.customer.count({ where: { telegramUserId: tg } }),
  });
  const before = await snapshot();
  const l = await startLink(g, tg);
  assert.equal(await botDecision(l.id, tg, true), 'CONFIRMED');
  assert.equal((await call('GET', `/me/telegram-link/${l.id}`, g.auth)).json().existingAccount, true);
  const done = await call('POST', `/me/telegram-link/${l.id}/confirm`, g.auth);
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(done.json().merged, true);
  assert.deepEqual(await snapshot(), before, 'no order, payment or commission row was created or lost; still one Telegram customer');
  const fresh = bearer(done.json().session.token);
  const seen = (await call('GET', '/orders', fresh)).json().orders.map((o: { id: string }) => o.id).sort();
  assert.deepEqual(seen, [...ids].sort(), 'both histories visible');
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: g1.res.json().order.id } })).customerId, tgCustomer.id);
  const me = (await call('GET', '/me', fresh)).json();
  assert.equal(me.phone, '+998905550000', 'the Telegram profile wins phone conflicts');
  const texts = me.addresses.map((a: { addressText: string }) => a.addressText.toLowerCase().replace(/\s+/g, ' ').trim()).sort();
  assert.deepEqual(texts, ['guest only 9', 'shared street 1'], 'duplicate text collapsed, the other address moved');
  assert.equal(me.addresses.filter((a: { isDefault: boolean }) => a.isDefault).length, 1);
  const old = await db.customer.findUniqueOrThrow({ where: { id: g.id } });
  assert.equal(old.mergedIntoId, tgCustomer.id);
  assert.equal(old.telegramUserId, null);
  assert.equal((await call('GET', '/orders', g.auth)).statusCode, 401, 'old guest session gives no access');
  // idempotent: the same confirm again changes nothing, and Telegram initData sees the same
  assert.equal((await call('POST', `/me/telegram-link/${l.id}/confirm`, g.auth)).statusCode, 401);
  assert.deepEqual(await snapshot(), before);
  assert.equal((await call('GET', '/orders', tma(tg))).json().orders.length, 3);
  // a checkout retry with the guest's old key through the new session returns the existing order, not a new one
  const retry = await call('POST', '/orders', fresh, g1.body);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().order.id, g1.res.json().order.id);
});

test('link: two guests linking the same new Telegram account at once end in ONE customer holding both histories', async () => {
  const tg = tgNo(); tgUsers.push(tg);
  const a = await newGuest(); const b = await newGuest();
  const oa = (await checkout(a.auth)).res.json().order.id as string;
  const ob = (await checkout(b.auth)).res.json().order.id as string;
  const la = await startLink(a, tg); const lb = await startLink(b, tg);
  assert.equal(await botDecision(la.id, tg, true), 'CONFIRMED');
  assert.equal(await botDecision(lb.id, tg, true), 'CONFIRMED');
  const [ra, rb] = await Promise.all([call('POST', `/me/telegram-link/${la.id}/confirm`, a.auth), call('POST', `/me/telegram-link/${lb.id}/confirm`, b.auth)]);
  assert.equal(ra.statusCode, 200, ra.body); assert.equal(rb.statusCode, 200, rb.body);
  assert.equal(await db.customer.count({ where: { telegramUserId: tg } }), 1, 'no duplicate Telegram customer');
  const survivor = await db.customer.findUniqueOrThrow({ where: { telegramUserId: tg } });
  assert.equal(await db.order.count({ where: { id: { in: [oa, ob] }, customerId: survivor.id } }), 2);
  for (const r of [ra, rb]) {
    const orders = (await call('GET', '/orders', bearer(r.json().session.token))).json().orders;
    assert.equal(orders.length, 2);
  }
  assert.equal(ra.json().merged !== rb.json().merged, true, 'exactly one of them merged into the other');
});
