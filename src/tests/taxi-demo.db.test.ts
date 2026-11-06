import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { PaymentEngineV3, defaultOptions } from '../modules/payment/engine.js';
import { createTaxiDemoRequest, DEMO_TAXI_MAX_AGE_MS, removeTaxiDemoRequest, sweepTaxiDemoRequests } from '../modules/taxi-app/demo.js';
import { setTaxiCredential, taxiAttemptKey } from '../modules/taxi-app/auth.js';
import { db as appDb } from '../lib/db.js';

// Admin "sinov" request for a taxi operator (needs the migration 20261114000100_demo_orders): shown in the DS Taxi app, the taps work,
// and no dispatch, order, history row or other company is touched.
process.env.RESTAURANT_LOGIN_MAX_FAILURES = '50';
process.env.RESTAURANT_LOGIN_IP_MAX_FAILURES = '1000';
const db = new PrismaClient();
const engine = new PaymentEngineV3(db, defaultOptions, () => {});
const app = buildApp(engine);
const nonce = randomUUID().slice(0, 8);
const password = `Taksi-${randomUUID()}`;
const loginA = `demo-taxi-${nonce}`;
const loginB = `demo-other-${nonce}`;
const ips: string[] = [];
let companyA = '';
let companyB = '';
let tokenA = '';
let tokenB = '';

const ip = () => { const v = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`; ips.push(v); return v; };
async function login(companyId: string, name: string): Promise<string> {
  await setTaxiCredential({ companyId, login: name, password });
  const r = await app.inject({ method: 'POST', url: '/api/v1/taxi/auth/login', payload: { login: name, password }, remoteAddress: ip() });
  assert.equal(r.statusCode, 200);
  return r.json().accessToken;
}
const call = (token: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1/taxi${url}`, payload: payload as object | undefined, headers: { authorization: `Bearer ${token}` } });

before(async () => {
  await db.$connect();
  companyA = (await db.taxiCompany.create({ data: { name: `Demo Taxi A ${nonce}`, isActive: true } })).id;
  companyB = (await db.taxiCompany.create({ data: { name: `Demo Taxi B ${nonce}`, isActive: true } })).id;
  tokenA = await login(companyA, loginA);
  tokenB = await login(companyB, loginB);
});
after(async () => {
  const ids = [companyA, companyB];
  await db.taxiSession.deleteMany({ where: { taxiCompanyId: { in: ids } } });
  await db.taxiCredential.deleteMany({ where: { taxiCompanyId: { in: ids } } });
  await db.restaurantLoginAttempt.deleteMany({ where: { keyHash: { in: [loginA, loginB].map(l => taxiAttemptKey('login', l)).concat(ips.map(i => taxiAttemptKey('ip', i))) } } });
  await db.taxiCompany.deleteMany({ where: { id: { in: ids } } }); // a leftover demo request goes with its company (cascade)
  await app.close();
  await db.$disconnect();
  await appDb.$disconnect();
});

test('the operator sees a fake request, walks it through, and nothing real is touched', async () => {
  const created = await createTaxiDemoRequest(companyA, true);
  assert.equal(created.result, 'CREATED');
  if (created.result !== 'CREATED') return;
  // scoped to this company: other test files run at the same time and create their own rows
  assert.equal(await db.taxiDispatch.count({ where: { taxiCompanyId: companyA } }), 0, 'not a dispatch: no worker can pick it up');
  assert.equal(await db.order.count({ where: { taxiCompanyId: companyA } }), 0, 'no order either');

  const list = (await call(tokenA, 'GET', '/requests')).json();
  const v = list.active.find((x: { id: string }) => x.id === created.id);
  assert.ok(v, 'shown in the active list');
  assert.equal(v.status, 'REQUESTED');
  assert.equal(v.attention, true, 'rings like a new request');
  assert.equal(v.isTest, true);
  assert.equal(v.payment.method, 'CASH');
  assert.deepEqual(v.actions, ['ACCEPT', 'NO_TAXI']);
  assert.equal(list.history.some((x: { id: string }) => x.id === created.id), false);

  const act = (action: string) => call(tokenA, 'POST', `/requests/${created.id}/action`, { action });
  assert.equal((await act('DELIVERED')).json().changed, false, 'cannot deliver before a driver was sent');
  assert.equal((await act('SENT')).json().changed, false, 'cannot send before accepting');
  const taps = await Promise.all(Array.from({ length: 4 }, () => act('ACCEPT')));
  assert.equal(taps.filter(t => t.json().changed).length, 1, 'concurrent taps: exactly one wins');
  assert.equal((await call(tokenA, 'GET', `/requests/${created.id}`)).json().request.status, 'ACCEPTED');
  assert.equal((await act('SENT')).json().request.status, 'ASSIGNED');
  const done = (await act('DELIVERED')).json();
  assert.equal(done.changed, true);
  assert.equal(done.request.status, 'DELIVERED');
  assert.equal(await db.taxiDemoRequest.count({ where: { taxiCompanyId: companyA } }), 0, 'finished: deleted at once, nothing stays in a history list');
  assert.equal((await call(tokenA, 'GET', `/requests/${created.id}`)).statusCode, 404);
  assert.equal(await db.orderEvent.count({ where: { order: { taxiCompanyId: companyA } } }), 0, 'nothing written to any order history');
  assert.equal(await db.taxiDispatch.count({ where: { taxiCompanyId: companyA } }), 0);
});

test('"no taxi" ends it, a new one replaces the old one, another company cannot touch it, the sweep removes old ones', async () => {
  const a = await createTaxiDemoRequest(companyA, false);
  assert.equal(a.result, 'CREATED');
  if (a.result !== 'CREATED') return;
  assert.equal((await call(tokenA, 'GET', '/requests')).json().active.find((x: { id: string }) => x.id === a.id).payment.method, 'CARD');
  const b = await createTaxiDemoRequest(companyA, false);
  assert.equal(b.result, 'CREATED');
  assert.equal(await db.taxiDemoRequest.count({ where: { taxiCompanyId: companyA } }), 1, 'one per company');
  if (b.result !== 'CREATED') return;

  assert.equal((await call(tokenB, 'POST', `/requests/${b.id}/action`, { action: 'NO_TAXI' })).statusCode, 404, 'another company sees it as missing');
  assert.equal((await call(tokenB, 'GET', '/requests')).json().active.length, 0, 'and does not list it');
  assert.equal((await db.taxiDemoRequest.findUniqueOrThrow({ where: { id: b.id } })).status, 'REQUESTED');

  const no = (await call(tokenA, 'POST', `/requests/${b.id}/action`, { action: 'NO_TAXI' })).json();
  assert.equal(no.request.status, 'DECLINED');
  assert.equal(await db.taxiDemoRequest.count({ where: { taxiCompanyId: companyA } }), 0);

  assert.equal((await createTaxiDemoRequest(companyA, false)).result, 'CREATED');
  const now = new Date();
  await db.taxiDemoRequest.updateMany({ where: { taxiCompanyId: companyA }, data: { createdAt: new Date(now.getTime() - DEMO_TAXI_MAX_AGE_MS - 60_000) } });
  assert.equal((await call(tokenA, 'GET', '/requests')).json().active.length, 0, 'an old one is not shown even before the sweep');
  assert.ok(await sweepTaxiDemoRequests(now) >= 1);
  assert.equal(await removeTaxiDemoRequest(companyA), 0);
  assert.equal((await createTaxiDemoRequest('no-such-company', false)).result, 'NOT_FOUND');
});
