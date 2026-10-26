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
export async function listRestaurants(search: string | undefined, now = new Date()) {
  const rows = await db.restaurant.findMany({
    where: { isActive: true, ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}) },
    orderBy: { name: 'asc' }, take: 100,
    select: { id: true, slug: true, name: true, isPaused: true, workingHours: true, timezone: true, defaultPrepMinutes: true, image: { select: { version: true } } },
  });
  const ids = rows.map(r => r.id);
  const [ratings, ranked] = await Promise.all([publicRatings(ids), rankingEnabled().then(on => (on ? rankingScores(ids, now) : null))]);
  const list = rows.map(r => {
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
  // Ranking is off until an admin switches it on (/ratings): then better-rated restaurants come first (ties keep the alphabetical order).
  return ranked ? list.sort((a, b) => (ranked.get(b.id) ?? 0) - (ranked.get(a.id) ?? 0)) : list;
}

/** Relative URL of the restaurant's photo (public, cache-busted by version), or null when it has none. */
export const restaurantImageUrl = (id: string, version: number | undefined): string | null => (version === undefined ? null : `/api/v1/miniapp/restaurants/${id}/image?v=${version}`);

export async function restaurantMenu(idOrSlug: string, now = new Date()) {
  const r = await db.restaurant.findFirst({
    where: { isActive: true, OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    select: { id: true, slug: true, name: true, isPaused: true, workingHours: true, timezone: true, defaultPrepMinutes: true, image: { select: { version: true } } },
  });
  if (!r) return null;
  const [categories, products] = await Promise.all([
    db.category.findMany({ where: { restaurantId: r.id }, orderBy: [{ position: 'asc' }, { name: 'asc' }], select: { id: true, name: true } }),
    db.product.findMany({
      where: { restaurantId: r.id, archivedAt: null }, orderBy: [{ name: 'asc' }],
      select: { id: true, name: true, description: true, priceSom: true, isAvailable: true, categoryId: true, imageUrl: true },
    }),
  ]);
  const hours = openState(r, now);
  const isOpen = !r.isPaused && hours.open;
  return {
    restaurant: { id: r.id, slug: r.slug, name: r.name, isOpen, closedReason: isOpen ? null : r.isPaused ? 'PAUSED' : 'HOURS', opensNext: !hours.open ? hours.opensNext : null, prepMinutes: r.defaultPrepMinutes, imageUrl: restaurantImageUrl(r.id, r.image?.version), rating: (await publicRatings([r.id])).get(r.id) ?? null },
    categories, products,
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
  | 'PAYMENT_PENDING' | 'PAYMENT_CHECKING' | 'PREPARING' | 'READY' | 'TAXI_REQUESTED' | 'TAXI_ACCEPTED' | 'TAXI_SENT'
  | 'DELIVERED' | 'CANCELLATION_REQUESTED' | 'CANCELLED' | 'EXPIRED' | 'NEEDS_HELP';

/** One honest stage per order for the tracking screen, derived only from the real order and taxi dispatch state. */
export function customerStage(status: string, paymentStatus: string | null, taxi: TaxiStage | null, now = new Date()): CustomerStage {
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
  restaurant: { select: { name: true, defaultPrepMinutes: true } },
  taxiCompany: { select: { name: true } },
  items: { where: { supersededAt: null }, select: { name: true, unitSom: true, quantity: true, subtotalSom: true } },
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
 * While the food is being cooked and the restaurant has not yet said in how many minutes it will be ready, the customer is told nothing
 * about time (chosenMinutes is null: the screen says "aniqlanmoqda"). Once the restaurant has chosen, the countdown starts.
 */
export function customerPrep(o: CustomerOrderRow, now: Date) {
  const clock = prepClock({
    status: o.status, preparingStartedAt: o.preparingStartedAt, prepMinutes: o.prepMinutes, estimatedPrepMinutes: o.estimatedPrepMinutes,
    readyAt: o.readyAt, prepChosenMinutes: o.prepChosenMinutes, restaurant: o.restaurant,
  }, now);
  if (o.status === 'PREPARING' && o.prepChosenMinutes === null) {
    return { ...clock, minutes: 0, estimatedReadyAt: null, remainingSeconds: null, overdueMinutes: 0, isOverdue: false };
  }
  return clock;
}

export function customerOrderView(o: CustomerOrderRow, now = new Date()) {
  const pay = o.payment;
  const taxi = o.taxiDispatches[0];
  const taxiSt = taxi ? taxiStage(taxi.status) : null;
  const stage = customerStage(o.status, pay?.status ?? null, taxiSt, now);
  const refund = o.refundRequests[0] ?? null;
  const openRefund = refund !== null && OPEN_REFUND.includes(refund.status);
  const cash = pay?.method === 'CASH';
  // Cash: the customer can withdraw while the restaurant has not accepted; afterwards only the restaurant cancels (nothing was paid, so there is no refund to request).
  const cancel: 'UNPAID' | 'REFUND_REQUEST' | null = openRefund ? null
    : o.status === 'PAYMENT_PENDING' ? 'UNPAID'
    : cash ? null
    : ['PAYMENT_MATCHED_UNVERIFIED', 'PAYMENT_CONFIRMED', 'PREPARING'].includes(o.status) ? 'REFUND_REQUEST' : null;

  // Rating the food: offered on the delivered order's card for 24 h after the delivery (nothing is asked at "Ha, oldim").
  const rate = ratingWindow({ stage, deliveredAt: taxi?.deliveredAt ?? null, receivedAt: o.customerReceivedAt, completedAt: o.updatedAt }, now);

  let instructions: unknown = null;
  if (pay?.status === 'AWAITING' && pay.card) {
    const requisite = pay.card.isTest ? null : payeeNumber(pay.card);
    instructions = {
      cardLast4: pay.card.last4, isTest: pay.card.isTest,
      // The payee number is the approved Card.number (or the legacy operator configuration); if neither exists the customer is told NOT to pay.
      cardNumber: requisite, recipientUnavailable: !pay.card.isTest && !requisite,
      // The name on the card, so the customer can check they are paying the right person (legacy cards have none: the app shows the restaurant name).
      cardHolder: pay.card.holderName ?? null,
      expiresAt: pay.expiresAt?.toISOString() ?? null,
      // The length of the payment window, so the screen can say "within N minutes" (it counts down to expiresAt on the server's clock).
      windowSeconds: pay.expiresAt && pay.assignedAt ? Math.max(1, Math.round((pay.expiresAt.getTime() - pay.assignedAt.getTime()) / 1000)) : null,
    };
  }
  return {
    serverNow: now.toISOString(),
    id: o.id, code: o.code, status: o.status, stage,
    createdAt: o.createdAt.toISOString(),
    restaurantName: o.restaurant.name,
    items: o.items,
    // Food and delivery are separate. Delivery is priced by the taxi service; the platform never states an amount.
    foodTotalSom: o.totalSom,
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
    deliveredAt: taxi?.deliveredAt?.toISOString() ?? null, // the operator-confirmed time; nothing earlier counts as delivered
    // "Did you receive it?": asked once the taxi is on its way (or the operator says delivered). A signal only: it never changes the order status.
    receivedAt: o.customerReceivedAt?.toISOString() ?? null,
    canConfirmReceived: o.customerReceivedAt === null && stage === 'DELIVERED',
    // When the payment was confirmed: the app uses it to announce "to‘lov qabul qilindi" once, right after it happens.
    paidAt: o.paymentVerifiedAt?.toISOString() ?? null,
    cancel: { allowed: cancel !== null, kind: cancel },
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
    return { id: v.id, code: v.code, status: v.status, stage: v.stage, createdAt: v.createdAt, restaurantName: v.restaurantName, foodTotalSom: v.foodTotalSom, itemsCount: v.items.reduce((n, i) => n + i.quantity, 0), itemsPreview: v.items.slice(0, 3).map(i => ({ name: i.name, quantity: i.quantity })), itemsMore: Math.max(0, v.items.length - 3), serverNow: v.serverNow, prep: v.prep, taxi: v.taxi, method: v.payment?.method ?? 'CARD', rating: v.rating?.stars ?? null, canRate: v.canRate, rateUntil: v.rateUntil };
  });
}
