import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import type { PaymentEngineV3 } from '../payment/engine.js';
import { eligibleCompanyWhere } from '../taxi/assignment.js';
import { openState } from '../restaurant-operations/hours.js';
import { acceptanceRequired, responseTimeoutMs } from '../restaurant/acceptance.js';
import { realPaymentsGateActive, realPaymentsOpen } from '../platform/settings.js';
import { CASH_ACCEPTED, CASH_ACTIVE_LIMIT, CASH_PENDING, cashEnabled, loadCashMaxOrderSom } from '../payment/method.js';
import { usableCardCount } from '../payment/pool.js';
import { orderVerdict } from '../customer-strikes/service.js';
import { loadFeeConfig } from '../pricing/config.js';
import { feeRuleCode, priceBasket, publicPricing, type PublicPricing } from '../pricing/fee.js';
import { freeUnits, packagingUnits, type PromoDef } from '../promotions/rules.js';

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
  /** CARD: transfer to the restaurant card (matched from the bank e-mail). CASH: the customer pays the taxi driver on delivery; the restaurant must accept the order first. */
  paymentMethod: z.enum(['CARD', 'CASH']).default('CARD'),
  /** TAXI (default): delivered by taxi. WALK_OK: "my home is close, the restaurant may bring it on foot": only a wish, the restaurant decides at "Tayyor". */
  deliveryPreference: z.enum(['TAXI', 'WALK_OK']).default('TAXI'),
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

/**
 * unitSom/subtotalSom are what the CUSTOMER pays (service fee included when one applies); baseUnitSom is the restaurant's own menu price.
 * free = the free unit(s) of a 1+1 promotion (priced 0, same productId as the paid line); packaging = the dish's packaging line the server added.
 */
export type CheckoutLine = { productId: string; name: string; unitSom: number; baseUnitSom: number; quantity: number; subtotalSom: number; free?: boolean; packaging?: boolean };
/** The platform's share baked into the prices; ruleCode null = legacy flat commission (nothing was added to the customer's price). promoDiscountSom = menu value of the free units. */
export type CheckoutFee = { baseTotalSom: number; feeSom: number; ruleCode: string | null; pricing?: PublicPricing; promoDiscountSom?: number };
export type CheckoutIssue =
  | { kind: 'RESTAURANT_UNAVAILABLE' }
  | { kind: 'RESTAURANT_CLOSED'; opensNext: { dayOffset: number; dayOfWeek: number; time: string } | null }
  | { kind: 'PRODUCT_UNAVAILABLE'; productId: string }
  | { kind: 'PRICE_CHANGED'; productId: string; name: string; expectedUnitSom: number; currentUnitSom: number }
  | { kind: 'TOTAL_CHANGED'; expectedTotalSom: number; currentTotalSom: number }
  | { kind: 'TOTAL_TOO_LARGE' };

type Tx = Prisma.TransactionClient | typeof db;
const NO_FEE: CheckoutFee = { baseTotalSom: 0, feeSom: 0, ruleCode: null };

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
}): Promise<{ ok: true; lines: CheckoutLine[]; totalSom: number; fee: CheckoutFee; restaurant: { defaultPrepMinutes: number; pickupAddress: string | null; walkingDeliveryEnabled: boolean } }
  | { ok: false; issues: CheckoutIssue[]; lines: CheckoutLine[]; totalSom: number; fee: CheckoutFee }> {
  const amounts = new Map<string, number>();
  for (const i of input.items) amounts.set(i.productId, (amounts.get(i.productId) ?? 0) + i.quantity);
  const restaurant = await tx.restaurant.findUnique({ where: { id: input.restaurantId }, select: { isActive: true, isPaused: true, defaultPrepMinutes: true, pickupAddress: true, workingHours: true, timezone: true, walkingDeliveryEnabled: true } });
  if (!restaurant?.isActive || restaurant.isPaused) return { ok: false, issues: [{ kind: 'RESTAURANT_UNAVAILABLE' }], lines: [], totalSom: 0, fee: NO_FEE };
  // Stage 7A: new checkouts respect the configured working hours, in the restaurant's own time zone.
  const hours = openState(restaurant);
  if (!hours.open) return { ok: false, issues: [{ kind: 'RESTAURANT_CLOSED', opensNext: hours.opensNext }], lines: [], totalSom: 0, fee: NO_FEE };
  const products = await tx.product.findMany({ where: { id: { in: [...amounts.keys()] }, restaurantId: input.restaurantId, isAvailable: true, archivedAt: null } });
  const found = new Map(products.map(p => [p.id, p]));
  const issues: CheckoutIssue[] = [];
  for (const id of amounts.keys()) if (!found.has(id)) issues.push({ kind: 'PRODUCT_UNAVAILABLE', productId: id });
  // Packaging ("soboy idishi") is never ordered on its own: whatever the client sent for it is ignored and the server adds one unit per unit of each dish that has packaging.
  // A packaging product that is switched off or archived is simply not added (the dish can still be ordered).
  const dishes = products.filter(p => !p.isPackaging);
  // A basket of nothing but packaging is not an order.
  if (dishes.length === 0 && issues.length === 0) for (const id of amounts.keys()) issues.push({ kind: 'PRODUCT_UNAVAILABLE', productId: id });
  const packNeeded = packagingUnits(dishes.map(p => ({ quantity: amounts.get(p.id)!, packagingProductId: p.packagingProductId })));
  const packRows = packNeeded.size
    ? await tx.product.findMany({ where: { id: { in: [...packNeeded.keys()] }, restaurantId: input.restaurantId, isAvailable: true, archivedAt: null, isPackaging: true } })
    : [];
  // 1+1: the cheaper unit of every pair of a promotion's products is free (a line priced 0 next to the paid one). The restaurant bears it.
  const promos = await loadActivePromotions(tx, input.restaurantId);
  const free = promos.length ? freeUnits(dishes.map(p => ({ productId: p.id, baseUnitSom: p.priceSom, quantity: amounts.get(p.id)! })), promos) : new Map<string, number>();
  const freeCount = [...free.values()].reduce((s, n) => s + n, 0);
  // The platform fee is part of the price the customer pays: computed here from the restaurant's own prices and the current fee mode, never from the client.
  const cfgNow = await loadFeeConfig(tx);
  // An order with a free unit carries no platform line: it is shown crossed out as a discount (owner decision 2026-11-01).
  const cfg = freeCount > 0 && cfgNow.mode === 'LINE' && !cfgNow.lineWaived ? { ...cfgNow, lineWaived: true } : cfgNow;
  const paid = [
    ...dishes.map(p => ({ productId: p.id, name: p.name, baseUnitSom: p.priceSom, quantity: amounts.get(p.id)! - (free.get(p.id) ?? 0), packaging: false })).filter(l => l.quantity > 0),
    ...packRows.map(p => ({ productId: p.id, name: p.name, baseUnitSom: p.priceSom, quantity: packNeeded.get(p.id)!, packaging: true })),
  ];
  const priced = priceBasket(paid, cfg);
  const lines: CheckoutLine[] = priced.lines.map(l => ({ productId: l.productId, name: l.name, unitSom: l.unitSom, baseUnitSom: l.baseUnitSom, quantity: l.quantity, subtotalSom: l.subtotalSom, ...(l.packaging ? { packaging: true } : {}) }));
  let promoDiscountSom = 0;
  for (const p of dishes) {
    const n = free.get(p.id) ?? 0;
    if (n > 0) { lines.push({ productId: p.id, name: `${p.name} (1+1, bepul)`, unitSom: 0, baseUnitSom: 0, quantity: n, subtotalSom: 0, free: true }); promoDiscountSom += n * p.priceSom; }
  }
  const totalSom = priced.totalSom;
  const fee: CheckoutFee = { baseTotalSom: priced.baseTotalSom, feeSom: priced.feeSom, ruleCode: feeRuleCode(cfg), pricing: publicPricing(cfgNow), promoDiscountSom };
  if (!Number.isSafeInteger(totalSom) || totalSom > 100_000_000) issues.push({ kind: 'TOTAL_TOO_LARGE' });
  for (const l of lines) {
    if (l.free || l.packaging) continue; // the app does not send prices for these: it derives them from the dish
    const expected = input.expectedUnitPrices?.[l.productId];
    if (expected !== undefined && expected !== l.unitSom) {
      issues.push({ kind: 'PRICE_CHANGED', productId: l.productId, name: l.name, expectedUnitSom: expected, currentUnitSom: l.unitSom });
    }
  }
  if (input.expectedTotalSom !== undefined && input.expectedTotalSom !== totalSom && issues.every(i => i.kind !== 'PRODUCT_UNAVAILABLE')) {
    issues.push({ kind: 'TOTAL_CHANGED', expectedTotalSom: input.expectedTotalSom, currentTotalSom: totalSom });
  }
  return issues.length ? { ok: false, issues, lines, totalSom, fee } : { ok: true, lines, totalSom, fee, restaurant };
}

/** The restaurant's switched-on promotions with the products they cover. */
async function loadActivePromotions(tx: Tx, restaurantId: string): Promise<PromoDef[]> {
  const rows = await tx.promotion.findMany({ where: { restaurantId, isActive: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, maxFreePerOrder: true, products: { select: { productId: true } } } });
  return rows.map(r => ({ id: r.id, maxFreePerOrder: r.maxFreePerOrder, productIds: r.products.map(p => p.productId) }));
}

/** Maps validation issues onto the error codes the existing callers and the HTTP handler already understand. */
export function checkoutErrorFor(issues: CheckoutIssue[], lines: CheckoutLine[], totalSom: number, pricing?: PublicPricing): CheckoutError {
  if (issues.some(i => i.kind === 'RESTAURANT_UNAVAILABLE')) return new CheckoutError('RESTORAN_BUYURTMA_QABUL_QILMAYDI', 409);
  if (issues.some(i => i.kind === 'RESTAURANT_CLOSED')) return new CheckoutError('RESTORAN_YOPIQ', 409, { issues });
  if (issues.some(i => i.kind === 'PRODUCT_UNAVAILABLE')) return new CheckoutError('MAHSULOT_MAVJUD_EMAS', 409, { issues });
  if (issues.some(i => i.kind === 'TOTAL_TOO_LARGE')) return new CheckoutError('BUYURTMA_SUMMASI_JUDA_KATTA', 400);
  // `pricing` lets the app re-price with the model the server uses right now (the platform may have switched it since the cart was built).
  return new CheckoutError('NARX_OZGARGAN', 409, { issues, currentLines: lines, currentTotalSom: totalSom, ...(pricing ? { pricing } : {}) });
}
type PlaceOrderData = z.output<typeof orderSchema>;

export function paymentView(p: {
  id: string; number: number; status: string; amountTiyin: bigint; method?: string;
  card: { last4: string; label: string; isTest: boolean } | null; expiresAt: Date | null;
} | null) {
  return p ? {
    id: p.id, number: p.number, status: p.status, method: p.method ?? 'CARD',
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
    id: order.id, number: order.number, code: order.code, status: order.status,
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
  const isCash = data.paymentMethod === 'CASH';
  const waiting = acceptanceRequired(data.paymentMode);
  if (isCash && waiting) throw new CheckoutError('NAQD_TOLOV_YOPIQ', 409); // the legacy accept-first flow has no cash step
  const deadline = waiting ? new Date(Date.now() + responseTimeoutMs()) : null;
  // "Shirin" mode: this restaurant checks the money itself (Restaurant.manualPaymentCheck). Real card orders only; cash and the legacy accept-first flow are unchanged.
  const manualCheck = !isCash && !waiting && data.paymentMode === 'REAL'
    && Boolean((await db.restaurant.findUnique({ where: { id: data.restaurantId }, select: { manualPaymentCheck: true } }))?.manualPaymentCheck);
  try {
    const buildOrder = async (tx: Prisma.TransactionClient) => {
      if (data.checkoutKey) {
        const found = await tx.order.findUnique({ where: { checkoutKey: data.checkoutKey } });
        if (found) throw new Error('CHECKOUT_ALREADY_CREATED');
      }
      // Stage 9: in production a REAL order is taken only while an administrator has the payments door open (/payments).
      if (data.paymentMode === 'REAL' && realPaymentsGateActive() && !(await realPaymentsOpen(tx))) throw new CheckoutError('TOLOV_YOPIQ', 409);
      const checked = await validateCheckout(tx, data);
      if (!checked.ok) throw checkoutErrorFor(checked.issues, checked.lines, checked.totalSom, checked.fee.pricing);
      // Walking delivery exists only at restaurants that switched it on; the app does not offer it elsewhere, so a request for it is refused rather than silently turned into a taxi.
      if (data.deliveryPreference === 'WALK_OK' && !checked.restaurant.walkingDeliveryEnabled) throw new CheckoutError('PIYODA_YETKAZISH_MAVJUD_EMAS', 409);
      if (isCash) {
        if (!(await cashEnabled(tx))) throw new CheckoutError('NAQD_TOLOV_YOPIQ', 409);
        const cashMax = await loadCashMaxOrderSom(tx);
        if (checked.totalSom > cashMax) throw new CheckoutError('NAQD_SUMMA_JUDA_KATTA', 409, { maxSom: cashMax });
      }
      // New flow only: the order is payable immediately, so a REAL order must already be dispatchable. (The legacy accept-first flow
      // keeps its old behaviour: the restaurant sets the pickup address before accepting.)
      if (!waiting && data.paymentMode === 'REAL' && !checked.restaurant.pickupAddress?.trim()) throw new CheckoutError('RESTORAN_OLIB_KETISH_MANZILI_YOQ', 409);
      // Stage 8B: a REAL order needs at least one approved, enabled card; otherwise the payment would wait in the queue and expire.
      if (!isCash && data.paymentMode === 'REAL' && (await usableCardCount(tx, data.restaurantId, checked.totalSom)) === 0) {
        throw new CheckoutError('RESTORAN_TOLOV_QABUL_QILMAYDI', 409);
      }
      if (!data.taxiCompanyId && data.autoTaxi) {
        // Automatic assignment needs at least one company that can be booked right now, otherwise the order would stall after payment.
        if (!(await tx.taxiCompany.findFirst({ where: eligibleCompanyWhere(), select: { id: true } }))) throw new CheckoutError('TAKSI_XIZMATI_MAVJUD_EMAS', 409);
      }
      if (data.taxiCompanyId) {
        const taxi = await tx.taxiCompany.findUnique({ where: { id: data.taxiCompanyId } });
        if (!taxi?.isActive) throw new Error('TAKSI_XIZMATI_MAVJUD_EMAS');
        if (data.paymentMode === 'REAL' && !taxi.operatorTelegramUserId && !(await tx.taxiCredential.count({ where: { taxiCompanyId: taxi.id } }))) throw new Error('TAKSI_OPERATOR_BIRIKTIRILMAGAN');
      }
      const { lines, totalSom, fee } = checked; // prices below are the frozen, server-read snapshot
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
      // Owner decision 2026-10-30 (customer-strikes): a blocked customer orders nothing; a customer with a strike cannot pay in cash. Cash uses the
      // existing "cash is closed" code so clients that are already installed show a sensible message.
      const verdict = await orderVerdict(tx, customer.id, { cash: isCash });
      if (verdict === 'BLOCKED') throw new CheckoutError('MIJOZ_BLOKLANGAN', 403);
      if (verdict === 'CASH_OFF') throw new CheckoutError('NAQD_TOLOV_YOPIQ', 409);
      // Stage 8C: every unpaid REAL order holds one (card, amount) slot for up to the payment window; with 3-4 cards a few open orders
      // from one customer could block everybody else. Expired attempts were already swept (engine.createCheckout runs expireWithin first).
      const openLimit = maxOpenUnpaidOrders(data.paymentMode);
      if (openLimit > 0) {
        const open = await tx.order.count({
          where: { customerId: customer.id, status: { in: ['PAYMENT_PENDING', 'WAITING_RESTAURANT'] }, paymentIsTest: data.paymentMode === 'MOCK' },
        });
        if (open >= openLimit) throw new CheckoutError('KOP_TOLANMAGAN_BUYURTMA', 429);
      }
      // Cash is a promise to pay a courier: a customer may only hold a couple of unfinished cash orders at once.
      if (isCash && (await tx.order.count({
        where: { customerId: customer.id, payment: { is: { method: 'CASH', status: { in: [CASH_PENDING, CASH_ACCEPTED] } } },
          status: { in: ['PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'PREPARING', 'READY', 'TAXI_REQUESTED', 'DRIVER_ASSIGNED', 'DELIVERY_ASSUMED'] } },
      })) >= CASH_ACTIVE_LIMIT) throw new CheckoutError('KOP_NAQD_BUYURTMA', 429);
      return tx.order.create({
        data: {
          restaurantId: data.restaurantId, customerId: customer.id,
          addressText: data.addressText,
          deliveryLat: data.deliveryLat, deliveryLng: data.deliveryLng,
          phoneSnapshot: data.phone, taxiCompanyId: data.taxiCompanyId, deliveryPreference: data.deliveryPreference,
          checkoutKey: data.checkoutKey, createdViaBot: data.createdViaBot,
          allowTaxiFallback: data.allowTaxiFallback || data.autoTaxi, // automatic assignment implies trying another company when one declines
          totalSom, status: waiting ? 'WAITING_RESTAURANT' : 'PAYMENT_PENDING',
          // A fee order keeps the restaurant's own prices next to what the customer pays, and the platform's frozen share (the commission later).
          ...(fee.ruleCode ? { baseTotalSom: fee.baseTotalSom, serviceFeeSom: fee.feeSom, feeRuleCode: fee.ruleCode } : {}),
          ...(fee.promoDiscountSom ? { promoDiscountSom: fee.promoDiscountSom } : {}),
          items: { create: lines.map(l => ({ productId: l.productId, name: l.name, unitSom: l.unitSom, quantity: l.quantity, subtotalSom: l.subtotalSom, ...(fee.ruleCode ? { baseUnitSom: l.baseUnitSom } : {}) })) },
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
    const { order } = await (isCash ? engine.createCashCheckout(buildOrder, data.paymentMode === 'MOCK')
      : manualCheck ? engine.createManualCheckout(buildOrder).catch(e => {
        // No usable card (or the switch was turned off a moment ago): the same "this restaurant cannot take payments now" answer as the normal flow.
        throw e instanceof Error && (e.message === 'RESTORAN_TOLOV_QABUL_QILMAYDI' || e.message === 'QOLDA_TEKSHIRUV_YOQILMAGAN') ? new CheckoutError('RESTORAN_TOLOV_QABUL_QILMAYDI', 409) : e;
      })
      : engine.createCheckout(buildOrder, data.paymentMode === 'MOCK'));
    return orderDetails(order.id);
  } catch (error) {
    if ((hasUniqueConstraint(error) || (error instanceof Error && error.message === 'CHECKOUT_ALREADY_CREATED')) && data.checkoutKey) {
      const retried = await previouslyCreated();
      if (retried) return retried;
    }
    throw error;
  }
}
