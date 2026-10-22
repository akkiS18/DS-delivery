import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient, type OrderStatus } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { attemptKey, hashToken, setRestaurantPassword } from '../modules/restaurant-auth/service.js';
import { accrueCommission, accrueCommissionTx } from '../modules/commission/ledger.js';
import { db as appDb } from '../lib/db.js';

process.env.RESTAURANT_LOGIN_MAX_FAILURES = '50';
process.env.RESTAURANT_LOGIN_IP_MAX_FAILURES = '1000';

const db = new PrismaClient();
const app = buildApp(new PaymentEngineV3(db, defaultOptions, () => {}));
const nonce = randomUUID().slice(0, 8);
const slugA = `fin-a-${nonce}`;
const slugB = `fin-b-${nonce}`;
const PW_A = `Alpha-${randomUUID()}`;
const PW_B = `Bravo-${randomUUID()}`;
const ids: Record<string, string> = {};
const ips: string[] = [];
let customerId = '';
let ta = '';
let tb = '';
const flatBefore = process.env.COMMISSION_FLAT_SOM;

const ip = () => { const v = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`; ips.push(v); return v; };
async function loginToken(slug: string, password: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/v1/restaurant/auth/login', payload: { slug, password }, remoteAddress: ip() });
  assert.equal(r.statusCode, 200);
  return r.json().accessToken;
}
const get = (url: string, token?: string) =>
  app.inject({ method: 'GET', url: `/api/v1/restaurant/finance${url}`, headers: token ? { authorization: `Bearer ${token}` } : {} });

interface MakeOpts { status?: OrderStatus; payStatus?: string | null; payTest?: boolean; som?: number; orderTest?: boolean; restaurant?: string }
/** A real-looking (non-test) order; verified payments carry a matched incoming transaction as the 4A CHECK demands. */
async function mkOrder(o: MakeOpts = {}) {
  const som = o.som ?? 21_000;
  const restaurantId = o.restaurant ?? ids.a!;
  const payStatus = o.payStatus === undefined ? 'CONFIRMED_MANUAL' : o.payStatus;
  let matchedTransactionId: string | undefined;
  if (payStatus && !o.payTest && ['CONFIRMED_MANUAL', 'MATCHED_UNVERIFIED'].includes(payStatus)) {
    matchedTransactionId = (await db.incomingTransaction.create({
      data: { sourceId: `fin-${randomUUID()}`, source: 'test', cardLast4: '0000', amountTiyin: BigInt(som) * 100n, occurredAt: new Date() },
    })).id;
  }
  const order = await db.order.create({ data: {
    restaurantId, customerId, addressText: 'x', totalSom: som, createdViaBot: true, status: o.status ?? 'PAYMENT_CONFIRMED',
    paymentIsTest: o.orderTest ?? false,
    ...(payStatus ? { payment: { create: { restaurantId, amountTiyin: BigInt(som) * 100n, status: payStatus, isTest: o.payTest ?? false, matchedTransactionId } } } : {}),
  } });
  return order;
}
/** What the future delivery stage must do: lock, move to COMPLETED, write the OrderEvent, in one transaction. */
async function deliver(orderId: string, accrue = false) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
    const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
    if (o.status !== 'COMPLETED') {
      await tx.order.update({ where: { id: orderId }, data: { status: 'COMPLETED' } });
      await tx.orderEvent.create({ data: { orderId, actorTelegramId: 'test', actorType: 'SYSTEM', action: 'TEST_DELIVERY', fromStatus: o.status, toStatus: 'COMPLETED' } });
    }
    return accrue ? accrueCommissionTx(tx, orderId, { id: 'system', type: 'SYSTEM' }) : null;
  });
}
const entries = (restaurantId = ids.a!) => db.commissionEntry.count({ where: { restaurantId } });
async function mkRefund(orderId: string, status: string, extra: Record<string, unknown> = {}) {
  const p = await db.payment.findUniqueOrThrow({ where: { orderId } });
  const decided = ['APPROVED', 'SENT', 'CONFIRMED', 'DISPUTED'].includes(status);
  return db.refundRequest.create({ data: {
    orderId, paymentId: p.id, kind: 'CUSTOMER_CANCEL', status, reasonCode: 'CHANGED_MIND', paidAmountTiyin: p.amountTiyin,
    orderStatusBefore: 'PAYMENT_CONFIRMED', paymentStatusAtRequest: p.status, requestedBy: 'c', requestedByType: 'CUSTOMER',
    ...(decided ? { approvedAmountTiyin: p.amountTiyin, decidedBy: 's', decidedAt: new Date() } : {}),
    ...(['SENT', 'CONFIRMED', 'DISPUTED'].includes(status) ? { sentBy: 's', sentAt: new Date(), bankReference: 'TRX-1234-5678' } : {}),
    ...(status === 'REJECTED' ? { rejectReason: 'POLICY', decidedBy: 's', decidedAt: new Date() } : {}),
    ...extra,
  } });
}

before(async () => {
  await db.$connect();
  for (const [k, slug] of [['a', slugA], ['b', slugB]] as const) ids[k] = (await db.restaurant.create({ data: { slug, name: `Fin ${k}` } })).id;
  await setRestaurantPassword({ slug: slugA, password: PW_A });
  await setRestaurantPassword({ slug: slugB, password: PW_B });
  ta = await loginToken(slugA, PW_A);
  tb = await loginToken(slugB, PW_B);
  customerId = (await db.customer.create({ data: { telegramUserId: String(randomInt(900000000001, 990000000000)) } })).id;
});
after(async () => {
  if (flatBefore === undefined) delete process.env.COMMISSION_FLAT_SOM; else process.env.COMMISSION_FLAT_SOM = flatBefore;
  const rids = Object.values(ids);
  const orders = (await db.order.findMany({ where: { restaurantId: { in: rids } }, select: { id: true } })).map(o => o.id);
  await db.$transaction(async tx => { // ledger rows are append-only; this switch exists for exactly this cleanup
    await tx.$executeRaw`SELECT set_config('ds.ledger_cleanup', 'on', true)`;
    await tx.commissionEvent.deleteMany({ where: { entry: { restaurantId: { in: rids } } } });
    await tx.commissionEntry.deleteMany({ where: { restaurantId: { in: rids } } });
  });
  await db.refundRequest.deleteMany({ where: { orderId: { in: orders } } });
  const pays = await db.payment.findMany({ where: { restaurantId: { in: rids } }, select: { id: true, matchedTransactionId: true } });
  await db.payment.deleteMany({ where: { id: { in: pays.map(p => p.id) } } });
  await db.incomingTransaction.deleteMany({ where: { id: { in: pays.map(p => p.matchedTransactionId).filter((x): x is string => !!x) } } });
  await db.order.deleteMany({ where: { restaurantId: { in: rids } } });
  await db.customer.deleteMany({ where: { id: customerId } });
  await db.restaurantLoginAttempt.deleteMany({ where: { keyHash: { in: [slugA, slugB].map(s => attemptKey('slug', s)).concat(ips.map(i => attemptKey('ip', i))) } } });
  await db.restaurant.deleteMany({ where: { id: { in: rids } } });
  await app.close();
  await db.$disconnect();
  await appDb.$disconnect();
});

test('a delivered, verified order earns exactly the configured flat commission, with an audit event and proof', async () => {
  delete process.env.COMMISSION_FLAT_SOM;
  const o = await mkOrder();
  assert.equal((await accrueCommission(o.id)).result, 'NOT_ELIGIBLE'); // paid and verified, but not delivered
  await deliver(o.id);
  const r = await accrueCommission(o.id);
  assert.equal(r.result, 'ACCRUED');
  const e = await db.commissionEntry.findUniqueOrThrow({ where: { orderId: o.id }, include: { events: true } });
  assert.equal(e.amountSom, 5000);
  assert.equal(e.orderTotalSom, 21_000);
  assert.equal(e.restaurantId, ids.a);
  assert.equal(e.kind, 'ACCRUAL');
  assert.deepEqual(e.events.map(x => x.action), ['ACCRUED']);
  const proof = await db.orderEvent.findUniqueOrThrow({ where: { id: e.proofEventId } });
  assert.equal(proof.toStatus, 'COMPLETED');
  assert.equal(proof.orderId, o.id);
});

test('duplicate and concurrent accruals/delivery updates create exactly one ledger entry', async () => {
  const o = await mkOrder();
  const results = await Promise.all(Array.from({ length: 8 }, () => deliver(o.id, true)));
  assert.equal(results.filter(r => r?.result === 'ACCRUED').length, 1);
  assert.equal(results.filter(r => r?.result === 'ALREADY_ACCRUED').length, 7);
  assert.equal(await db.commissionEntry.count({ where: { orderId: o.id } }), 1);
  const e = await db.commissionEntry.findUniqueOrThrow({ where: { orderId: o.id } });
  assert.equal(await db.commissionEvent.count({ where: { entryId: e.id } }), 1);
  // plain standalone calls after the fact are idempotent too
  const again = await Promise.all(Array.from({ length: 5 }, () => accrueCommission(o.id)));
  assert.ok(again.every(r => r.result === 'ALREADY_ACCRUED'));
  assert.equal(await db.commissionEntry.count({ where: { orderId: o.id } }), 1);
  // different orders in parallel each get their own
  const [x, y] = await Promise.all([mkOrder(), mkOrder()]);
  const both = await Promise.all([deliver(x.id, true), deliver(y.id, true)]);
  assert.ok(both.every(r => r?.result === 'ACCRUED'));
});

test('no commission for undelivered, cancelled, unverified, test or refunded orders', async () => {
  const before = await entries();
  const cases: Array<[string, Awaited<ReturnType<typeof mkOrder>>]> = [
    ['confirmed only', await mkOrder({ status: 'PAYMENT_CONFIRMED' })],
    ['preparing', await mkOrder({ status: 'PREPARING' })],
    ['ready', await mkOrder({ status: 'READY' })],
    ['delivery assumed', await mkOrder({ status: 'DELIVERY_ASSUMED' })],
    ['cancelled', await mkOrder({ status: 'CANCELLED' })],
    ['restaurant rejected', await mkOrder({ status: 'RESTAURANT_REJECTED', payStatus: null })],
    ['unverified payment', await mkOrder({ payStatus: 'MATCHED_UNVERIFIED' })],
    ['test payment', await mkOrder({ payTest: true })],
    ['test order', await mkOrder({ orderTest: true })],
  ];
  // taxi dispatched is not delivered
  await db.taxiCompany.deleteMany({ where: { name: `Taxi fin ${nonce}` } });
  const taxi = await db.taxiCompany.create({ data: { name: `Taxi fin ${nonce}`, operatorTelegramUserId: String(randomInt(900000000001, 990000000000)), isActive: true } });
  const dispatched = await mkOrder({ status: 'DRIVER_ASSIGNED' });
  await db.taxiDispatch.create({ data: { orderId: dispatched.id, taxiCompanyId: taxi.id, attemptNo: 1, status: 'ASSIGNED', dueAt: new Date() } });
  cases.push(['taxi assigned', dispatched]);
  for (const [label, o] of cases) {
    const r = await accrueCommission(o.id);
    assert.equal(r.result, 'NOT_ELIGIBLE', label);
  }
  // COMPLETED but unverified payment / test payment / test order are still refused after "delivery"
  for (const label of ['unverified payment', 'test payment', 'test order']) {
    const o = cases.find(c => c[0] === label)![1];
    await deliver(o.id);
    assert.equal((await accrueCommission(o.id)).result, 'NOT_ELIGIBLE', `${label} (completed)`);
  }
  // refunded order that later shows COMPLETED must not earn automatically
  const refunded = await mkOrder();
  await mkRefund(refunded.id, 'REQUESTED');
  await deliver(refunded.id);
  const r = await accrueCommission(refunded.id);
  assert.deepEqual(r, { result: 'NOT_ELIGIBLE', reason: 'REFUND_EXISTS' });
  assert.equal(await entries(), before);
  await db.taxiDispatch.deleteMany({ where: { taxiCompanyId: taxi.id } });
  await db.taxiCompany.delete({ where: { id: taxi.id } });
});

test('the database itself refuses a commission that skips the rules, and the ledger is append-only', async () => {
  const paidOnly = await mkOrder();
  const p = await db.payment.findUniqueOrThrow({ where: { orderId: paidOnly.id } });
  const base = { orderId: paidOnly.id, restaurantId: ids.a!, paymentId: p.id, amountSom: 5000, orderTotalSom: 21_000, ruleCode: 'FLAT_SOM', proofEventId: 'x', accruedBy: 'attacker' };
  await assert.rejects(db.commissionEntry.create({ data: base }), /COMMISSION_ORDER_NOT_COMPLETED/);
  await deliver(paidOnly.id);
  await assert.rejects(db.commissionEntry.create({ data: base }), /COMMISSION_NO_DELIVERY_PROOF/); // no OrderEvent with that id
  const ev = await db.orderEvent.findFirstOrThrow({ where: { orderId: paidOnly.id, toStatus: 'COMPLETED' } });
  await assert.rejects(db.commissionEntry.create({ data: { ...base, proofEventId: ev.id, restaurantId: ids.b! } }), /COMMISSION_ORDER_MISMATCH/);
  await assert.rejects(db.commissionEntry.create({ data: { ...base, proofEventId: ev.id, amountSom: 0 } }), /CommissionEntry_amount_positive|amount/);
  await db.commissionEntry.create({ data: { ...base, proofEventId: ev.id, accruedBy: 'system' } });
  await assert.rejects(db.commissionEntry.create({ data: { ...base, proofEventId: ev.id } }), /Unique constraint|orderId/);
  const e = await db.commissionEntry.findUniqueOrThrow({ where: { orderId: paidOnly.id } });
  await assert.rejects(db.commissionEntry.update({ where: { id: e.id }, data: { amountSom: 1 } }), /LEDGER_APPEND_ONLY/);
  await assert.rejects(db.commissionEntry.delete({ where: { id: e.id } }), /LEDGER_APPEND_ONLY/);
  const ce = await db.commissionEvent.create({ data: { entryId: e.id, actorId: 't', actorType: 'SYSTEM', action: 'TEST_NOTE' } });
  await assert.rejects(db.commissionEvent.update({ where: { id: ce.id }, data: { action: 'X' } }), /LEDGER_APPEND_ONLY/);
  await assert.rejects(db.commissionEvent.delete({ where: { id: ce.id } }), /LEDGER_APPEND_ONLY/);
  // an unverified-payment order cannot be forced in directly either
  const unv = await mkOrder({ payStatus: 'MATCHED_UNVERIFIED' });
  await deliver(unv.id);
  const up = await db.payment.findUniqueOrThrow({ where: { orderId: unv.id } });
  const uev = await db.orderEvent.findFirstOrThrow({ where: { orderId: unv.id, toStatus: 'COMPLETED' } });
  await assert.rejects(db.commissionEntry.create({ data: { ...base, orderId: unv.id, paymentId: up.id, proofEventId: uev.id } }), /COMMISSION_PAYMENT_NOT_VERIFIED/);
});

test('historical commission amounts are preserved when the configured rate changes', async () => {
  delete process.env.COMMISSION_FLAT_SOM;
  const first = await mkOrder();
  await deliver(first.id, true);
  process.env.COMMISSION_FLAT_SOM = '7000';
  const second = await mkOrder();
  await deliver(second.id, true);
  process.env.COMMISSION_FLAT_SOM = '9000';
  await accrueCommission(first.id); // idempotent: must not re-price
  const a = await db.commissionEntry.findUniqueOrThrow({ where: { orderId: first.id } });
  const b = await db.commissionEntry.findUniqueOrThrow({ where: { orderId: second.id } });
  assert.equal(a.amountSom, 5000);
  assert.equal(b.amountSom, 7000);
  process.env.COMMISSION_FLAT_SOM = 'garbage';
  const bad = await mkOrder();
  await deliver(bad.id);
  await assert.rejects(accrueCommission(bad.id), /COMMISSION_CONFIG_INVALID/); // fails closed, no row
  assert.equal(await db.commissionEntry.count({ where: { orderId: bad.id } }), 0);
  delete process.env.COMMISSION_FLAT_SOM;
});

test('finance endpoints require a valid Bearer session; expired and unknown tokens are rejected', async () => {
  for (const path of ['/summary', '/orders', '/commissions', '/refunds']) {
    assert.equal((await get(path)).statusCode, 401, path);
    assert.equal((await get(path, 'not-a-token')).statusCode, 401, path);
  }
  const t = await loginToken(slugA, PW_A);
  assert.equal((await get('/summary', t)).statusCode, 200);
  await db.restaurantSession.update({ where: { tokenHash: hashToken(t) }, data: { expiresAt: new Date(Date.now() - 1000) } });
  for (const path of ['/summary', '/orders', '/commissions', '/refunds']) assert.equal((await get(path, t)).statusCode, 401, path);
});

test('every finance query is scoped to the authenticated restaurant; client restaurantId is rejected', async () => {
  const mine = await mkOrder();
  await deliver(mine.id, true);
  const refunded = await mkOrder();
  await mkRefund(refunded.id, 'SENT');
  const resA = {
    orders: (await get('/orders?limit=100', ta)).json(),
    commissions: (await get('/commissions?limit=100', ta)).json(),
    refunds: (await get('/refunds?limit=100', ta)).json(),
  };
  assert.ok(resA.orders.items.some((i: { number: number }) => i.number === mine.number));
  assert.ok(resA.commissions.items.length > 0);
  assert.ok(resA.refunds.items.length > 0);
  // restaurant B sees nothing of A's
  const sb = (await get('/summary', tb)).json();
  assert.equal(sb.orders.completed.count + sb.orders.cancelled.count + sb.orders.inProgress.count, 0);
  assert.equal(sb.commission.outstandingLiability.som, 0);
  assert.equal(sb.refunds.openNow.total.count, 0);
  assert.equal(sb.payments.verifiedReceived.som, 0);
  for (const path of ['/orders', '/commissions', '/refunds']) assert.deepEqual((await get(path, tb)).json().items, [], path);
  // identity is never taken from the client
  for (const path of ['/summary', '/orders', '/commissions', '/refunds']) {
    assert.equal((await get(`${path}?restaurantId=${ids.a}`, tb)).statusCode, 400, path);
  }
  // B owns data too: A still does not see it
  const bOrder = await mkOrder({ restaurant: ids.b });
  await deliver(bOrder.id);
  const seenByA = (await get('/orders?limit=100', ta)).json().items.map((i: { number: number }) => i.number);
  assert.ok(!seenByA.includes(bOrder.number));
});

test('summary: only restaurant-verified payments count as received; pending, awaiting, cancelled and test are separate or excluded', async () => {
  const slug = `fin-c-${nonce}`;
  ids.c = (await db.restaurant.create({ data: { slug, name: 'Fin c' } })).id;
  await setRestaurantPassword({ slug, password: PW_A });
  const tc = await loginToken(slug, PW_A);
  const done = await mkOrder({ restaurant: ids.c, som: 30_000 });
  await deliver(done.id, true);
  await mkOrder({ restaurant: ids.c, som: 11_000, status: 'PAYMENT_MATCHED_UNVERIFIED', payStatus: 'MATCHED_UNVERIFIED' });
  await mkOrder({ restaurant: ids.c, som: 12_000, status: 'PAYMENT_PENDING', payStatus: 'AWAITING' });
  await mkOrder({ restaurant: ids.c, som: 13_000, status: 'CANCELLED', payStatus: 'CANCELLED' });
  await mkOrder({ restaurant: ids.c, som: 14_000, status: 'PAYMENT_CONFIRMED', payTest: true });
  await mkOrder({ restaurant: ids.c, som: 15_000, orderTest: true });
  const s = (await get('/summary', tc)).json();
  assert.equal(s.payments.verifiedReceived.som, 30_000);
  assert.equal(s.payments.pendingUnverified.som, 11_000);
  assert.equal(s.payments.awaitingPayment.som, 12_000);
  assert.equal(s.orders.completed.count, 1);
  assert.equal(s.orders.completed.totalSom, 30_000);
  assert.equal(s.orders.cancelled.count, 1);
  assert.equal(s.orders.inProgress.count, 3); // matched, pending, test-payment confirmed (test order 15k excluded entirely)
  assert.equal(s.commission.outstandingLiability.som, 5000);
  assert.equal(s.commission.accruedInPeriod.som, 5000);
  assert.equal(s.commission.settlementTracking, 'NOT_IMPLEMENTED');
  assert.equal(s.deliveryConfirmation, 'IMPLEMENTED'); // Stage 6D
  // date filter: a window in the past sees none of it; bad input is a 400
  const past = (await get('/summary?from=2020-01-01&to=2020-01-31', tc)).json();
  assert.equal(past.orders.completed.count, 0);
  assert.equal(past.commission.accruedInPeriod.som, 0);
  assert.equal(past.commission.outstandingLiability.som, 5000); // liability is all-time
  assert.equal((await get('/summary?from=banana', tc)).statusCode, 400);
  assert.equal((await get('/summary?from=2020-01-01&to=2026-01-01', tc)).statusCode, 400);
  const filtered = (await get('/orders?status=completed&limit=100', tc)).json();
  assert.deepEqual(filtered.items.map((i: { number: number }) => i.number), [done.number]);
  assert.equal(filtered.items[0].commission.state, 'ACCRUED');
  assert.equal(filtered.items[0].payment.receivedSom, 30_000);
  const all = (await get('/orders?limit=100', tc)).json().items as Array<{ status: string; payment: { state: string; receivedSom: number }; commission: { state: string } }>;
  assert.equal(all.find(i => i.status === 'PAYMENT_MATCHED_UNVERIFIED')!.payment.receivedSom, 0);
  assert.equal(all.find(i => i.status === 'CANCELLED')!.commission.state, 'NOT_APPLICABLE');
  assert.equal(all.find(i => i.status === 'PAYMENT_PENDING')!.commission.state, 'PENDING_DELIVERY_CONFIRMATION');
  // pagination
  const p1 = (await get('/orders?limit=2', tc)).json();
  assert.equal(p1.items.length, 2);
  const p2 = (await get(`/orders?limit=2&cursor=${p1.nextCursor}`, tc)).json();
  assert.ok(p2.items.every((i: { number: number }) => i.number < p1.nextCursor));
});

test('refunds are shown by stage; a pending/confirmed refund never reduces received money or reverses a commission', async () => {
  const slug = `fin-d-${nonce}`;
  ids.d = (await db.restaurant.create({ data: { slug, name: 'Fin d' } })).id;
  await setRestaurantPassword({ slug, password: PW_B });
  const td = await loginToken(slug, PW_B);
  const mk = async (status: string, extra: Record<string, unknown> = {}) => {
    const o = await mkOrder({ restaurant: ids.d, som: 20_000 });
    return { o, r: await mkRefund(o.id, status, extra) };
  };
  await mk('REQUESTED');
  await mk('APPROVED');
  await mk('SENT');
  await mk('CONFIRMED', { confirmedBy: 'c', confirmedByType: 'CUSTOMER', confirmedAt: new Date() });
  await mk('CONFIRMED', { confirmedBy: 'a', confirmedByType: 'ADMIN', confirmedAt: new Date(), confirmNote: 'admin checked restaurant statement' });
  await mk('DISPUTED', { disputedAt: new Date() });
  await mk('REJECTED');
  const j = (await get('/refunds?limit=100', td)).json();
  const stages = j.items.map((i: { stage: string }) => i.stage).sort();
  assert.deepEqual(stages, ['APPROVED_AWAITING_SEND', 'CONFIRMED_BY_ADMIN', 'CONFIRMED_BY_CUSTOMER', 'DISPUTED', 'REJECTED', 'REQUESTED', 'SENT_UNCONFIRMED']);
  assert.ok(j.items.every((i: { bankVerified: boolean }) => i.bankVerified === false));
  assert.equal(j.totals.unresolved.count, 4);
  assert.equal(j.totals.unresolved.amountSom, 80_000);
  assert.equal(j.totals.confirmedByCustomer.count, 1);
  assert.equal(j.totals.confirmedByAdmin.count, 1);
  assert.equal((await get('/refunds?status=DISPUTED', td)).json().items.length, 1);
  assert.equal((await get('/refunds?status=bogus', td)).statusCode, 400);
  const s = (await get('/summary', td)).json();
  assert.equal(s.refunds.openNow.total.count, 4);
  assert.equal(s.refunds.openNow.disputed, 1);
  assert.equal(s.unresolved.refundsDisputed, 1);
  assert.equal(s.refunds.bankVerified, false);
  assert.equal(s.payments.verifiedReceived.som, 140_000); // 7 orders x 20,000 - refunds are shown, not netted
});

test('an accrued commission is never reversed by a later refund; it is flagged for policy review', async () => {
  const o = await mkOrder();
  await deliver(o.id, true);
  const before = await db.commissionEntry.findUniqueOrThrow({ where: { orderId: o.id } });
  await mkRefund(o.id, 'CONFIRMED', { confirmedBy: 'c', confirmedByType: 'CUSTOMER', confirmedAt: new Date() });
  const after = await db.commissionEntry.findUniqueOrThrow({ where: { orderId: o.id } });
  assert.equal(after.amountSom, before.amountSom);
  const c = (await get('/commissions?limit=100', ta)).json().items.find((i: { orderNumber: number }) => i.orderNumber === o.number);
  assert.equal(c.needsPolicyReview, true);
  assert.equal(c.refund.stage, 'CONFIRMED_BY_CUSTOMER');
  const s = (await get('/summary', ta)).json();
  assert.ok(s.unresolved.commissionedOrdersWithRefund >= 1);
});
