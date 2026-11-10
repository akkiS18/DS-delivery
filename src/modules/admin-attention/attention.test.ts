import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_QUIET, attentionConfig, evaluateOrders, evaluateTurnover, finalize, formatQuiet, inQuietHours, parseQuiet, tashkentMinutes,
  type OrderRow, type RawItem,
} from './service.js';

const NOW = new Date('2026-10-30T10:00:00.000Z');
const ago = (sec: number): Date => new Date(NOW.getTime() - sec * 1000);
const cfg = attentionConfig({});
const R = { id: 'r1', name: 'Sifat Food', pickupPhone: '+998901112233' };

function order(o: Partial<OrderRow> & { dispatch?: { status: string; dispatchedAt?: Date | null; updatedAt?: Date } | null; method?: string; pstatus?: string; matchedAt?: Date | null }): OrderRow {
  const { dispatch, method, pstatus, matchedAt, ...rest } = o;
  return {
    id: 'o1', code: 'AB12', status: 'PREPARING', totalSom: 55_000, createdAt: ago(3600), updatedAt: ago(10), deliveryMode: 'TAXI', readyAt: null,
    preparingStartedAt: ago(10), paymentVerifiedAt: ago(20), prepChosenMinutes: null, restaurant: R,
    payment: { method: method ?? 'CARD', status: pstatus ?? 'CONFIRMED_MANUAL', matchedAt: matchedAt ?? null },
    taxiDispatches: dispatch ? [{ status: dispatch.status, dispatchedAt: dispatch.dispatchedAt ?? null, updatedAt: dispatch.updatedAt ?? ago(5), taxiCompany: { name: 'Sinov Taksi' } }] : [],
    ...rest,
  } as OrderRow;
}
const kinds = (items: RawItem[]): string[] => items.map(i => i.kind);
const online = new Set<string>(['r1']);
const run = (rows: OrderRow[], on: ReadonlySet<string> = online) => evaluateOrders(rows, on, NOW, cfg);

test('quiet hours: default window, wrap over midnight, Tashkent offset, off, unreadable values never mean "off"', () => {
  assert.deepEqual(parseQuiet(undefined), DEFAULT_QUIET);
  assert.equal(parseQuiet('off'), null);
  assert.deepEqual(parseQuiet('23:00-06:30'), { from: '23:00', to: '06:30' });
  assert.deepEqual(parseQuiet('banana'), DEFAULT_QUIET);
  assert.deepEqual(parseQuiet('25:00-07:00'), DEFAULT_QUIET);
  assert.equal(formatQuiet(null), 'off');
  assert.equal(formatQuiet({ from: '01:00', to: '07:00' }), '01:00-07:00');
  assert.equal(tashkentMinutes(new Date('2026-10-30T20:00:00Z')), 60); // 01:00 in Tashkent
  const at = (utc: string) => new Date(`2026-10-30T${utc}:00Z`);
  assert.equal(inQuietHours(DEFAULT_QUIET, at('20:00')), true); // 01:00
  assert.equal(inQuietHours(DEFAULT_QUIET, at('01:59')), true); // 06:59
  assert.equal(inQuietHours(DEFAULT_QUIET, at('02:00')), false); // 07:00 is outside
  assert.equal(inQuietHours(DEFAULT_QUIET, at('19:59')), false); // 00:59
  assert.equal(inQuietHours({ from: '23:00', to: '06:00' }, at('18:30')), true); // 23:30
  assert.equal(inQuietHours({ from: '23:00', to: '06:00' }, at('12:00')), false); // 17:00
  assert.equal(inQuietHours({ from: '05:00', to: '05:00' }, at('00:00')), false);
  assert.equal(inQuietHours(null, at('20:00')), false);
});

test('attentionConfig: defaults and refused out-of-range values', () => {
  assert.equal(cfg.unseenSeconds, 120);
  assert.equal(cfg.cashSeconds, 180);
  assert.equal(cfg.offlineSeconds, 180);
  assert.equal(cfg.snoozeMinutes, 15);
  assert.throws(() => attentionConfig({ ADMIN_ATTN_OFFLINE_SECONDS: '60' })); // below the 60 s session heartbeat plus margin
  assert.throws(() => attentionConfig({ ADMIN_ATTN_UNSEEN_SECONDS: 'x' }));
});

test('paid card order: raised only when the kitchen has not acknowledged it for long enough', () => {
  assert.deepEqual(kinds(run([order({ preparingStartedAt: ago(60) })])), []);
  assert.deepEqual(kinds(run([order({ preparingStartedAt: ago(200) })])), ['ORDER_UNSEEN']);
  assert.deepEqual(kinds(run([order({ preparingStartedAt: ago(900), prepChosenMinutes: 15 })])), [], 'acknowledged (SET_PREP_TIME) = seen');
  assert.deepEqual(kinds(run([order({ status: 'PAYMENT_CONFIRMED', preparingStartedAt: null, paymentVerifiedAt: ago(400) })])), ['ORDER_UNSEEN'], 'auto-start failed');
  assert.deepEqual(kinds(run([order({ method: 'CASH', pstatus: 'CASH_ACCEPTED', preparingStartedAt: ago(900) })])), [], 'a person already accepted the cash order');
  const [item] = run([order({ preparingStartedAt: ago(200) })]);
  assert.equal(item!.key, 'ORDER_UNSEEN:o1');
  assert.equal(item!.restaurant!.phone, '+998901112233');
  assert.match(item!.detail, /#AB12/);
});

test('cash order nobody accepted, and a payment the restaurant did not confirm', () => {
  const cash = (age: number) => order({ status: 'PAYMENT_PENDING', method: 'CASH', pstatus: 'CASH_PENDING', createdAt: ago(age), preparingStartedAt: null, paymentVerifiedAt: null });
  assert.deepEqual(kinds(run([cash(120)])), []);
  assert.deepEqual(kinds(run([cash(240)])), ['CASH_UNACCEPTED']);
  const matched = (age: number) => order({ status: 'PAYMENT_MATCHED_UNVERIFIED', pstatus: 'MATCHED_UNVERIFIED', matchedAt: ago(age), preparingStartedAt: null, paymentVerifiedAt: null });
  assert.deepEqual(kinds(run([matched(100)])), []);
  assert.deepEqual(kinds(run([matched(400)])), ['PAYMENT_UNVERIFIED']);
});

test('ready order: no taxi, silent operator, driver never confirmed, needs help; self delivery is not a taxi matter', () => {
  const ready = (d: Parameters<typeof order>[0]['dispatch'], readyAgo = 400, extra: Partial<OrderRow> = {}) =>
    order({ status: 'READY', prepChosenMinutes: 10, readyAt: ago(readyAgo), dispatch: d, ...extra });
  assert.deepEqual(kinds(run([ready(null, 100)])), []);
  assert.deepEqual(kinds(run([ready(null)])), ['READY_NO_TAXI']);
  assert.match(run([ready(null)])[0]!.detail, /taksi çaqirilmagan/);
  assert.deepEqual(kinds(run([ready({ status: 'REQUESTED' })])), ['READY_NO_TAXI']);
  assert.match(run([ready({ status: 'REQUESTED' })])[0]!.detail, /javob bermagan/);
  assert.match(run([ready({ status: 'ACCEPTED' })])[0]!.detail, /haydovçi yuborilmagan/);
  assert.deepEqual(kinds(run([ready({ status: 'ASSIGNED', dispatchedAt: ago(300) })])), [], 'a driver is on the way');
  assert.deepEqual(kinds(run([ready({ status: 'NEEDS_HELP' })])), ['TAXI_NEEDS_HELP']);
  assert.deepEqual(kinds(run([ready({ status: 'DECLINED' })])), ['TAXI_NEEDS_HELP']);
  assert.deepEqual(kinds(run([ready({ status: 'CANCELLATION_PENDING' })])), ['TAXI_NEEDS_HELP']);
  assert.deepEqual(kinds(run([ready({ status: 'ASSIGNED', dispatchedAt: ago(4000) })])), ['NOT_DELIVERED']);
  assert.deepEqual(kinds(run([ready(null, 4000, { deliveryMode: 'SELF' })])), []);
  // a cooking order whose taxi request failed early also needs the administrator
  assert.deepEqual(kinds(run([order({ prepChosenMinutes: 10, dispatch: { status: 'NEEDS_HELP' } })])), ['TAXI_NEEDS_HELP']);
});

test('restaurant app offline: only when something waits for the restaurant, long enough, and no app reported in', () => {
  const unseen = order({ preparingStartedAt: ago(400) });
  assert.deepEqual(kinds(run([unseen], new Set())).sort(), ['ORDER_UNSEEN', 'RESTAURANT_OFFLINE']);
  assert.deepEqual(kinds(run([unseen], online)), ['ORDER_UNSEEN']);
  assert.deepEqual(kinds(run([order({ preparingStartedAt: ago(100) })], new Set())), [], 'too recent to say the app is gone');
  assert.deepEqual(kinds(run([order({ prepChosenMinutes: 10, preparingStartedAt: ago(4000) })], new Set())), [], 'cooking, nothing waits for the app');
  const two = run([unseen, order({ id: 'o2', code: 'CD34', preparingStartedAt: ago(500) })], new Set()).filter(i => i.kind === 'RESTAURANT_OFFLINE');
  assert.equal(two.length, 1, 'one item per restaurant');
  assert.match(two[0]!.detail, /2 ta buyurtma/);
  assert.equal(two[0]!.key, 'RESTAURANT_OFFLINE:r1');
});

test('finalize: critical first, then the longest waiting; ack silences until it expires; quiet hours silence everything below critical', () => {
  const raw = (kind: RawItem['kind'], key: string, secAgo: number): RawItem => ({ key, kind, title: kind, detail: '', restaurant: null, orderCode: null, since: ago(secAgo) });
  const items = [raw('CARD_PENDING', 'CARD_PENDING:c1', 900), raw('READY_NO_TAXI', 'READY_NO_TAXI:a', 100), raw('ORDER_UNSEEN', 'ORDER_UNSEEN:b', 50), raw('ORDER_UNSEEN', 'ORDER_UNSEEN:a', 500)];
  const loud = finalize(items, new Map(), false, NOW);
  assert.deepEqual(loud.map(i => i.key), ['ORDER_UNSEEN:a', 'ORDER_UNSEEN:b', 'READY_NO_TAXI:a', 'CARD_PENDING:c1']);
  assert.deepEqual(loud.filter(i => i.alarm).map(i => i.key), ['ORDER_UNSEEN:a', 'ORDER_UNSEEN:b', 'READY_NO_TAXI:a'], 'a card approval waiting is a notification, not a ring');
  assert.equal(loud[3]!.notify, true);
  assert.equal(loud[0]!.ageSeconds, 500);

  const acks = new Map([['ORDER_UNSEEN:a', new Date(NOW.getTime() + 600_000)], ['ORDER_UNSEEN:b', new Date(NOW.getTime() - 1)]]);
  const withAck = finalize(items, acks, false, NOW);
  assert.equal(withAck.find(i => i.key === 'ORDER_UNSEEN:a')!.alarm, false);
  assert.equal(withAck.find(i => i.key === 'ORDER_UNSEEN:a')!.acked, true);
  assert.equal(withAck.find(i => i.key === 'ORDER_UNSEEN:b')!.alarm, true, 'an expired snooze rings again');

  const quiet = finalize(items, new Map(), true, NOW);
  assert.deepEqual(quiet.filter(i => i.alarm).map(i => i.severity), ['CRITICAL', 'CRITICAL']);
  assert.equal(quiet.length, 4, 'quiet hours silence the sound, they never hide an item');
});

test('pool card turnover: nothing below 70%, a silent heads-up from 70%, a ringing warning from 90%, only the higher level per card, no cap = no warning', () => {
  const cards = [{ id: 'a', last4: '1111' }, { id: 'b', last4: '2222' }, { id: 'c', last4: '3333' }, { id: 'd', last4: '4444' }];
  const cap = 40_000_000;
  const used = new Map([['a', 27_999_999], ['b', 28_000_000], ['c', 36_000_000], ['d', 0]]);
  const items = evaluateTurnover(cards, used, cap);
  assert.deepEqual(items.map(i => i.key), ['CARD_TURN_MID:b', 'CARD_TURN_HIGH:c']);
  assert.match(items[0]!.title, /70%/);
  assert.match(items[1]!.title, /90%/);
  assert.deepEqual(evaluateTurnover(cards, used, 0), [], 'cap 0 = unlimited');

  const final = finalize(items, new Map(), false, NOW);
  assert.equal(final.find(i => i.kind === 'CARD_TURN_MID')!.alarm, false, '70% is listed but never rings');
  assert.equal(final.find(i => i.kind === 'CARD_TURN_MID')!.notify, false, '70% is not even announced');
  assert.equal(final.find(i => i.kind === 'CARD_TURN_HIGH')!.alarm, false, '90% never rings any more: an ordinary notification');
  assert.equal(final.find(i => i.kind === 'CARD_TURN_HIGH')!.notify, true);
  assert.equal(final.find(i => i.kind === 'CARD_TURN_HIGH')!.severity, 'HIGH');
});

test('only what must be solved on the spot rings; suspicious money, disputes, tickets, cards and late deliveries are one-time notifications', () => {
  const kinds = ['ORDER_UNSEEN', 'CASH_UNACCEPTED', 'PAYMENT_UNVERIFIED', 'TAXI_NEEDS_HELP', 'GMAIL_DOWN', 'RESTAURANT_OFFLINE', 'READY_NO_TAXI',
    'MONEY_REVIEW', 'REFUND_DISPUTED', 'SUPPORT_TICKET', 'NOT_DELIVERED', 'CARD_PENDING', 'CARD_TURN_HIGH', 'CARD_TURN_MID'] as const;
  const raw = kinds.map(kind => ({ key: `${kind}:x`, kind, title: 't', detail: 'd', restaurant: null, orderCode: null, since: null }));
  const out = finalize(raw, new Map(), false, NOW);
  const ring = out.filter(i => i.alarm).map(i => i.kind).sort();
  assert.deepEqual(ring, ['CASH_UNACCEPTED', 'GMAIL_DOWN', 'ORDER_UNSEEN', 'PAYMENT_UNVERIFIED', 'READY_NO_TAXI', 'RESTAURANT_OFFLINE', 'TAXI_NEEDS_HELP']);
  assert.deepEqual(out.filter(i => i.notify).map(i => i.kind).sort(), ['CARD_PENDING', 'CARD_TURN_HIGH', 'MONEY_REVIEW', 'NOT_DELIVERED', 'REFUND_DISPUTED', 'SUPPORT_TICKET']);
  assert.ok(out.every(i => !(i.alarm && i.notify)), 'an item either rings or notifies, never both');
  assert.equal(out.find(i => i.kind === 'CARD_TURN_MID')!.notify, false, 'the 70% heads-up is only listed');
  // an acknowledged item (the administrator said "I called") neither rings nor notifies
  const acked = finalize(raw, new Map([['MONEY_REVIEW:x', new Date(NOW.getTime() + 60_000)], ['ORDER_UNSEEN:x', new Date(NOW.getTime() + 60_000)]]), false, NOW);
  assert.equal(acked.find(i => i.kind === 'MONEY_REVIEW')!.notify, false);
  assert.equal(acked.find(i => i.kind === 'ORDER_UNSEEN')!.alarm, false);
  // quiet hours: only CRITICAL ringing kinds still ring; the two HIGH ones (restaurant offline, ready without taxi) go quiet
  const night = finalize(raw, new Map(), true, NOW);
  assert.deepEqual(night.filter(i => i.alarm).map(i => i.kind).sort(), ['CASH_UNACCEPTED', 'GMAIL_DOWN', 'ORDER_UNSEEN', 'PAYMENT_UNVERIFIED', 'TAXI_NEEDS_HELP']);
});
