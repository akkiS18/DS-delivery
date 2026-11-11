import type { Prisma } from '@prisma/client';
import { reorderLines } from './reorder.js';
import { db } from '../../lib/db.js';
import { customerWhere, type CustomerOwner } from '../../lib/customer-owner.js';
import { isPaymentCleared } from '../payment/status.js';
import { payeeNumber } from '../payment/requisites.js';
import { loadFeeConfig } from '../pricing/config.js';
import { publicPricing } from '../pricing/fee.js';
import { openState } from '../restaurant-operations/hours.js';
import { prepClock } from '../restaurant-orders/service.js';
import { eligibleCompanyWhere } from '../taxi/assignment.js';
import { taxiStage, type TaxiStage } from '../taxi/workflow.js';
import { publicRatings, ratingWindow, rankingEnabled, rankingScores } from '../ratings/service.js';

/** What the Mini App is allowed to see. Built from real backend rows only; nothing here is demo data. */

// ------------------------------------------------------------------------------------------------ restaurants and menu
const cardSelect = { id: true, slug: true, name: true, isPaused: true, workingHours: true, timezone: true, defaultPrepMinutes: true, image: { select: { version: true } } } as const;
type CardRow = { id: string; slug: string; name: string; isPaused: boolean; workingHours: Prisma.JsonValue | null; timezone: string; defaultPrepMinutes: number; image: { version: number } | null };

/** The restaurant card the app shows (open state computed now, rating if there is one). */
async function toCards(rows: CardRow[], now: Date) {
  const ratings = await publicRatings(rows.map(r => r.id));
  return rows.map(r => {
    const hours = openState(r, now);
    const isOpen = !r.isPaused && hours.open;
    return {
      id: r.id, slug: r.slug, name: r.name, isOpen,
      closedReason: isOpen ? null : r.isPaused ? 'PAUSED' : 'HOURS',
      opensNext: !hours.open ? hours.opensNext : null,
      prepMinutes: r.defaultPrepMinutes,
      imageUrl: restaurantImageUrl(r.id, r.image?.version),
      rating: ratings.get(r.id) ?? null,
    };
  });
}

/** Cards for these restaurants (only active ones), in no particular order. */
export async function restaurantCards(ids: string[], now = new Date()) {
  const rows = await db.restaurant.findMany({ where: { isActive: true, id: { in: ids } }, select: cardSelect });
  return toCards(rows, now);
}

export async function listRestaurants(search: string | undefined, now = new Date()) {
  const rows = await db.restaurant.findMany({
    where: { isActive: true, ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}) },
    orderBy: { name: 'asc' }, take: 100, select: cardSelect,
  });
  const ids = rows.map(r => r.id);
  const [list, ranked] = await Promise.all([toCards(rows, now), rankingEnabled().then(on => (on ? rankingScores(ids, now) : null))]);
  // Ranking is off until an admin switches it on (/ratings): then better-rated restaurants come first (ties keep the alphabetical order).
  return ranked ? list.sort((a, b) => (ranked.get(b.id) ?? 0) - (ranked.get(a.id) ?? 0)) : list;
}

/** Relative URL of the restaurant's photo (public, cache-busted by version), or null when it has none. */
export const restaurantImageUrl = (id: string, version: number | undefined): string | null => (version === undefined ? null : `/api/v1/miniapp/restaurants/${id}/image?v=${version}`);

export async function restaurantMenu(idOrSlug: string, now = new Date()) {
  const r = await db.restaurant.findFirst({
    where: { isActive: true, OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    select: { id: true, slug: true, name: true, isPaused: true, workingHours: true, timezone: true, defaultPrepMinutes: true, reservationsEnabled: true, reservationDepositSom: true, image: { select: { version: true } } },
  });
  if (!r) return null;
  const [categories, products] = await Promise.all([
    db.category.findMany({ where: { restaurantId: r.id }, orderBy: [{ position: 'asc' }, { name: 'asc' }], select: { id: true, name: true, image: { select: { version: true } } } }),
    db.product.findMany({
      where: { restaurantId: r.id, archivedAt: null }, orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, description: true, priceSom: true, oldPriceSom: true, isAvailable: true, categoryId: true, imageUrl: true, isPackaging: true, packagingProductId: true, image: { select: { version: true } } },
    }),
  ]);
  // Packaging ("soboy idishi") is not a menu item: each dish that has it says so, and the server adds one per unit at checkout.
  const packaging = new Map(products.filter(p => p.isPackaging && p.isAvailable).map(p => [p.id, { id: p.id, name: p.name, priceSom: p.priceSom }]));
  const promotions = await db.promotion.findMany({
    where: { restaurantId: r.id, isActive: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, title: true, kind: true, maxFreePerOrder: true, products: { select: { productId: true } } },
  });
  const hours = openState(r, now);
  const isOpen = !r.isPaused && hours.open;
  return {
    restaurant: { id: r.id, slug: r.slug, name: r.name, isOpen, closedReason: isOpen ? null : r.isPaused ? 'PAUSED' : 'HOURS', opensNext: !hours.open ? hours.opensNext : null, prepMinutes: r.defaultPrepMinutes, imageUrl: restaurantImageUrl(r.id, r.image?.version), rating: (await publicRatings([r.id])).get(r.id) ?? null,
      // Table reservations: present only while the restaurant takes them (the deposit is what the customer pays to the restaurant's card).
      reservation: r.reservationsEnabled ? { depositSom: r.reservationDepositSom } : null },
    categories: categories.map(({ image, ...c }) => ({ ...c, imageUrl: image ? `/api/v1/miniapp/categories/${c.id}/image?v=${image.version}` : null })),
    products: products.filter(p => !p.isPackaging).map(({ image, isPackaging, packagingProductId, ...p }) => ({
      ...(image ? { ...p, imageUrl: `/api/v1/miniapp/products/${p.id}/image?v=${image.version}` } : p),
      packaging: packagingProductId ? packaging.get(packagingProductId) ?? null : null,
    })),
    // 1+1 offers that are on now: of every two units of these products the cheaper is free (the app mirrors it; the server decides at checkout).
    promotions: promotions.map(x => ({ id: x.id, title: x.title, kind: x.kind, maxFreePerOrder: x.maxFreePerOrder, productIds: x.products.map(pp => pp.productId) })),
    // The service fee is part of the customer's dish prices: the app reproduces them locally from this (the server re-prices at checkout).
    // `priceSom` stays the restaurant's own menu price.
    pricing: publicPricing(await loadFeeConfig()),
  };
}

/** Taxi services the customer may pick at checkout: the ones that can be booked right now (active and reachable). Names only. */
export async function listTaxiOptions() {
  return db.taxiCompany.findMany({ where: eligibleCompanyWhere(), orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true } });
}

// ------------------------------------------------------------------------------------------------ the customer's own orders
export type CustomerStage =
  | 'PAYMENT_PENDING' | 'PAYMENT_CHECKING' | 'PREPARING' | 'READY' | 'SELF_DELIVERY' | 'TAXI_REQUESTED' | 'TAXI_ACCEPTED' | 'TAXI_SENT'
  | 'DELIVERED' | 'CANCELLATION_REQUESTED' | 'CANCELLED' | 'EXPIRED' | 'NEEDS_HELP';

/** One honest stage per order for the tracking screen, derived only from the real order and taxi dispatch state. */
export function customerStage(status: string, paymentStatus: string | null, taxi: TaxiStage | null, now = new Date(), selfDelivery = false): CustomerStage {
  void now;
  switch (status) {
    case 'COMPLETED': return 'DELIVERED';
    case 'CANCELLED': case 'CUSTOMER_CANCELLED': case 'RESTAURANT_REJECTED': return 'CANCELLED';
    case 'PAYMENT_EXPIRED': case 'RESTAURANT_EXPIRED': return 'EXPIRED';
    case 'FAILED': return 'NEEDS_HELP';
    case 'CANCELLATION_REQUESTED': return 'CANCELLATION_REQUESTED';
    case 'PAYMENT_PENDING': case 'WAITING_RESTAURANT': case 'WAITING_CUSTOMER_CONSENT': return 'PAYMENT_PENDING';
    case 'PAYMENT_MATCHED_UNVERIFIED': return 'PAYMENT_CHECKING';
    case 'PAYMENT_CONFIRMED': case 'ACCEPTED': return 'PREPARING';
    case 'PREPARING': case 'READY': {
      // Walking delivery: the restaurant itself brings the order (it never has a taxi).
      if (status === 'READY' && selfDelivery) return 'SELF_DELIVERY';
      if (taxi === 'NEEDS_HELP') return 'NEEDS_HELP';
      if (taxi === 'DISPATCHED') return 'TAXI_SENT';
      if (taxi === 'ACCEPTED') return 'TAXI_ACCEPTED';
      if (taxi === 'REQUESTED') return 'TAXI_REQUESTED';
      return status === 'READY' ? 'READY' : 'PREPARING';
    }
    default: return isPaymentCleared(paymentStatus) ? 'PREPARING' : 'PAYMENT_PENDING';
  }
}

const orderInclude = {
  restaurant: { select: { id: true, name: true, defaultPrepMinutes: true, pickupPhone: true, image: { select: { version: true } } } },
  taxiCompany: { select: { name: true } },
  items: { where: { supersededAt: null }, select: { productId: true, name: true, unitSom: true, quantity: true, subtotalSom: true } },
  // number: the approved payee number the customer is shown (payeeNumber() needs it; without it the screen says "not configured").
  payment: { include: { card: { select: { last4: true, isTest: true, number: true, holderName: true } } } },
  taxiDispatches: { orderBy: { attemptNo: 'desc' as const }, take: 1, select: { status: true, deliveredAt: true, taxiCompany: { select: { name: true } } } },
  refundRequests: { orderBy: { number: 'desc' as const }, take: 1, select: { status: true, receiptKey: true } },
  rating: { select: { stars: true, reasons: true, note: true } },
} as const;

const OPEN_REFUND = ['REQUESTED', 'APPROVED', 'SENT', 'DISPUTED'];

/** Loads an order only if it belongs to this customer (Telegram user or guest session) (anyone else's id is simply "not found"). */
export async function loadCustomerOrder(owner: CustomerOwner, orderId: string) {
  return db.order.findFirst({ where: { id: orderId, createdViaBot: true, customer: customerWhere(owner) }, include: orderInclude });
}
export type CustomerOrderRow = NonNullable<Awaited<ReturnType<typeof loadCustomerOrder>>>;

/**
 * Owner decision 2026-10-27: the customer is never told a preparation time (no countdown, no "ready in N minutes", no "being determined").
 * The field keeps its shape so older apps still parse it; chosenMinutes is 0, not null, so an older screen does not show its "aniqlanmoqda" banner.
 */
export function customerPrep(o: CustomerOrderRow, now: Date) {
  const clock = prepClock({
    status: o.status, preparingStartedAt: o.preparingStartedAt, prepMinutes: o.prepMinutes, estimatedPrepMinutes: o.estimatedPrepMinutes,
    readyAt: o.readyAt, prepChosenMinutes: o.prepChosenMinutes, restaurant: o.restaurant,
  }, now);
  return { ...clock, minutes: 0, estimatedReadyAt: null, chosenMinutes: 0, remainingSeconds: null, overdueMinutes: 0, isOverdue: false };
}

/** Where and how much to pay, once a card is allocated (null before that). Shared by orders and table reservations. */
export function paymentInstructionsOf(pay: { status: string; expiresAt: Date | null; assignedAt: Date | null; card: { last4: string; isTest: boolean; number: string | null; holderName: string | null } | null } | null | undefined): unknown {
  // "Shirin" mode: the restaurant checks the money itself - the same card block, but no payment window (no expiry, no countdown) and manualCheck=true.
  const manualCheck = pay?.status === 'RESTAURANT_CHECK';
  if ((pay?.status !== 'AWAITING' && !manualCheck) || !pay.card) return null;
  const requisite = pay.card.isTest ? null : payeeNumber(pay.card);
  return {
    cardLast4: pay.card.last4, isTest: pay.card.isTest,
    // The payee number is the approved Card.number (or the legacy operator configuration); if neither exists the customer is told NOT to pay.
    cardNumber: requisite, recipientUnavailable: !pay.card.isTest && !requisite,
    // The name on the card, so the customer can check they are paying the right person (legacy cards have none: the app shows the restaurant name).
    cardHolder: pay.card.holderName ?? null,
    expiresAt: manualCheck ? null : pay.expiresAt?.toISOString() ?? null,
    manualCheck,
    // The length of the payment window, so the screen can say "within N minutes" (it counts down to expiresAt on the server's clock).
    windowSeconds: !manualCheck && pay.expiresAt && pay.assignedAt ? Math.max(1, Math.round((pay.expiresAt.getTime() - pay.assignedAt.getTime()) / 1000)) : null,
  };
}

/** LINE_5000 = charged 5 000 on top of the items; LINE_FREE_5000 = the same line shown crossed out and not charged. */
export function platformLineOf(ruleCode: string | null, serviceFeeSom: number | null): { chargedSom: number; waivedSom: number } | null {
  const m = ruleCode ? /^LINE(_FREE)?_(\d{4,5})$/.exec(ruleCode) : null;
  if (!m) return null;
  const som = Number(m[2]);
  return m[1] ? { chargedSom: 0, waivedSom: som } : { chargedSom: serviceFeeSom ?? som, waivedSom: 0 };
}

export function customerOrderView(o: CustomerOrderRow, now = new Date()) {
  const pay = o.payment;
  const taxi = o.taxiDispatches[0];
  const taxiSt = taxi ? taxiStage(taxi.status) : null;
  const stage = customerStage(o.status, pay?.status ?? null, taxiSt, now, o.deliveryMode === 'SELF');
  const deliveredAt = taxi?.deliveredAt ?? o.selfDeliveredAt ?? null;
  const refund = o.refundRequests[0] ?? null;
  const openRefund = refund !== null && OPEN_REFUND.includes(refund.status);
  const cash = pay?.method === 'CASH';
  // The restaurant's one-tap "Qabul qildim" (prepChosenMinutes) is its acceptance of a paid card order; for cash it is the cash accept.
  // Owner decision 2026-10-31: the customer can cancel only until the restaurant accepted; afterwards a serious reason is a phone call (no button).
  const accepted = cash ? pay?.status === 'CASH_ACCEPTED' : o.prepChosenMinutes !== null;
  const awaitingRestaurant = !cash && ['PAYMENT_CONFIRMED', 'PREPARING'].includes(o.status) && !accepted;
  const cancel: 'UNPAID' | 'REFUND_REQUEST' | null = openRefund ? null
    : o.status === 'PAYMENT_PENDING' ? 'UNPAID'
    : cash ? null
    : !accepted && ['PAYMENT_MATCHED_UNVERIFIED', 'PAYMENT_CONFIRMED', 'PREPARING'].includes(o.status) ? 'REFUND_REQUEST' : null;

  // Rating the food: offered on the delivered order's card for 24 h after the delivery (nothing is asked at "Ha, oldim").
  const rate = ratingWindow({ stage, deliveredAt, receivedAt: o.customerReceivedAt, completedAt: o.updatedAt }, now);

  const instructions = paymentInstructionsOf(pay);
  return {
    serverNow: now.toISOString(),
    id: o.id, code: o.code, status: o.status, stage,
    createdAt: o.createdAt.toISOString(),
    restaurantName: o.restaurant.name,
    /** The restaurant's photo (round logo on the order screen); null = none. */
    restaurantImageUrl: restaurantImageUrl(o.restaurant.id, o.restaurant.image?.version),
    /** The restaurant's own number, shown where the customer must contact it (a payment that cannot be matched automatically). */
    restaurantPhone: o.restaurant.pickupPhone ?? null,
    items: o.items,
    // Food and delivery are separate. Delivery is priced by the taxi service; the platform never states an amount.
    foodTotalSom: o.totalSom,
    /** The separate "Platforma xizmati" line (LINE fee mode): what was charged on top of the items, or what was crossed out as a discount. null for every other order. */
    platformLine: platformLineOf(o.feeRuleCode ?? null, o.serviceFeeSom ?? null),
    /** Menu value of the free units given by a 1+1 promotion (the lines priced 0 above); 0 = none. */
    promoDiscountSom: o.promoDiscountSom,
    delivery: { feeSom: null, note: 'TAXI_TARIFF' as const },
    address: o.addressText, phone: o.phoneSnapshot,
    isTest: o.paymentIsTest,
    payment: pay && {
      status: pay.status, amountSom: Number(pay.amountTiyin / 100n), mode: pay.isTest ? 'MOCK' as const : 'REAL' as const,
      queued: pay.status === 'QUEUED', instructions,
      method: cash ? 'CASH' as const : 'CARD' as const,
      // Cash on delivery: nothing is paid in the app; the customer hands the food total to the driver. acceptBy = the restaurant's answer deadline.
      cash: cash ? { dueSom: o.totalSom, accepted: pay.status === 'CASH_ACCEPTED', acceptBy: pay.status === 'CASH_PENDING' ? pay.expiresAt?.toISOString() ?? null : null } : null,
    },
    prep: customerPrep(o, now),
    readyAt: o.readyAt?.toISOString() ?? null,
    taxi: taxi ? { stage: taxiSt, companyName: taxi.taxiCompany.name } : null,
    // The taxi service the customer picked (or the one assigned automatically); shown on the order before any dispatch exists.
    taxiCompanyName: o.taxiCompany?.name ?? null,
    deliveredAt: deliveredAt?.toISOString() ?? null, // the operator-confirmed (taxi) or restaurant-reported (self delivery) time; nothing earlier counts as delivered
    // Walking delivery: what the customer allowed at checkout and what the restaurant decided (TAXI until it presses "Tayyor").
    deliveryPreference: o.deliveryPreference === 'WALK_OK' ? 'WALK_OK' as const : 'TAXI' as const,
    deliveryMode: o.deliveryMode === 'SELF' ? 'SELF' as const : 'TAXI' as const,
    // "Did you receive it?": asked once the taxi is on its way (or the operator says delivered). A signal only: it never changes the order status.
    receivedAt: o.customerReceivedAt?.toISOString() ?? null,
    canConfirmReceived: o.customerReceivedAt === null && stage === 'DELIVERED',
    // When the payment was confirmed: the app uses it to announce "to‘lov qabul qilindi" once, right after it happens.
    paidAt: o.paymentVerifiedAt?.toISOString() ?? null,
    cancel: { allowed: cancel !== null, kind: cancel },
    /** Paid, but the restaurant has not tapped "Qabul qildim" yet: the screen says so and the customer can still cancel. */
    awaitingRestaurant,
    restaurantAccepted: accepted,
    refund: refund ? { status: refund.status, hasReceipt: refund.receiptKey !== null } : null,
    rating: o.rating ? { stars: o.rating.stars, reasons: o.rating.reasons, note: o.rating.note } : null,
    canRate: rate.canRate,
    rateUntil: rate.canRate ? rate.until?.toISOString() ?? null : null,
  };
}
export type CustomerOrderView = ReturnType<typeof customerOrderView>;

export async function listCustomerOrders(owner: CustomerOwner, limit = 20) {
  const rows = await db.order.findMany({
    where: { createdViaBot: true, customer: customerWhere(owner) }, orderBy: { createdAt: 'desc' }, take: limit, include: orderInclude,
  });
  return rows.map(r => {
    const v = customerOrderView(r);
    return { id: v.id, code: v.code, status: v.status, stage: v.stage, createdAt: v.createdAt, restaurantId: r.restaurantId, reorder: reorderLines(r.items), restaurantName: v.restaurantName, restaurantImageUrl: v.restaurantImageUrl, foodTotalSom: v.foodTotalSom, itemsCount: v.items.reduce((n, i) => n + i.quantity, 0), itemsPreview: v.items.slice(0, 3).map(i => ({ name: i.name, quantity: i.quantity })), itemsMore: Math.max(0, v.items.length - 3), serverNow: v.serverNow, prep: v.prep, taxi: v.taxi, method: v.payment?.method ?? 'CARD', rating: v.rating?.stars ?? null, canRate: v.canRate, rateUntil: v.rateUntil };
  });
}
