import { db } from '../../lib/db.js';

/**
 * Sinov (demo) order: an administrator sends a fake order to a restaurant's own app so that the staff can SEE what a new order looks like and practise
 * the two taps ("Qabul qildim", "Tayyor"). Owner request 2026-11-06.
 *
 * What makes it safe:
 *  - It is an Order row with isDemo = true, status PREPARING and no payment at all: no money, no card, no incoming transaction, no commission,
 *    no refund, no taxi company (so no dispatch can exist). paymentIsTest is true as well, so every existing "real money only" query skips it.
 *  - Its two actions are handled HERE (applyDemoAction), never by takeStaffAction / the payment engine / the taxi scheduler.
 *  - Nothing is written to OrderEvent or any other history table, and the row is deleted by sweepDemoOrders (old, or a few minutes after "Tayyor").
 *  - Only one demo order per restaurant at a time: a new one replaces the old one.
 */
export const DEMO_MAX_AGE_MS = 30 * 60_000;
export const DEMO_AFTER_READY_MS = 5 * 60_000;
export const DEMO_DEFAULT_PREP_MINUTES = 20;
const DEMO_CUSTOMER_NAME = 'Sinov mijoz';
const DEMO_PHONE = '+998 00 000 00 00';
const DEMO_ADDRESS = 'SINOV buyurtma (haqiqiy emas) — Toshkent, Sinov ko‘chasi 1';

/** Used when the restaurant has no menu yet; real dish names make the demo look like the restaurant's own order. */
const FALLBACK_LINES = [
  { name: 'Sinov taomi', unitSom: 35_000, quantity: 2 },
  { name: 'Sinov ichimligi', unitSom: 8_000, quantity: 1 },
];

export type DemoCreated = { result: 'CREATED'; orderId: string; code: string; restaurantName: string; totalSom: number }
  | { result: 'NOT_FOUND' };

export async function createDemoOrder(restaurantId: string, now = new Date()): Promise<DemoCreated> {
  const restaurant = await db.restaurant.findUnique({ where: { id: restaurantId }, select: { id: true, name: true, slug: true } });
  if (!restaurant || restaurant.slug.startsWith('arxiv-')) return { result: 'NOT_FOUND' };

  const products = await db.product.findMany({
    where: { restaurantId, isAvailable: true, archivedAt: null, isPackaging: false, priceSom: { gt: 0 } },
    orderBy: { name: 'asc' }, take: 2, select: { id: true, name: true, priceSom: true },
  });
  const lines = products.length
    ? products.map((p, i) => ({ productId: p.id, name: p.name, unitSom: p.priceSom, quantity: i === 0 ? 2 : 1 }))
    : FALLBACK_LINES.map(l => ({ productId: null as string | null, ...l }));
  const totalSom = lines.reduce((sum, l) => sum + l.unitSom * l.quantity, 0);

  const existing = await db.customer.findFirst({ where: { displayName: DEMO_CUSTOMER_NAME, phone: DEMO_PHONE, telegramUserId: null }, select: { id: true } });
  const customerId = existing?.id ?? (await db.customer.create({ data: { displayName: DEMO_CUSTOMER_NAME, phone: DEMO_PHONE }, select: { id: true } })).id;

  return db.$transaction(async tx => {
    await tx.order.deleteMany({ where: { restaurantId, isDemo: true } }); // one demo order per restaurant
    const order = await tx.order.create({
      data: {
        restaurantId, customerId, phoneSnapshot: DEMO_PHONE, addressText: DEMO_ADDRESS, totalSom,
        createdViaBot: true, isDemo: true, paymentIsTest: true,
        // What a freshly paid real order looks like in the app: cooking has started by itself, the kitchen has not acknowledged it yet.
        status: 'PREPARING', preparingStartedAt: now, prepMinutes: DEMO_DEFAULT_PREP_MINUTES,
        items: { create: lines.map(l => ({ ...l, subtotalSom: l.unitSom * l.quantity })) },
      },
      select: { id: true, code: true },
    });
    return { result: 'CREATED' as const, orderId: order.id, code: order.code, restaurantName: restaurant.name, totalSom };
  });
}

export type DemoActionResult = 'OK' | 'STALE' | 'NOT_ALLOWED';

/**
 * "Qabul qildim" (SET_PREP_TIME) and "Tayyor" (MARK_READY) on a demo order. Compare-and-swap on the status; repeating a tap changes nothing.
 * Every other action is refused: there is no payment to verify, no money to refund and no taxi to call.
 */
export async function applyDemoAction(restaurantId: string, orderId: string, action: string, now = new Date()): Promise<DemoActionResult> {
  if (action === 'SET_PREP_TIME') {
    const r = await db.order.updateMany({
      where: { id: orderId, restaurantId, isDemo: true, status: 'PREPARING' },
      data: { prepChosenMinutes: DEMO_DEFAULT_PREP_MINUTES, prepChosenAt: now },
    });
    return r.count === 1 ? 'OK' : 'STALE';
  }
  if (action === 'MARK_READY') {
    const r = await db.order.updateMany({
      where: { id: orderId, restaurantId, isDemo: true, status: 'PREPARING' },
      data: { status: 'READY', readyAt: now, prepChosenMinutes: DEMO_DEFAULT_PREP_MINUTES },
    });
    if (r.count === 1) return 'OK';
    // A double tap or a retry after a lost answer: already READY is success.
    return (await db.order.count({ where: { id: orderId, restaurantId, isDemo: true, status: 'READY' } })) === 1 ? 'OK' : 'STALE';
  }
  return 'NOT_ALLOWED';
}

/** The actions the app may offer on a demo order (the same two a real cooking order has, minus cancel). */
export const demoAllowedActions = (status: string): Array<'SET_PREP_TIME' | 'MARK_READY'> => (status === 'PREPARING' ? ['SET_PREP_TIME', 'MARK_READY'] : []);

/** Deletes demo orders that are old, or that were marked ready a few minutes ago (the demo is over). Only rows with isDemo = true can match. */
export async function sweepDemoOrders(now = new Date()): Promise<number> {
  const r = await db.order.deleteMany({
    where: {
      isDemo: true,
      OR: [
        { createdAt: { lt: new Date(now.getTime() - DEMO_MAX_AGE_MS) } },
        { status: 'READY', readyAt: { lt: new Date(now.getTime() - DEMO_AFTER_READY_MS) } },
      ],
    },
  });
  return r.count;
}

/** The administrator ends the demo by hand: removes the restaurant's demo order now. */
export async function removeDemoOrders(restaurantId: string): Promise<number> {
  return (await db.order.deleteMany({ where: { restaurantId, isDemo: true } })).count;
}
