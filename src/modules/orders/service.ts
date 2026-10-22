import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import type { PaymentEngineV3 } from '../payment/engine.js';
import { eligibleCompanyWhere } from '../taxi/assignment.js';
import { openState } from '../restaurant-operations/hours.js';
import { acceptanceRequired, responseTimeoutMs } from '../restaurant/acceptance.js';

export const orderSchema = z.object({
  restaurantId: z.string().min(1),
  /** Exactly one of telegramUserId / customerId identifies the buyer. customerId is the internal id of an Android guest session (never client input). */
  telegramUserId: z.string().regex(/^\d{1,20}$/).optional(),
  customerId: z.string().min(1).max(64).optional(),
  customerName: z.string().trim().max(100).optional(),
  phone: z.string().regex(/^\+998\d{9}$/).optional(),
  addressText: z.string().trim().min(3).max(500),
  deliveryLat: z.number().min(-90).max(90).optional(),
  deliveryLng: z.number().min(-180).max(180).optional(),
  taxiCompanyId: z.string().min(1).optional(),
  /** Customer does not choose a taxi company: the server assigns one at dispatch (and may fall back to another if one declines). */
  autoTaxi: z.boolean().default(false),
  checkoutKey: z.string().uuid().optional(),
  createdViaBot: z.boolean().default(false),
  allowTaxiFallback: z.boolean().default(false),
  items: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(30) })).min(1).max(20),
  paymentMode: z.enum(['MOCK', 'REAL']).default('MOCK'),
  /** What the customer saw. A mismatch refuses the order (409 NARX_OZGARGAN) instead of charging a different amount. */
  expectedTotalSom: z.number().int().min(0).max(100_000_000).optional(),
  expectedUnitPrices: z.record(z.string(), z.number().int().min(0)).optional(),
}).refine(x => (x.telegramUserId === undefined) !== (x.customerId === undefined), {
  message: 'Xaridor aniqlanmadi.',
}).refine(x => (x.deliveryLat === undefined) === (x.deliveryLng === undefined), {
  message: 'Lat/lng ikkalasi birga berilishi kerak.',
}).refine(x => !x.createdViaBot || (Boolean(x.phone) && (Boolean(x.taxiCompanyId) || x.autoTaxi) && Boolean(x.checkoutKey)), {
  message: 'Bot buyurtmasi uchun telefon, taksi (yoki avtomatik tayinlash) va checkoutKey kerak.',
});

export type PlaceOrderInput = z.input<typeof orderSchema>;

/** A checkout refusal the client can act on (statusCode is honoured by the HTTP error handler; `details` is returned). */
/** Open (unpaid) orders one customer may hold at once. REAL defaults to 2; MOCK is unlimited unless MAX_OPEN_UNPAID_ORDERS is set. 0 = no limit. */
export function maxOpenUnpaidOrders(mode: 'MOCK' | 'REAL', env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MAX_OPEN_UNPAID_ORDERS?.trim();
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= 20 ? n : (mode === 'REAL' ? 2 : 0);
  }
  return mode === 'REAL' ? 2 : 0;
}

export class CheckoutError extends Error {
  constructor(code: string, readonly statusCode: number, readonly details?: unknown) { super(code); }
}

export type CheckoutLine = { productId: string; name: string; unitSom: number; quantity: number; subtotalSom: number };
export type CheckoutIssue =
  | { kind: 'RESTAURANT_UNAVAILABLE' }
  | { kind: 'RESTAURANT_CLOSED'; opensNext: { dayOffset: number; dayOfWeek: number; time: string } | null }
  | { kind: 'PRODUCT_UNAVAILABLE'; productId: string }
  | { kind: 'PRICE_CHANGED'; productId: string; name: string; expectedUnitSom: number; currentUnitSom: number }
  | { kind: 'TOTAL_CHANGED'; expectedTotalSom: number; currentTotalSom: number }
  | { kind: 'TOTAL_TOO_LARGE' };

type Tx = Prisma.TransactionClient | typeof db;

/** Guest buyer: a shared row lock makes a concurrent guest->Telegram merge finish first; if the guest was merged away the order goes to the surviving profile. */
async function guestCustomer(tx: Prisma.TransactionClient, customerId: string, data: { customerName?: string | undefined; phone?: string | undefined }) {
  const rows = await tx.$queryRaw<Array<{ id: string; mergedIntoId: string | null }>>`SELECT "id", "mergedIntoId" FROM "Customer" WHERE "id" = ${customerId} FOR SHARE`;
  if (!rows[0]) throw new Error('XARIDOR_TOPILMADI');
  return tx.customer.update({
    where: { id: rows[0].mergedIntoId ?? rows[0].id },
    data: { ...(data.customerName ? { displayName: data.customerName } : {}), ...(data.phone ? { phone: data.phone } : {}) },
  });
}

/**
 * Server-side checkout validation, shared by order creation and by the quote the Mini App will call before payment:
 * restaurant active and not paused, every product of THIS restaurant and available, prices read from the database (never
 * from the client), and - when the client says what it showed the customer - those prices/total still being current.
 * Pure read; creates nothing.
 */
export async function validateCheckout(tx: Tx, input: {
  restaurantId: string; items: Array<{ productId: string; quantity: number }>;
  expectedTotalSom?: number | undefined; expectedUnitPrices?: Record<string, number> | undefined;
}): Promise<{ ok: true; lines: CheckoutLine[]; totalSom: number; restaurant: { defaultPrepMinutes: number; pickupAddress: string | null } }
  | { ok: false; issues: CheckoutIssue[]; lines: CheckoutLine[]; totalSom: number }> {
  const amounts = new Map<string, number>();
  for (const i of input.items) amounts.set(i.productId, (amounts.get(i.productId) ?? 0) + i.quantity);
  const restaurant = await tx.restaurant.findUnique({ where: { id: input.restaurantId }, select: { isActive: true, isPaused: true, defaultPrepMinutes: true, pickupAddress: true, workingHours: true, timezone: true } });
  if (!restaurant?.isActive || restaurant.isPaused) return { ok: false, issues: [{ kind: 'RESTAURANT_UNAVAILABLE' }], lines: [], totalSom: 0 };
  // Stage 7A: new checkouts respect the configured working hours, in the restaurant's own time zone.
  const hours = openState(restaurant);
  if (!hours.open) return { ok: false, issues: [{ kind: 'RESTAURANT_CLOSED', opensNext: hours.opensNext }], lines: [], totalSom: 0 };
  const products = await tx.product.findMany({ where: { id: { in: [...amounts.keys()] }, restaurantId: input.restaurantId, isAvailable: true, archivedAt: null } });
  const found = new Map(products.map(p => [p.id, p]));
  const issues: CheckoutIssue[] = [];
  for (const id of amounts.keys()) if (!found.has(id)) issues.push({ kind: 'PRODUCT_UNAVAILABLE', productId: id });
  const lines: CheckoutLine[] = products.map(p => {
    const quantity = amounts.get(p.id)!;
    return { productId: p.id, name: p.name, unitSom: p.priceSom, quantity, subtotalSom: p.priceSom * quantity };
  });
  const totalSom = lines.reduce((sum, item) => sum + item.subtotalSom, 0);
  if (!Number.isSafeInteger(totalSom) || totalSom > 100_000_000) issues.push({ kind: 'TOTAL_TOO_LARGE' });
  for (const l of lines) {
    const expected = input.expectedUnitPrices?.[l.productId];
    if (expected !== undefined && expected !== l.unitSom) {
      issues.push({ kind: 'PRICE_CHANGED', productId: l.productId, name: l.name, expectedUnitSom: expected, currentUnitSom: l.unitSom });
    }
  }
  if (input.expectedTotalSom !== undefined && input.expectedTotalSom !== totalSom && issues.every(i => i.kind !== 'PRODUCT_UNAVAILABLE')) {
    issues.push({ kind: 'TOTAL_CHANGED', expectedTotalSom: input.expectedTotalSom, currentTotalSom: totalSom });
  }
  return issues.length ? { ok: false, issues, lines, totalSom } : { ok: true, lines, totalSom, restaurant };
}

/** Maps validation issues onto the error codes the existing callers and the HTTP handler already understand. */
export function checkoutErrorFor(issues: CheckoutIssue[], lines: CheckoutLine[], totalSom: number): CheckoutError {
  if (issues.some(i => i.kind === 'RESTAURANT_UNAVAILABLE')) return new CheckoutError('RESTORAN_BUYURTMA_QABUL_QILMAYDI', 409);
  if (issues.some(i => i.kind === 'RESTAURANT_CLOSED')) return new CheckoutError('RESTORAN_YOPIQ', 409, { issues });
  if (issues.some(i => i.kind === 'PRODUCT_UNAVAILABLE')) return new CheckoutError('MAHSULOT_MAVJUD_EMAS', 409, { issues });
  if (issues.some(i => i.kind === 'TOTAL_TOO_LARGE')) return new CheckoutError('BUYURTMA_SUMMASI_JUDA_KATTA', 400);
  return new CheckoutError('NARX_OZGARGAN', 409, { issues, currentLines: lines, currentTotalSom: totalSom });
}
type PlaceOrderData = z.output<typeof orderSchema>;

export function paymentView(p: {
  id: string; number: number; status: string; amountTiyin: bigint;
  card: { last4: string; label: string; isTest: boolean } | null; expiresAt: Date | null;
} | null) {
  return p ? {
    id: p.id, number: p.number, status: p.status,
    amountSom: Number(p.amountTiyin / 100n),
    card: p.card && { last4: p.card.last4, label: p.card.label, isTest: p.card.isTest },
    expiresAt: p.expiresAt,
  } : null;
}

export async function orderDetails(orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      customer: { select: { telegramUserId: true } },
      restaurant: { select: { name: true } },
      taxiCompany: { select: { name: true } },
      items: { where: { supersededAt: null }, select: { name: true, unitSom: true, quantity: true, subtotalSom: true } },
      payment: { include: { card: true } },
    },
  });
  if (!order) return null;
  return {
    id: order.id, number: order.number, status: order.status,
    totalSom: order.totalSom, addressText: order.addressText,
    phone: order.phoneSnapshot, customerTelegramUserId: order.customer.telegramUserId,
    restaurantName: order.restaurant.name, taxiCompanyName: order.taxiCompany?.name ?? null,
    items: order.items, payment: paymentView(order.payment),
  };
}

function hasUniqueConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function placeOrder(engine: PaymentEngineV3, input: PlaceOrderInput) {
  const data: PlaceOrderData = orderSchema.parse(input);
  if (process.env.NODE_ENV === 'production' && data.paymentMode === 'MOCK') {
    const error = new Error('Mock payments disabled in production') as Error & { statusCode: number };
    error.statusCode = 403;
    throw error;
  }
  // REAL orders are Telegram-originated only (the customer bot / the Telegram Mini App): the whole payment and dispatch chain is
  // keyed to a Telegram customer identity. `createdViaBot` therefore means "created through the Telegram customer channel".
  if (data.paymentMode === 'REAL' && !data.createdViaBot) {
    const error = new Error('REAL orders can only be created through the Telegram bot') as Error & { statusCode: number };
    error.statusCode = 422;
    throw error;
  }
  const amounts = new Map<string, number>();
  for (const i of data.items) amounts.set(i.productId, (amounts.get(i.productId) ?? 0) + i.quantity);
  if ([...amounts.values()].some(quantity => quantity > 30)) {
    const error = new Error('Too many units per product') as Error & { statusCode: number };
    error.statusCode = 400;
    throw error;
  }

  // A double-tap or retried callback must not create a second order/payment.
  async function previouslyCreated() {
    if (!data.checkoutKey) return null;
    const existing = await db.order.findUnique({ where: { checkoutKey: data.checkoutKey }, include: { customer: true } });
    if (!existing) return null;
    if (data.customerId ? existing.customerId !== data.customerId : existing.customer.telegramUserId !== data.telegramUserId) {
      throw new Error('CHECKOUT_KEY_BEGONA');
    }
    return orderDetails(existing.id);
  }
  const existing = await previouslyCreated();
  if (existing) return existing;

  // Stage 6F: the order is created already validated; unless the legacy manual-acceptance flag is on there is no waiting
  // state. It starts as PAYMENT_PENDING with its single payment attempt, created under the payment lock. NOT paid yet.
  const waiting = acceptanceRequired(data.paymentMode);
  const deadline = waiting ? new Date(Date.now() + responseTimeoutMs()) : null;
  try {
    const buildOrder = async (tx: Prisma.TransactionClient) => {
      if (data.checkoutKey) {
        const found = await tx.order.findUnique({ where: { checkoutKey: data.checkoutKey } });
        if (found) throw new Error('CHECKOUT_ALREADY_CREATED');
      }
      const checked = await validateCheckout(tx, data);
      if (!checked.ok) throw checkoutErrorFor(checked.issues, checked.lines, checked.totalSom);
      // New flow only: the order is payable immediately, so a REAL order must already be dispatchable. (The legacy accept-first flow
      // keeps its old behaviour: the restaurant sets the pickup address before accepting.)
      if (!waiting && data.paymentMode === 'REAL' && !checked.restaurant.pickupAddress?.trim()) throw new CheckoutError('RESTORAN_OLIB_KETISH_MANZILI_YOQ', 409);
      if (!data.taxiCompanyId && data.autoTaxi) {
        // Automatic assignment needs at least one company that can be booked right now, otherwise the order would stall after payment.
        if (!(await tx.taxiCompany.findFirst({ where: eligibleCompanyWhere(), select: { id: true } }))) throw new CheckoutError('TAKSI_XIZMATI_MAVJUD_EMAS', 409);
      }
      if (data.taxiCompanyId) {
        const taxi = await tx.taxiCompany.findUnique({ where: { id: data.taxiCompanyId } });
        if (!taxi?.isActive) throw new Error('TAKSI_XIZMATI_MAVJUD_EMAS');
        if (data.paymentMode === 'REAL' && !taxi.operatorTelegramUserId) throw new Error('TAKSI_OPERATOR_BIRIKTIRILMAGAN');
      }
      const { lines, totalSom } = checked; // prices below are the frozen, server-read snapshot
      const customer = data.customerId
        ? await guestCustomer(tx, data.customerId, data)
        : await tx.customer.upsert({
          where: { telegramUserId: data.telegramUserId! },
          create: { telegramUserId: data.telegramUserId!, displayName: data.customerName, phone: data.phone },
          update: {
            ...(data.customerName ? { displayName: data.customerName } : {}),
            ...(data.phone ? { phone: data.phone } : {}),
          },
        });
      // Stage 8C: every unpaid REAL order holds one (card, amount) slot for up to the payment window; with 3-4 cards a few open orders
      // from one customer could block everybody else. Expired attempts were already swept (engine.createCheckout runs expireWithin first).
      const openLimit = maxOpenUnpaidOrders(data.paymentMode);
      if (openLimit > 0) {
        const open = await tx.order.count({
          where: { customerId: customer.id, status: { in: ['PAYMENT_PENDING', 'WAITING_RESTAURANT'] }, paymentIsTest: data.paymentMode === 'MOCK' },
        });
        if (open >= openLimit) throw new CheckoutError('KOP_TOLANMAGAN_BUYURTMA', 429);
      }
      return tx.order.create({
        data: {
          restaurantId: data.restaurantId, customerId: customer.id,
          addressText: data.addressText,
          deliveryLat: data.deliveryLat, deliveryLng: data.deliveryLng,
          phoneSnapshot: data.phone, taxiCompanyId: data.taxiCompanyId,
          checkoutKey: data.checkoutKey, createdViaBot: data.createdViaBot,
          allowTaxiFallback: data.allowTaxiFallback || data.autoTaxi, // automatic assignment implies trying another company when one declines
          totalSom, status: waiting ? 'WAITING_RESTAURANT' : 'PAYMENT_PENDING', items: { create: lines },
          paymentIsTest: data.paymentMode === 'MOCK', restaurantDeadlineAt: deadline,
          // The preparation time the customer is told at checkout; cooking later reuses exactly this value.
          ...(waiting ? {} : { estimatedPrepMinutes: checked.restaurant.defaultPrepMinutes }),
        },
      });
    };
    if (waiting) {
      const order = await db.$transaction(async tx => {
        const created = await buildOrder(tx);
        await tx.orderEvent.create({ data: {
          orderId: created.id, actorTelegramId: data.telegramUserId ?? `guest:${data.customerId}`, actorType: 'CUSTOMER', action: 'PLACED',
          fromStatus: 'WAITING_RESTAURANT', toStatus: 'WAITING_RESTAURANT',
          details: { totalSom: created.totalSom, deadline: deadline!.toISOString() },
        } });
        return created;
      });
      return orderDetails(order.id);
    }
    const { order } = await engine.createCheckout(buildOrder, data.paymentMode === 'MOCK');
    return orderDetails(order.id);
  } catch (error) {
    if ((hasUniqueConstraint(error) || (error instanceof Error && error.message === 'CHECKOUT_ALREADY_CREATED')) && data.checkoutKey) {
      const retried = await previouslyCreated();
      if (retried) return retried;
    }
    throw error;
  }
}
