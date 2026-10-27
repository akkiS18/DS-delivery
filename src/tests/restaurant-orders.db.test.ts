import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { attemptKey, setRestaurantPassword } from '../modules/restaurant-auth/service.js';
import { placeOrder } from '../modules/orders/service.js';
import { takeStaffAction } from '../modules/restaurant/service.js';
import { db as appDb } from '../lib/db.js';
import { readdirSync } from 'node:fs';
import { fakeJpeg, fakePng, useTempReceiptDir } from './receipt-fixtures.js';

const receiptDir = useTempReceiptDir();
process.env.RESTAURANT_LOGIN_MAX_FAILURES = '50';
process.env.MAX_OPEN_UNPAID_ORDERS = '0'; // these suites keep many unpaid orders per customer; the cap is tested in checkout.stage6f
process.env.RESTAURANT_LOGIN_IP_MAX_FAILURES = '1000';

// Legacy accept-first flow (RESTAURANT_MANUAL_ACCEPTANCE) and legacy price-consent; the 6F default has its own suite.
process.env.RESTAURANT_MANUAL_ACCEPTANCE = 'true';
const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const app = buildApp(engine);
const nonce = randomUUID().slice(0, 8);
const slugA = `ord-a-${nonce}`;
const slugB = `ord-b-${nonce}`;
const PW_A = `Alpha-${randomUUID()}`;
const PW_B = `Bravo-${randomUUID()}`;
const staffA = String(randomInt(100000000000, 400000000000));
const customerTg = String(randomInt(700000000001, 900000000000));
const ids: Record<string, string> = {};
const ips: string[] = [];
const last4: string[] = [];
const productIds: string[] = [];
let taxiId = '';
let ta = '';
let tb = '';

const ip = () => { const v = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`; ips.push(v); return v; };
async function loginToken(slug: string, password: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/v1/restaurant/auth/login', payload: { slug, password }, remoteAddress: ip() });
  assert.equal(r.statusCode, 200);
  return r.json().accessToken;
}
const call = (method: 'GET' | 'POST', url: string, token: string | undefined, payload?: unknown) =>
  app.inject({ method, url: `/api/v1/restaurant${url}`, payload: payload as object | undefined, headers: token ? { authorization: `Bearer ${token}` } : {} });
/** The refund receipt is the raw request body (a photo), not JSON. */
const upload = (url: string, token: string | undefined, payload: Buffer, type = 'image/png') =>
  app.inject({ method: 'POST', url: `/api/v1/restaurant${url}`, payload, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': type } });
const storedFiles = () => readdirSync(receiptDir).filter(f => !f.startsWith('.'));
/** Every order gets its own price, so the single card per restaurant is never reused by two live payments. */
async function place(restaurant: 'a' | 'b' = 'a') {
  const rid = ids[restaurant]!;
  const productId = (await db.product.create({ data: { restaurantId: rid, name: `P${productIds.length}`, priceSom: randomInt(10_000, 900_000) } })).id;
  productIds.push(productId);
  return (await placeOrder(engine, {
    restaurantId: rid, telegramUserId: customerTg, customerName: 'Test', phone: '+998901234567', addressText: 'Test manzil',
    taxiCompanyId: taxiId, checkoutKey: randomUUID(), createdViaBot: true, paymentMode: 'REAL',
    items: [{ productId, quantity: 1 }],
  }))!;
}
const row = (id: string) => db.order.findUniqueOrThrow({ where: { id } });
const events = async (id: string) => (await db.orderEvent.findMany({ where: { orderId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(e => e.action);
const acceptApi = (id: string, body: object = { prepMinutes: 20 }, token = ta) => call('POST', `/orders/${id}/accept`, token, body);
async function matchPayment(orderId: string, card: string) {
  const p = await db.payment.findFirstOrThrow({ where: { orderId } });
  const r = await engine.ingestGmail(`ord-${randomUUID()}`, {
    cardLast4: card, amountTiyin: p.amountTiyin, occurredAt: new Date(), emailReceivedAt: new Date(), minutePrecision: false, trustedSender: true });
  assert.equal(r.status, 'MATCHED_UNVERIFIED');
}

before(async () => {
  await db.$connect();
  await db.platformSetting.upsert({ where: { key: 'taxi_dispatch_mode' }, create: { key: 'taxi_dispatch_mode', value: 'LEAD' }, update: { value: 'LEAD' } }); // these tests cover the timed (LEAD) dispatch
  ids.a = (await db.restaurant.create({ data: { slug: slugA, name: 'Ord A', staffTelegramUserId: staffA } })).id;
  ids.b = (await db.restaurant.create({ data: { slug: slugB, name: 'Ord B' } })).id;
  await setRestaurantPassword({ slug: slugA, password: PW_A });
  await setRestaurantPassword({ slug: slugB, password: PW_B });
  taxiId = (await db.taxiCompany.create({ data: { name: `Taxi ${randomUUID()}`, operatorTelegramUserId: String(randomInt(900000000001, 990000000000)), isActive: true } })).id;
  for (const k of ['a', 'b']) {
    for (;;) {
      const c = String(randomInt(1000, 9999));
      if (last4.includes(c) || await db.card.findUnique({ where: { last4: c } })) continue;
      last4.push(c); await engine.addCard(c, false, ids[k]!); break;
    }
  }
  ta = await loginToken(slugA, PW_A);
  tb = await loginToken(slugB, PW_B);
});
after(async () => {
  await db.platformSetting.deleteMany({ where: { key: 'taxi_dispatch_mode' } });
  const rids = Object.values(ids);
  const payIds = (await db.payment.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(p => p.id);
  await db.refundRequest.deleteMany({ where: { orderId: { in: (await db.order.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(o => o.id) } } });
  await db.incomingTransaction.deleteMany({ where: { OR: [{ matchedPaymentId: { in: payIds } }, { cardLast4: { in: last4 } }] } });
  await db.restaurantLoginAttempt.deleteMany({ where: { keyHash: { in: [slugA, slugB].map(s => attemptKey('slug', s)).concat(ips.map(i => attemptKey('ip', i))) } } });
  await db.taxiDispatch.deleteMany({ where: { order: { restaurantId: { in: rids } } } });
  await db.payment.deleteMany({ where: { id: { in: payIds } } });
  const cards = await db.card.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } });
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards.map(c => c.id) } } });
  await db.card.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.order.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.customer.deleteMany({ where: { telegramUserId: customerTg } });
  await db.product.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.restaurant.deleteMany({ where: { id: { in: rids } } });
  await db.taxiCompany.deleteMany({ where: { id: taxiId } });
  await app.close();
  await db.$disconnect();
  await appDb.$disconnect();
});

test('every order route requires a valid session', async () => {
  const o = await place();
  for (const [m, u, p] of [['GET', '/orders'], ['GET', `/orders/${o.id}`], ['POST', `/orders/${o.id}/accept`, { prepMinutes: 20 }],
    ['POST', `/orders/${o.id}/reject`, { reason: 'OTHER' }], ['POST', `/orders/${o.id}/preparing`, { prepMinutes: 20 }], ['POST', `/orders/${o.id}/ready`, {}]] as const) {
    assert.equal((await call(m, u, undefined, p)).statusCode, 401, `${m} ${u}`);
    assert.equal((await call(m, u, 'bad-token', p)).statusCode, 401, `${m} ${u}`);
  }
  assert.equal((await row(o.id)).status, 'WAITING_RESTAURANT');
});

test('list: pagination, filters, counts, and strict tenant isolation', async () => {
  const mine = [await place(), await place(), await place()];
  const other = await place('b');
  const p1 = (await call('GET', '/orders?filter=incoming&limit=2', ta)).json();
  assert.equal(p1.orders.length, 2);
  assert.ok(p1.nextCursor);
  const p2 = (await call('GET', `/orders?filter=incoming&limit=2&cursor=${p1.nextCursor}`, ta)).json();
  const seen = [...p1.orders, ...p2.orders].map((x: { id: string }) => x.id);
  assert.equal(new Set(seen).size, seen.length);
  assert.ok(p2.orders.every((x: { id: string }) => !p1.orders.some((y: { id: string }) => y.id === x.id)));
  assert.ok(Number.isNaN(Number(p1.nextCursor)), 'the cursor is opaque: it never carries an order number');
  const all = (await call('GET', '/orders?limit=50', ta)).json();
  assert.ok(all.orders.every((x: { id: string }) => x.id !== other.id));
  assert.ok(mine.every(m => all.orders.some((x: { id: string }) => x.id === m.id)));
  assert.ok(all.counts.incoming >= 3);
  const b = (await call('GET', '/orders?limit=50', tb)).json();
  assert.deepEqual(b.orders.map((x: { id: string }) => x.id), [other.id]);
  assert.equal((await call('GET', `/orders?restaurantId=${ids.b}`, ta)).statusCode, 400);
  assert.equal((await call('GET', '/orders?filter=bogus', ta)).statusCode, 400);
  assert.equal((await call('GET', '/orders?limit=1000', ta)).statusCode, 400);
  assert.equal((await call('GET', '/orders?filter=history', ta)).json().orders.some((x: { status: string }) => x.status === 'WAITING_RESTAURANT'), false);
});

test('work-queue tabs: a paid order cooking with no chosen time is "new"; once chosen it is "cooking"; unpaid ones only wait', async () => {
  const [fresh, chosen, unpaid, sameWaiting] = [await place(), await place(), await place(), await place()];
  const set = (id: string, data: object) => db.order.update({ where: { id }, data });
  await set(fresh.id, { status: 'PREPARING', preparingStartedAt: new Date() });
  await set(chosen.id, { status: 'PREPARING', preparingStartedAt: new Date(), prepChosenMinutes: 15 });
  await set(unpaid.id, { status: 'PAYMENT_PENDING' });
  await set(sameWaiting.id, { status: 'TAXI_REQUESTED' });
  const ids = async (filter: string) => (await call('GET', `/orders?filter=${filter}&limit=50`, ta)).json().orders.map((x: { id: string }) => x.id) as string[];
  const [isNew, cooking, waiting] = [await ids('new'), await ids('cooking'), await ids('waiting')];
  assert.ok(isNew.includes(fresh.id) && !isNew.includes(chosen.id) && !isNew.includes(unpaid.id));
  assert.ok(cooking.includes(chosen.id) && !cooking.includes(fresh.id));
  assert.ok(waiting.includes(unpaid.id) && waiting.includes(sameWaiting.id) && !waiting.includes(fresh.id) && !waiting.includes(chosen.id));
  // Each order is in exactly one tab, so nothing is listed twice and nothing falls between the tabs.
  const open = [fresh, chosen, unpaid, sameWaiting].map(o => o.id);
  for (const id of open) {
    const tabs = [isNew, cooking, waiting, await ids('ready'), await ids('history')].filter(t => t.includes(id)).length;
    assert.equal(tabs, 1, id);
  }
  // Counts match the tabs, and paging inside a tab (both the tab filter and the cursor use OR) neither repeats nor skips rows.
  const counts = (await call('GET', '/orders?limit=1', ta)).json().counts;
  assert.equal(counts.new, (await ids('new')).length);
  assert.equal(counts.cooking, cooking.length);
  assert.equal(counts.waiting, waiting.length);
  const seen: string[] = [];
  for (let cursor = '', i = 0; i < 20; i++) {
    const page = (await call('GET', `/orders?filter=new&limit=1${cursor}`, ta)).json();
    seen.push(...page.orders.map((x: { id: string }) => x.id));
    if (!page.nextCursor) break;
    cursor = `&cursor=${page.nextCursor}`;
  }
  assert.deepEqual(seen, isNew);
  // The attention list is the same rule as the attention count (a cancellation request is in `waiting` AND needs a human).
  await set(sameWaiting.id, { status: 'CANCELLATION_REQUESTED' });
  assert.ok((await ids('attention')).includes(sameWaiting.id));
  assert.equal((await call('GET', '/orders?limit=1', ta)).json().counts.attention, (await ids('attention')).length);
});

test("detail exposes payment/taxi/actions and never another restaurant's order or internal ids", async () => {
  const o = await place();
  const d = (await call('GET', `/orders/${o.id}`, ta)).json();
  assert.equal(d.status, 'WAITING_RESTAURANT');
  assert.equal(d.payment, null);
  assert.equal(d.customerPhone, '+998901234567');
  assert.deepEqual(d.allowedActions, ['ACCEPT', 'REJECT']);
  assert.ok(!JSON.stringify(d).includes(customerTg));
  assert.equal((await call('GET', `/orders/${o.id}`, tb)).statusCode, 404);
});

test('accept: strict body, tenant-scoped, exactly-once, creates one payment, audited as the app actor', async () => {
  const o = await place();
  assert.equal((await acceptApi(o.id, { prepMinutes: 4 })).statusCode, 400); // below the 5 minute minimum
  assert.equal((await acceptApi(o.id, { prepMinutes: 121 })).statusCode, 400);
  assert.equal((await acceptApi(o.id, { prepMinutes: 20, restaurantId: ids.b })).statusCode, 400);
  assert.equal((await acceptApi(o.id, { prepMinutes: 'x' }, ta)).statusCode, 400);
  assert.equal((await acceptApi(o.id, { prepMinutes: 20 }, tb)).statusCode, 404); // foreign order looks missing
  assert.equal((await row(o.id)).status, 'WAITING_RESTAURANT');
  assert.equal((await acceptApi(o.id, { prepMinutes: 20, expectedStatus: 'PREPARING' })).statusCode, 409); // stale UI
  const rs = await Promise.all(Array.from({ length: 5 }, () => acceptApi(o.id)));
  assert.equal(rs.filter(r => r.statusCode === 200).length, 1);
  assert.equal(rs.filter(r => r.statusCode === 409 && r.json().error === 'STALE').length, 4);
  const r = await row(o.id);
  assert.equal(r.status, 'PAYMENT_PENDING');
  assert.equal(r.acceptedBy, `restaurant-api:${ids.a}`);
  assert.equal(r.estimatedPrepMinutes, 20);
  assert.equal(await db.payment.count({ where: { orderId: o.id } }), 1);
  assert.deepEqual(await events(o.id), ['PLACED', 'ACCEPT']);
  const again = await acceptApi(o.id);
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().status, 'PAYMENT_PENDING');
  const d = (await call('GET', `/orders/${o.id}`, ta)).json();
  assert.equal(d.payment.status, 'AWAITING');
  assert.deepEqual(d.allowedActions, []);
});

test('reject: valid reasons only, foreign order untouched, exactly once, no payment ever created', async () => {
  const o = await place();
  assert.equal((await call('POST', `/orders/${o.id}/reject`, ta, { reason: 'NOPE' })).statusCode, 400);
  assert.equal((await call('POST', `/orders/${o.id}/reject`, tb, { reason: 'OTHER' })).statusCode, 404);
  const rs = await Promise.all([1, 2, 3].map(() => call('POST', `/orders/${o.id}/reject`, ta, { reason: 'UNAVAILABLE' })));
  assert.equal(rs.filter(r => r.statusCode === 200).length, 1);
  const r = await row(o.id);
  assert.equal(r.status, 'RESTAURANT_REJECTED');
  assert.equal(r.rejectReason, 'UNAVAILABLE');
  assert.equal(r.rejectedBy, `restaurant-api:${ids.a}`);
  assert.equal(await db.payment.count({ where: { orderId: o.id } }), 0);
  assert.equal((await acceptApi(o.id)).statusCode, 409); // cannot resurrect a rejected order
  assert.equal(r.customerLastNotifiedStatus, null); // the existing notifier tells the customer
});

test('real payment: a Gmail match never verifies; the app verifies only with an explicit confirmation and tenant scope', async () => {
  const o = await place();
  assert.equal((await call('POST', `/orders/${o.id}/preparing`, ta, { prepMinutes: 20 })).statusCode, 409); // unaccepted
  assert.equal((await acceptApi(o.id)).statusCode, 200);
  assert.equal((await call('POST', `/orders/${o.id}/preparing`, ta, { prepMinutes: 20 })).statusCode, 409); // unpaid
  assert.equal((await call('POST', `/orders/${o.id}/ready`, ta, {})).statusCode, 409);
  assert.equal((await call('POST', `/orders/${o.id}/verify-payment`, ta, { confirmReceived: true })).statusCode, 409); // nothing matched yet
  await matchPayment(o.id, last4[0]!);
  const matched = (await call('GET', `/orders/${o.id}`, ta)).json();
  assert.equal(matched.status, 'PAYMENT_MATCHED_UNVERIFIED');
  assert.equal(matched.awaitingPaymentVerification, true);
  assert.deepEqual(matched.allowedActions, ['VERIFY_PAYMENT']);
  assert.ok(matched.attention.includes('VERIFY_PAYMENT'));
  assert.equal(matched.paymentEvidence.notBankProof, true, 'a Gmail signal is labelled as not being bank proof');
  assert.equal(matched.paymentEvidence.signal.amountMatches, true);
  assert.equal(matched.paymentEvidence.expectedAmountSom, matched.payment.amountSom);
  // the automation never confirms real money: the sweep leaves it alone
  const { autoAdvanceMockOrders } = await import('../modules/restaurant-orders/auto.js');
  await autoAdvanceMockOrders();
  assert.equal((await row(o.id)).status, 'PAYMENT_MATCHED_UNVERIFIED');
  await assert.rejects(takeStaffAction({ actorSystemId: 'mock-auto', orderId: o.id, action: 'VERIFY_PAYMENT' }), /RUXSAT_YOQ/);
  assert.equal((await call('POST', `/orders/${o.id}/preparing`, ta, { prepMinutes: 20 })).statusCode, 409); // Gmail is only a signal
  // explicit confirmation is mandatory, the restaurant id is not client-selectable, another restaurant sees nothing
  for (const body of [{}, { confirmReceived: false }, { confirmReceived: 'yes' }, { confirmReceived: true, restaurantId: ids.b }]) {
    assert.equal((await call('POST', `/orders/${o.id}/verify-payment`, ta, body)).statusCode, 400, JSON.stringify(body));
  }
  assert.equal((await call('POST', `/orders/${o.id}/verify-payment`, tb, { confirmReceived: true })).statusCode, 404);
  assert.equal((await row(o.id)).status, 'PAYMENT_MATCHED_UNVERIFIED');
  // verification: once, audited as the app, and cooking then starts by itself with the accepted preparation time
  const rs = await Promise.all([1, 2, 3].map(() => call('POST', `/orders/${o.id}/verify-payment`, ta, { confirmReceived: true })));
  assert.equal(rs.filter(r => r.statusCode === 200).length, 1);
  const r = await row(o.id);
  assert.equal(r.status, 'PREPARING');
  assert.equal(r.prepMinutes, 20);
  assert.equal(r.paymentVerifiedBy, `restaurant-api:${ids.a}`);
  assert.equal((await db.payment.findFirstOrThrow({ where: { orderId: o.id } })).status, 'CONFIRMED_MANUAL');
  const ev = await db.orderEvent.findFirstOrThrow({ where: { orderId: o.id, action: 'VERIFY_PAYMENT' } });
  assert.equal((ev.details as { channel: string }).channel, 'APP');
  assert.deepEqual((await events(o.id)).slice(-2), ['VERIFY_PAYMENT', 'START_PREPARING']);
  assert.equal((await call('GET', `/orders/${o.id}`, ta)).json().allowedActions.includes('MARK_READY'), true, 'READY stays a manual restaurant action');
  assert.equal((await row(o.id)).readyAt, null);
});

test('default preparation time: asked once at acceptance, defaulted from the restaurant, overridable', async () => {
  await db.restaurant.update({ where: { id: ids.a! }, data: { defaultPrepMinutes: 35 } });
  try {
    const o = await place();
    const acc = await acceptApi(o.id, {});
    assert.equal(acc.statusCode, 200);
    assert.equal((await row(o.id)).estimatedPrepMinutes, 35);
    assert.equal(acc.json().defaultPrepMinutes, 35);
    const o2 = await place();
    assert.equal((await acceptApi(o2.id, { prepMinutes: 50 })).statusCode, 200); // explicit override
    assert.equal((await row(o2.id)).estimatedPrepMinutes, 50);
    await matchPayment(o2.id, last4[0]!);
    assert.equal((await call('POST', `/orders/${o2.id}/verify-payment`, ta, { confirmReceived: true })).statusCode, 200);
    assert.equal((await row(o2.id)).prepMinutes, 50, 'no second prep question: the accepted value is reused');
  } finally { await db.restaurant.update({ where: { id: ids.a! }, data: { defaultPrepMinutes: 25 } }); }
});

test('after the Telegram staff verification: preparing then ready, once each, state shared with Telegram', async () => {
  const o = await place();
  assert.equal((await acceptApi(o.id)).statusCode, 200);
  await matchPayment(o.id, last4[0]!);
  await takeStaffAction({ actorTelegramId: staffA, orderId: o.id, action: 'VERIFY_PAYMENT' });
  const confirmed = (await call('GET', `/orders/${o.id}`, ta)).json();
  assert.equal(confirmed.status, 'PAYMENT_CONFIRMED');
  assert.deepEqual(confirmed.allowedActions, ['START_PREPARING', 'CANCEL_ORDER']);
  assert.ok(confirmed.attention.includes('AUTO_START_FAILED'), 'a confirmed order that did not start is an exception');
  assert.equal((await call('POST', `/orders/${o.id}/preparing`, ta, { prepMinutes: 3 })).statusCode, 400);
  assert.equal((await call('POST', `/orders/${o.id}/preparing`, tb, { prepMinutes: 20 })).statusCode, 404);
  assert.equal((await call('POST', `/orders/${o.id}/ready`, ta, {})).statusCode, 409); // not preparing yet
  const rs = await Promise.all([1, 2, 3].map(() => call('POST', `/orders/${o.id}/preparing`, ta, { prepMinutes: 20 })));
  assert.equal(rs.filter(r => r.statusCode === 200).length, 1);
  const p = await row(o.id);
  assert.equal(p.status, 'PREPARING');
  assert.equal(p.prepMinutes, 20);
  assert.equal(await db.taxiDispatch.count({ where: { orderId: o.id } }), 1); // scheduled only, nothing sent
  assert.equal((await db.taxiDispatch.findFirstOrThrow({ where: { orderId: o.id } })).status, 'SCHEDULED');
  const ready = await Promise.all([1, 2, 3].map(() => call('POST', `/orders/${o.id}/ready`, ta, {})));
  assert.equal(ready.filter(r => r.statusCode === 200).length, 3, 'READY is idempotent: a double tap / retry is a success, not an error');
  assert.equal(await db.orderEvent.count({ where: { orderId: o.id, action: 'MARK_READY' } }), 1, 'but it is recorded exactly once');
  const r = await row(o.id);
  assert.equal(r.status, 'READY');
  assert.ok(r.readyAt);
  assert.equal(r.staffLastNotifiedStatus, 'PAYMENT_CONFIRMED'); // app actions leave the Telegram notice pending
  assert.deepEqual(await events(o.id), ['PLACED', 'ACCEPT', 'VERIFY_PAYMENT', 'START_PREPARING', 'MARK_READY']);
});

test('prep time after the payment: "ready in N minutes" (5..60) counted from now, audited, moves an unsent taxi dispatch, only while cooking', async () => {
  const o = await place();
  assert.equal((await acceptApi(o.id)).statusCode, 200);
  assert.equal((await call('POST', `/orders/${o.id}/prep-time`, ta, { minutes: 30 })).statusCode, 409, 'not cooking yet');
  await matchPayment(o.id, last4[0]!);
  assert.equal((await call('POST', `/orders/${o.id}/verify-payment`, ta, { confirmReceived: true })).statusCode, 200);
  const cooking = await row(o.id);
  assert.equal(cooking.status, 'PREPARING');
  assert.equal(cooking.prepChosenMinutes, null, 'nothing chosen yet: the app asks');
  assert.equal((await call('GET', `/orders/${o.id}`, ta)).json().prep.chosenMinutes, null);
  assert.ok((await call('GET', `/orders/${o.id}`, ta)).json().allowedActions.includes('SET_PREP_TIME'));

  // cooking started 3 minutes ago: "ready in 30" means 30 minutes from now = 33 on the cooking clock
  const startedAt = new Date(Date.now() - 3 * 60_000);
  await db.order.update({ where: { id: o.id }, data: { preparingStartedAt: startedAt } });

  for (const bad of [{ minutes: 4 }, { minutes: 61 }, { minutes: 12.5 }, { minutes: '30' }, { minutes: 30, restaurantId: ids.b }]) {
    assert.equal((await call('POST', `/orders/${o.id}/prep-time`, ta, bad)).statusCode, 400, JSON.stringify(bad));
  }
  assert.equal((await call('POST', `/orders/${o.id}/prep-time`, tb, { minutes: 30 })).statusCode, 404, 'another restaurant sees nothing');
  assert.equal((await call('POST', `/orders/${o.id}/prep-time`, undefined, { minutes: 30 })).statusCode, 401);
  assert.equal((await call('POST', `/orders/${o.id}/prep-time`, ta, { minutes: 30, expectedStatus: 'READY' })).statusCode, 409, 'stale view');

  const ok = await call('POST', `/orders/${o.id}/prep-time`, ta, { minutes: 30 });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().prep.chosenMinutes, 30);
  assert.equal(ok.json().prep.minutes, 33);
  const r = await row(o.id);
  assert.equal(r.prepMinutes, 33);
  assert.equal(r.prepChosenMinutes, 30);
  assert.ok(r.prepChosenAt);
  assert.equal(r.status, 'PREPARING');
  assert.equal(r.preparingStartedAt?.getTime(), startedAt.getTime(), 'the cooking start is history and is never rewritten');
  const ev = await db.orderEvent.findFirstOrThrow({ where: { orderId: o.id, action: 'PREP_TIME_SET' } });
  assert.deepEqual(ev.details, { minutes: 30, elapsedMinutes: 3, totalMinutes: 33, previousTotalMinutes: 20 });
  assert.equal(ev.actorTelegramId, `restaurant-api:${ids.a}`);
  // the unsent taxi dispatch follows the new time (LEAD mode: prep 33 minus the lead)
  const dispatch = await db.taxiDispatch.findFirstOrThrow({ where: { orderId: o.id } });
  assert.equal(dispatch.status, 'SCHEDULED');
  assert.equal(dispatch.dueAt.getTime(), startedAt.getTime() + (33 - Number(process.env.TAXI_LEAD_MINUTES ?? 4)) * 60_000);

  // changing it again is allowed and audited each time; a dispatch that was already claimed is left alone
  await db.taxiDispatch.update({ where: { id: dispatch.id }, data: { status: 'SENDING' } });
  assert.equal((await call('POST', `/orders/${o.id}/prep-time`, ta, { minutes: 10 })).statusCode, 200);
  assert.equal((await row(o.id)).prepChosenMinutes, 10);
  assert.equal((await db.taxiDispatch.findUniqueOrThrow({ where: { id: dispatch.id } })).dueAt.getTime(), dispatch.dueAt.getTime());
  assert.equal(await db.orderEvent.count({ where: { orderId: o.id, action: 'PREP_TIME_SET' } }), 2);

  // once ready there is nothing left to promise
  assert.equal((await call('POST', `/orders/${o.id}/ready`, ta, {})).statusCode, 200);
  assert.equal((await call('POST', `/orders/${o.id}/prep-time`, ta, { minutes: 15 })).statusCode, 409);
  assert.equal((await row(o.id)).prepChosenMinutes, 10);
});

test('acknowledging a paid order needs no time (2026-10-27): the same tap silences the bell, moves it to cooking and records the restaurant default', async () => {
  const o = await place();
  assert.equal((await acceptApi(o.id)).statusCode, 200);
  await matchPayment(o.id, last4[0]!);
  assert.equal((await call('POST', `/orders/${o.id}/verify-payment`, ta, { confirmReceived: true })).statusCode, 200);
  assert.equal((await row(o.id)).prepChosenMinutes, null);
  assert.equal((await call('GET', '/orders?filter=new', ta)).json().orders.some((x: { id: string }) => x.id === o.id), true, 'waiting for the kitchen: it rings');
  const ok = await call('POST', `/orders/${o.id}/prep-time`, ta, {});
  assert.equal(ok.statusCode, 200, ok.body);
  const r = await row(o.id);
  assert.ok(r.prepChosenMinutes && r.prepChosenMinutes >= 5 && r.prepChosenMinutes <= 60, 'the hidden restaurant default, clamped');
  assert.ok(r.prepChosenAt);
  assert.equal((await call('GET', '/orders?filter=new', ta)).json().orders.some((x: { id: string }) => x.id === o.id), false, 'acknowledged: no longer new');
  assert.equal((await call('GET', '/orders?filter=cooking', ta)).json().orders.some((x: { id: string }) => x.id === o.id), true);
  assert.equal((await call('POST', `/orders/${o.id}/prep-time`, tb, {})).statusCode, 404, 'another restaurant sees nothing');
  assert.equal((await call('POST', `/orders/${o.id}/ready`, ta, {})).statusCode, 200);
});

test('a paused restaurant cannot accept new orders from the app either', async () => {
  const o = await place();
  await db.restaurant.update({ where: { id: ids.a! }, data: { isPaused: true } });
  try {
    const r = await acceptApi(o.id);
    assert.equal(r.statusCode, 409);
    assert.equal(r.json().error, 'RESTAURANT_CLOSED');
    assert.equal((await row(o.id)).status, 'WAITING_RESTAURANT');
    assert.equal(await db.payment.count({ where: { orderId: o.id } }), 0);
  } finally {
    await db.restaurant.update({ where: { id: ids.a! }, data: { isPaused: false } });
  }
});

test('a stale price can only be rejected: no accept, no re-pricing, no propose route', async () => {
  const o = await place();
  const item = await db.orderItem.findFirstOrThrow({ where: { orderId: o.id } });
  await db.product.update({ where: { id: item.productId! }, data: { priceSom: { increment: 1000 } } });
  const d = (await call('GET', `/orders/${o.id}`, ta)).json();
  assert.ok(d.menuProblems.some((m: { kind: string }) => m.kind === 'PRICE_CHANGED'));
  assert.equal(d.priceChange, undefined);
  assert.equal(d.priceProposal, undefined);
  assert.deepEqual(d.allowedActions, ['REJECT'], 'no accept, no propose');
  const blocked = await acceptApi(o.id);
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().error, 'ORDER_PROBLEMS');
  assert.equal((await call('POST', `/orders/${o.id}/propose-price`, ta, {})).statusCode, 404, 'the propose route no longer exists');
  assert.equal((await row(o.id)).status, 'WAITING_RESTAURANT');
  assert.equal(await db.orderPriceRevision.count({ where: { orderId: o.id } }), 0);
  assert.equal((await call('POST', `/orders/${o.id}/reject`, ta, { reason: 'PRICE_CHANGED' })).statusCode, 200);
});

test('restaurant cancellation and refund handling work from the app, tenant-scoped and audited', async () => {
  const o = await place();
  assert.equal((await acceptApi(o.id)).statusCode, 200);
  await matchPayment(o.id, last4[0]!);
  assert.equal((await call('POST', `/orders/${o.id}/verify-payment`, ta, { confirmReceived: true })).statusCode, 200);
  assert.equal((await call('POST', `/orders/${o.id}/cancel`, ta, { reason: 'NOPE' })).statusCode, 400);
  assert.equal((await call('POST', `/orders/${o.id}/cancel`, tb, { reason: 'CLOSED' })).statusCode, 404);
  const c = await call('POST', `/orders/${o.id}/cancel`, ta, { reason: 'OUT_OF_STOCK' });
  assert.equal(c.statusCode, 200);
  assert.equal(c.json().status, 'CANCELLED');
  assert.equal(c.json().refund.status, 'APPROVED');
  assert.deepEqual(c.json().allowedActions, ['REFUND_SENT']);
  assert.equal((await call('POST', `/orders/${o.id}/cancel`, ta, { reason: 'CLOSED' })).statusCode, 409);
  // "Qaytarildi" asks for ONE photo of the bank receipt - nothing typed. The old JSON route is gone.
  assert.equal((await call('POST', `/orders/${o.id}/refund/sent`, ta, { bankReference: 'TRX-1234-5678' })).statusCode, 404);
  assert.equal((await upload(`/orders/${o.id}/refund/receipt`, undefined, fakePng())).statusCode, 401, 'authentication happens before the body is read');
  const before = storedFiles().length;
  for (const [bytes, type] of [[Buffer.alloc(3000), 'image/png'], [Buffer.from('%PDF-1.4 ' + 'x'.repeat(3000)), 'image/jpeg'], [fakePng(100).subarray(0, 500), 'image/png']] as const) {
    const bad = await upload(`/orders/${o.id}/refund/receipt`, ta, bytes, type);
    assert.equal(bad.statusCode, 400, 'only real JPEG/PNG/WebP photos are accepted (magic bytes, size >= 1 KB)');
    assert.equal(bad.json().error, 'CHEK_RASMI_NOTOGRI');
  }
  assert.equal((await call('POST', `/orders/${o.id}/refund/receipt`, ta, { bankReference: 'TRX-1234-5678' })).statusCode, 400, 'a JSON body is not a receipt');
  assert.equal((await upload(`/orders/${o.id}/refund/receipt`, ta, Buffer.concat([fakePng(), Buffer.alloc(5 * 1024 * 1024)]))).statusCode, 413, 'bigger than 5 MB');
  assert.equal((await upload(`/orders/${o.id}/refund/receipt`, tb, fakePng())).statusCode, 404, "another restaurant's order is just not found");
  assert.equal(storedFiles().length, before, 'a refused upload leaves no file behind');
  const photo = fakeJpeg();
  const sent = await upload(`/orders/${o.id}/refund/receipt`, ta, photo, 'image/jpeg');
  assert.equal(sent.statusCode, 200);
  assert.equal(sent.json().refund.status, 'SENT', 'a restaurant claim, never a settlement');
  assert.equal(sent.json().refund.hasReceipt, true);
  assert.equal(sent.json().refund.bankReference, null, 'no typed reference is asked for any more');
  assert.equal(storedFiles().length, before + 1);
  const stored = await db.refundRequest.findFirstOrThrow({ where: { orderId: o.id } });
  assert.equal(stored.receiptMime, 'image/jpeg', 'the type comes from the bytes');
  assert.equal(stored.receiptBytes, photo.length);
  assert.equal((await upload(`/orders/${o.id}/refund/receipt`, ta, fakePng())).statusCode, 409, 'already SENT: a second photo is refused');
  assert.equal(storedFiles().length, before + 1, 'and its file is removed again');
  // customer-initiated request: approve / reject from the app
  const o2 = await place();
  assert.equal((await acceptApi(o2.id)).statusCode, 200);
  await matchPayment(o2.id, last4[0]!);
  await call('POST', `/orders/${o2.id}/verify-payment`, ta, { confirmReceived: true });
  const { requestCancellation } = await import('../modules/refunds/service.js');
  assert.equal((await requestCancellation({ actorType: 'CUSTOMER', actorTelegramId: customerTg, orderId: o2.id, reasonCode: 'CHANGED_MIND' })).result, 'REQUESTED');
  const pending = (await call('GET', `/orders/${o2.id}`, ta)).json();
  assert.equal(pending.status, 'CANCELLATION_REQUESTED');
  assert.deepEqual(pending.allowedActions, ['REFUND_APPROVE', 'REFUND_REJECT']);
  assert.equal((await call('POST', `/orders/${o2.id}/refund/reject`, ta, {})).statusCode, 400);
  assert.equal((await call('POST', `/orders/${o2.id}/refund/approve`, tb, {})).statusCode, 404);
  const rj = await call('POST', `/orders/${o2.id}/refund/reject`, ta, { rejectReason: 'ALREADY_PREPARED' });
  assert.equal(rj.statusCode, 200);
  assert.notEqual(rj.json().status, 'CANCELLATION_REQUESTED', 'rejection puts the order back where it was');
});
