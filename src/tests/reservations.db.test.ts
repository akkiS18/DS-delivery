import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { sampleHumoMessage } from '../modules/payment/humo.js';
import { ingestHumoMessage, type TgMessage } from '../modules/payment/humo-telegram.js';
import {
  ReservationError, autoConfirmReservations, cancelReservationByRestaurant, confirmReservationPayment, customerReservationView,
  expireReservations, listRestaurantReservations, loadCustomerReservation, markReservationSeen, placeReservation, setReservationSettings,
} from '../modules/reservations/service.js';
import { renderReservationNotice } from '../bot/reservation-notify.js';

// Table reservations: a deposit paid to the restaurant's card through the normal payment engine, booked by the same automatic policy as an order
// (a Humocard signal -> humo-auto), with tenant isolation, idempotence and the refusals. ds_delivery_test only; nothing is sent.
delete process.env.HUMO_AUTO_CONFIRM;
delete process.env.GMAIL_AUTO_CONFIRM;

const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const nonce = randomUUID().slice(0, 8);
const BOT = String(randomInt(5_000_000_000, 6_000_000_000));
let nextMessageId = randomInt(1000, 100000);
const ids: Record<string, string> = {};
const last4s: string[] = [];
const customerIds: string[] = [];

const message = (text: string): TgMessage => ({ id: nextMessageId++, date: Math.ceil(Date.now() / 1000), out: false, senderId: { toString: () => BOT }, message: text });
const inDays = (d: number, hour = 19) => { const t = new Date(Date.now() + d * 86_400_000); t.setUTCHours(hour - 5, 0, 0, 0); return t; }; // 19:00 Tashkent
const newCustomer = async () => { const c = await db.customer.create({ data: { telegramUserId: String(randomInt(700000000001, 800000000000)), displayName: 'Mijoz', phone: '+998901234567' } }); customerIds.push(c.id); return c; };
const freeLast4 = async () => { for (;;) { const v = String(randomInt(1000, 10000)); if (!(await db.card.findUnique({ where: { last4: v } }))) { last4s.push(v); return v; } } };
const place = (customer: { id: string; displayName: string | null; phone: string | null }, over: Record<string, unknown> = {}, restaurant = 'a', mode: 'REAL' | 'MOCK' = 'REAL') =>
  placeReservation(engine, customer, { restaurantId: ids[restaurant]!, startsAt: inDays(2).toISOString(), partySize: 4, checkoutKey: randomUUID(), ...over } as never, mode);
const rejects = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: unknown) => e instanceof ReservationError && e.message === code, code);
// The engine treats a second credit of the same card and amount shortly after a matched one as a suspected duplicate, so every test that receives money uses its own amount.
let nextDeposit = randomInt(200, 400) * 1000;
async function uniqueDeposit(restaurant: string) { nextDeposit += 1000; await db.restaurant.update({ where: { id: ids[restaurant]! }, data: { reservationDepositSom: nextDeposit } }); return nextDeposit; }
async function freeCards(restaurant: string) { await db.payment.updateMany({ where: { restaurantId: ids[restaurant]!, status: { in: ['AWAITING', 'QUEUED'] } }, data: { status: 'CANCELLED' } }); }
async function credit(reservationId: string, card: string, text?: (tiyin: bigint) => string) {
  const r = await db.reservation.findUniqueOrThrow({ where: { id: reservationId }, include: { payment: true } });
  return ingestHumoMessage(engine, BOT, message(text ? text(r.payment.amountTiyin) : sampleHumoMessage(card, r.payment.amountTiyin, new Date(), r.payment.amountTiyin * 3n)));
}

before(async () => {
  await db.$connect();
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
  assert.match(name, /test/i, `refusing to run against database "${name}"`);
  for (const k of ['a', 'b', 'off']) {
    ids[k] = (await db.restaurant.create({ data: { slug: `rv-${k}-${nonce}`, name: `RV ${k}`, pickupAddress: 'P', reservationsEnabled: k !== 'off', reservationDepositSom: k === 'b' ? 50_000 : 100_000 } })).id;
  }
  for (const k of ['a', 'b']) await db.card.create({ data: { restaurantId: ids[k]!, last4: await freeLast4(), isTest: false } });
});

after(async () => {
  const restaurantIds = Object.values(ids);
  const pays = await db.payment.findMany({ where: { restaurantId: { in: restaurantIds } }, select: { id: true } });
  const cards = await db.card.findMany({ where: { restaurantId: { in: restaurantIds } }, select: { id: true } });
  await db.reservation.deleteMany({ where: { restaurantId: { in: restaurantIds } } });
  await db.paymentEvent.deleteMany({ where: { paymentId: { in: pays.map(p => p.id) } } });
  await db.payment.deleteMany({ where: { id: { in: pays.map(p => p.id) } } });
  await db.incomingTransaction.deleteMany({ where: { cardLast4: { in: last4s } } });
  await db.cardCooldown.deleteMany({ where: { cardId: { in: cards.map(c => c.id) } } });
  await db.card.deleteMany({ where: { restaurantId: { in: restaurantIds } } });
  await db.customer.deleteMany({ where: { id: { in: customerIds } } });
  await db.restaurant.deleteMany({ where: { id: { in: restaurantIds } } });
  await db.$disconnect();
});

test('a reservation creates its deposit payment on the restaurant card; a retry with the same key returns the first one', async () => {
  const c = await newCustomer();
  const key = randomUUID();
  const first = await place(c, { checkoutKey: key });
  assert.equal(first.replayed, false);
  const r = first.reservation;
  assert.equal(r.status, 'PENDING_PAYMENT');
  assert.equal(r.depositSom, 100_000);
  assert.equal(r.payment.amountTiyin, 10_000_000n);
  assert.equal(r.payment.orderId, null, 'a deposit payment has no order');
  assert.equal(r.payment.restaurantId, ids.a);
  assert.equal(r.payment.status, 'AWAITING');
  const view = customerReservationView(r);
  assert.equal(view.payment.instructions !== null, true);
  assert.match(r.code, /^B[A-Z2-9]{5}$/);

  const again = await place(c, { checkoutKey: key });
  assert.equal(again.replayed, true);
  assert.equal(again.reservation.id, r.id);
  assert.equal(await db.reservation.count({ where: { customerId: c.id } }), 1);
  assert.equal(await db.payment.count({ where: { restaurantId: ids.a, id: r.paymentId } }), 1);

  const other = await newCustomer();
  await rejects(place(other, { checkoutKey: key }), 'CHECKOUT_KEY_BEGONA');
  assert.equal(await loadCustomerReservation(other.id, r.id), null, 'another customer cannot read it');
});

test('refusals write nothing: restaurant off, time too soon / too far / outside opening hours, too many unpaid, same slot twice, no phone', async () => {
  const c = await newCustomer();
  const before = await db.reservation.count({ where: { customerId: c.id } });
  await rejects(place(c, {}, 'off'), 'BRON_YOPIQ');
  await rejects(place(c, { startsAt: new Date(Date.now() + 20 * 60_000).toISOString() }), 'BRON_VAQTI_JUDA_YAQIN');
  await rejects(place(c, { startsAt: new Date(Date.now() + 40 * 86_400_000).toISOString() }), 'BRON_VAQTI_JUDA_UZOQ');
  await db.restaurant.update({ where: { id: ids.a! }, data: { workingHours: [1, 2, 3, 4, 5, 6, 7].map(dayOfWeek => ({ dayOfWeek, isOpen: true, openTime: '09:00', closeTime: '12:00' })) } });
  await rejects(place(c, { startsAt: inDays(2, 20).toISOString() }), 'RESTORAN_SHU_VAQTDA_YOPIQ');
  await db.$executeRaw`UPDATE "Restaurant" SET "workingHours" = NULL WHERE id = ${ids.a!}`;
  await rejects(place({ ...c, phone: null }), 'PHONE_REQUIRED');
  assert.equal(await db.reservation.count({ where: { customerId: c.id } }), before, 'nothing was created by any refusal');

  await freeCards('a');
  const t1 = inDays(3).toISOString();
  await place(c, { startsAt: t1 });
  await rejects(place(c, { startsAt: t1 }), 'BRON_ALLAQACHON_BOR');
  await place(c, { startsAt: inDays(4).toISOString() });
  await rejects(place(c, { startsAt: inDays(5).toISOString() }), 'KOP_TOLANMAGAN_BRON');
  await freeCards('a');
});

test('a Humocard credit of the exact deposit books the table through humo-auto; nobody else can book it', async () => {
  await freeCards('a');
  await uniqueDeposit('a');
  const c = await newCustomer();
  const { reservation } = await place(c);
  const card = (await db.card.findUniqueOrThrow({ where: { id: reservation.payment.cardId! } })).last4;
  assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).status, 'PENDING_PAYMENT');

  // wrong actors first: the e-mail actor never relies on a Telegram match, a test actor never touches real money, another restaurant's staff sees nothing
  const r1 = await credit(reservation.id, card);
  assert.equal(r1?.result.status, 'MATCHED_UNVERIFIED', String(r1?.result.reason));
  await assert.rejects(confirmReservationPayment(reservation.id, { kind: 'AUTO', actorId: 'gmail-auto' }), /RUXSAT_YOQ/);
  await assert.rejects(confirmReservationPayment(reservation.id, { kind: 'MOCK' }), /RUXSAT_YOQ/);
  assert.equal(await confirmReservationPayment(reservation.id, { kind: 'STAFF', restaurantId: ids.b!, label: 'x' }), 'NOT_FOUND');
  assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).status, 'PENDING_PAYMENT');

  // concurrent sweeps book it exactly once
  const sweeps = await Promise.all([autoConfirmReservations(), autoConfirmReservations(), autoConfirmReservations()]);
  assert.equal(sweeps.flatMap(s => s.confirmed).filter(x => x === reservation.id).length, 1);
  const booked = await db.reservation.findUniqueOrThrow({ where: { id: reservation.id }, include: { payment: true } });
  assert.equal(booked.status, 'PAID');
  assert.equal(booked.paidBy, 'system:humo-auto');
  assert.ok(booked.paidAt);
  assert.equal(booked.payment.status, 'CONFIRMED_MANUAL');
  assert.equal(await db.paymentEvent.count({ where: { paymentId: booked.paymentId, action: 'CONFIRMED_MANUAL' } }), 1);
  assert.equal(await confirmReservationPayment(reservation.id, { kind: 'AUTO', actorId: 'humo-auto' }), 'ALREADY');

  // the same message again changes nothing
  const dup = await ingestHumoMessage(engine, BOT, message(sampleHumoMessage(card, booked.payment.amountTiyin)));
  assert.notEqual(dup?.result.status, 'MATCHED_UNVERIFIED');
});

test('the kill switch leaves the match for the restaurant, whose own tap books the table', async () => {
  await freeCards('a');
  await uniqueDeposit('a');
  const c = await newCustomer();
  const { reservation } = await place(c);
  const card = (await db.card.findUniqueOrThrow({ where: { id: reservation.payment.cardId! } })).last4;
  assert.equal((await credit(reservation.id, card))?.result.status, 'MATCHED_UNVERIFIED');
  process.env.HUMO_AUTO_CONFIRM = 'false';
  try {
    assert.deepEqual((await autoConfirmReservations()).confirmed.filter(x => x === reservation.id), []);
    assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).status, 'PENDING_PAYMENT');
    const list = await listRestaurantReservations(ids.a!);
    assert.equal(list.upcoming.find(x => x.id === reservation.id)?.awaitingConfirm, true, 'the restaurant sees "money arrived, confirm"');
    assert.equal((await listRestaurantReservations(ids.b!)).upcoming.some(x => x.id === reservation.id), false, 'another restaurant sees nothing');
    assert.equal(await confirmReservationPayment(reservation.id, { kind: 'STAFF', restaurantId: ids.a!, label: 'restaurant-app:s1' }), 'CONFIRMED');
  } finally { delete process.env.HUMO_AUTO_CONFIRM; }
  assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).paidBy, 'restaurant-app:s1');
});

test('a wrong amount never books anything; an unpaid reservation expires with its payment window', async () => {
  await freeCards('a');
  await uniqueDeposit('a');
  const c = await newCustomer();
  const { reservation } = await place(c);
  const card = (await db.card.findUniqueOrThrow({ where: { id: reservation.payment.cardId! } })).last4;
  const wrong = await credit(reservation.id, card, tiyin => sampleHumoMessage(card, tiyin + 100_000n));
  assert.equal(wrong?.result.status, 'REVIEW_REQUIRED');
  assert.equal((await autoConfirmReservations()).confirmed.includes(reservation.id), false);
  assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).status, 'PENDING_PAYMENT');

  await db.payment.update({ where: { id: reservation.paymentId }, data: { status: 'EXPIRED' } });
  const row = await loadCustomerReservation(c.id, reservation.id);
  assert.equal(customerReservationView(row!).status, 'EXPIRED', 'the customer sees it expired at once');
  assert.ok(await expireReservations() >= 1);
  assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).status, 'EXPIRED');
  assert.equal(await confirmReservationPayment(reservation.id, { kind: 'MOCK' }), 'STALE');
});

test('the restaurant list, "seen", and cancelling a booked table are scoped to the owning restaurant', async () => {
  await freeCards('b');
  const deposit = await uniqueDeposit('b');
  const c = await newCustomer();
  const { reservation } = await place(c, {}, 'b');
  assert.equal(reservation.depositSom, deposit, 'each restaurant sets its own deposit');
  const card = (await db.card.findUniqueOrThrow({ where: { id: reservation.payment.cardId! } })).last4;
  await credit(reservation.id, card);
  await autoConfirmReservations();
  const list = await listRestaurantReservations(ids.b!);
  const mine = list.upcoming.find(x => x.id === reservation.id)!;
  assert.equal(mine.status, 'PAID');
  assert.equal(mine.customerPhone, '+998901234567');
  assert.equal(mine.seen, false);
  assert.ok(list.unseenCount >= 1);
  assert.match(renderReservationNotice({ ...reservation, startsAt: reservation.startsAt }, 'Asia/Tashkent'), /pul tushdi, joy band qilindi/);

  await markReservationSeen(ids.a!, reservation.id); // another restaurant: no effect
  assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).restaurantSeenAt, null);
  await markReservationSeen(ids.b!, reservation.id);
  assert.ok((await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).restaurantSeenAt);

  assert.equal(await cancelReservationByRestaurant(ids.a!, reservation.id, 'x', 'a'), 'NOT_FOUND');
  assert.equal(await cancelReservationByRestaurant(ids.b!, reservation.id, 'stol yo‘q', 'restaurant-app:s2'), 'CANCELLED');
  assert.equal(await cancelReservationByRestaurant(ids.b!, reservation.id, undefined, 'restaurant-app:s2'), 'ALREADY');
  assert.equal((await listRestaurantReservations(ids.b!)).past.some(x => x.id === reservation.id && x.status === 'CANCELLED'), true);
});

test('settings: switching on needs a card; the deposit has bounds; the database refuses bad values too', async () => {
  await assert.rejects(setReservationSettings(ids.off!, { enabled: true, depositSom: 100_000 }), (e: unknown) => e instanceof ReservationError && e.message === 'KARTA_YOQ');
  const ok = await setReservationSettings(ids.a!, { enabled: true, depositSom: 150_000 });
  assert.deepEqual(ok, { reservationsEnabled: true, reservationDepositSom: 150_000 });
  await setReservationSettings(ids.a!, { enabled: true, depositSom: 100_000 });
  await assert.rejects(db.restaurant.update({ where: { id: ids.a! }, data: { reservationDepositSom: 10 } }), /Restaurant_reservationDepositSom_range|constraint/i);
  await assert.rejects(db.reservation.updateMany({ data: { status: 'BOGUS' } }).then(r => { if (r.count === 0) throw new Error('no row to test against'); }));
});
