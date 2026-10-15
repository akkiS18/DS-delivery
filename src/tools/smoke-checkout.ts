import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db.js';

const base = `http://127.0.0.1:${process.env.PORT ?? 4000}`;
const key = process.env.INTERNAL_API_KEY;
if (!key) throw new Error('INTERNAL_API_KEY required');
async function api<T>(path: string, method = 'GET', body?: unknown, internal = false): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method, headers: { ...(internal ? { 'x-internal-api-key': key! } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const content = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${content}`);
  return JSON.parse(content) as T;
}

type Rest = { id: string; slug: string };
type Taxi = { id: string; name: string };
type Item = { id: string; priceSom: number };
type Checkout = { orderId: string; orderNumber: number; payment: { id: string; status: string; card: { last4: string } | null } };
console.log('[SMOKE CHECKOUT] DS Delivery BOT checkout integration');
const restaurants = await api<Rest[]>('/api/v1/restaurants');
const restaurant = restaurants.find(r => r.slug === 'demo-restoran');
assert(restaurant, 'npm run seed bajaring');
const taxis = await api<Taxi[]>('/api/v1/taxis');
const taxi = taxis.find(t => t.name === 'Sinov taksi (TEST)');
assert(taxi, 'npm run seed takror bajaring (sinov taksi yo‘q)');
const products = await db.product.findMany({ where: { restaurantId: restaurant.id, isAvailable: true }, select: { id: true, priceSom: true } });
assert(products.length > 0, 'Mahsulotlar mavjud emas');
const product: Item = products[0]!;
const totalSom = product.priceSom;
const checkoutKey = randomUUID();
const payload = {
  restaurantId: restaurant.id, telegramUserId: '10000000003', customerName: 'Sinov mijoz',
  phone: '+998901234567', addressText: 'Sinov manzili, 12-uy',
  taxiCompanyId: taxi.id, checkoutKey, createdViaBot: true, allowTaxiFallback: true,
  paymentMode: 'MOCK', items: [{ productId: product.id, quantity: 1 }],
};
try {
  const [first, concurrent] = await Promise.all([
    api<Checkout>('/api/v1/internal/orders', 'POST', payload, true),
    api<Checkout>('/api/v1/internal/orders', 'POST', payload, true),
  ]);
  assert.equal(concurrent.orderId, first.orderId, 'Concurrent submit duplicated order!');
  console.log('[OK] Concurrent double-submit idempotent');
  assert(first.orderId);
  assert(first.payment);
  console.log(`[OK] Order #${first.orderNumber}, payment=${first.payment.status}`);
  const second = await api<Checkout>('/api/v1/internal/orders', 'POST', payload, true);
  assert.equal(second.orderId, first.orderId, 'Retry duplicated order!');
  assert.equal(second.payment.id, first.payment.id, 'Retry duplicated payment!');
  console.log('[OK] Repeat checkout idempotent');
  const order = await db.order.findUniqueOrThrow({ where: { id: first.orderId } });
  assert.equal(order.phoneSnapshot, '+998901234567');
  assert.equal(order.taxiCompanyId, taxi.id);
  assert.equal(order.createdViaBot, true);
  assert.equal(order.allowTaxiFallback, true);
  console.log('[OK] Phone + taxi saved');
  if (first.payment.status === 'AWAITING' && first.payment.card?.last4) {
    const incoming = await api<{ status: string }>('/api/v1/internal/payments/mock-incoming', 'POST', {
      amountSom: totalSom, last4: first.payment.card.last4,
    }, true);
    assert.equal(incoming.status, 'MATCHED_UNVERIFIED');
    console.log('[OK] Mock incoming matched');
  } else {
    console.log('[INFO] Karta band: QUEUED (mavjud buyurtmalar yoki cooldown tufayli).');
  }
  console.log('[PASS] Checkout + taxi + idempotency');
} finally { await db.$disconnect(); }
