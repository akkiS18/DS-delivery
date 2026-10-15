import assert from 'node:assert/strict';

const base = `http://127.0.0.1:${process.env.PORT ?? 4000}`;
const key = process.env.INTERNAL_API_KEY;
if (!key) throw new Error('INTERNAL_API_KEY .env faylida bo‘lishi kerak');

async function api<T>(path: string, method = 'GET', body?: unknown, internal = false): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method, headers: { ...(internal ? { 'x-internal-api-key': key! } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} HTTP ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

type Restaurant = { id: string; slug: string };
type Product = { id: string; name: string };
type Order = { orderId: string; payment: { status: string; card: { last4: string } | null }; totalSom: number };

console.log('\n[SMOKE] DS Delivery backend integration test\n');
const health = await api<{ ok: boolean }>('/health');
assert.equal(health.ok, true);
console.log('[OK] /health');
const restaurants = await api<Restaurant[]>('/api/v1/restaurants');
const demo = restaurants.find(r => r.slug === 'demo-restoran');
assert(demo, 'npm run seed avval bajarilishi kerak');
const name = `Sinov taomi ${Date.now()}`;
const amountSom = 20_000 + (Date.now() % 10_000);
const product = await api<Product>(`/api/v1/internal/restaurants/${demo.id}/products`, 'POST', { name, priceSom: amountSom }, true);
console.log(`[OK] Taom: ${name} | ${amountSom} so‘m`);
const order = await api<Order>('/api/v1/internal/orders', 'POST', {
  restaurantId: demo.id, telegramUserId: '10000000001', addressText: 'Sinov manzili, 1-uy',
  paymentMode: 'MOCK', items: [{ productId: product.id, quantity: 1 }],
}, true);
assert.equal(order.totalSom, amountSom);
assert.equal(order.payment.card?.last4, '9099');
assert.equal(order.payment.status, 'AWAITING');
console.log(`[OK] Order created: ${order.orderId} | MOCK ***9099`);
const matched = await api<{ status: string }>('/api/v1/internal/payments/mock-incoming', 'POST', { amountSom, last4: '9099' }, true);
assert.equal(matched.status, 'MATCHED_UNVERIFIED');
const refreshed = await api<{ status: string; payment: { status: string } }>(`/api/v1/internal/orders/${order.orderId}`, 'GET', undefined, true);
assert.equal(refreshed.status, 'PAYMENT_MATCHED_UNVERIFIED');
assert.equal(refreshed.payment.status, 'MATCHED_UNVERIFIED');
console.log('[OK] Payment matched; Order status synchronized');
const unknown = await api<{ status: string; reason: string }>('/api/v1/internal/payments/mock-incoming', 'POST', { amountSom: amountSom + 13_000, last4: '9099' }, true);
assert.equal(unknown.status, 'REVIEW_REQUIRED');
assert.equal(unknown.reason, 'NO_ACTIVE_PAYMENT');
console.log('[OK] Unknown amount -> REVIEW_REQUIRED');
console.log('\n[PASS] REST API + PostgreSQL + PaymentService V3\n');
