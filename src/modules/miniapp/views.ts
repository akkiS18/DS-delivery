import { db } from '../../lib/db.js';
import { customerWhere, type CustomerOwner } from '../../lib/customer-owner.js';
import { realRequisite } from '../payment/requisites.js';
import { openState } from '../restaurant-operations/hours.js';
import { prepClock } from '../restaurant-orders/service.js';
import { taxiStage, type TaxiStage } from '../taxi/workflow.js';

/** What the Mini App is allowed to see. Built from real backend rows only; nothing here is demo data. */

// ------------------------------------------------------------------------------------------------ restaurants and menu
export async function listRestaurants(search: string | undefined, now = new Date()) {
  const rows = await db.restaurant.findMany({
    where: { isActive: true, ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}) },
    orderBy: { name: 'asc' }, take: 100,
    select: { id: true, slug: true, name: true, isPaused: true, workingHours: true, timezone: true, defaultPrepMinutes: true },
  });
  return rows.map(r => {
    const hours = openState(r, now);
    const isOpen = !r.isPaused && hours.open;
    return {
      id: r.id, slug: r.slug, name: r.name, isOpen,
      closedReason: isOpen ? null : r.isPaused ? 'PAUSED' : 'HOURS',
      opensNext: !hours.open ? hours.opensNext : null,
      prepMinutes: r.defaultPrepMinutes,
    };
  });
}

export async function restaurantMenu(idOrSlug: string, now = new Date()) {
  const r = await db.restaurant.findFirst({
    where: { isActive: true, OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    select: { id: true, slug: true, name: true, isPaused: true, workingHours: true, timezone: true, defaultPrepMinutes: true },
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
    restaurant: { id: r.id, slug: r.slug, name: r.name, isOpen, closedReason: isOpen ? null : r.isPaused ? 'PAUSED' : 'HOURS', opensNext: !hours.open ? hours.opensNext : null, prepMinutes: r.defaultPrepMinutes },
    categories, products,
  };
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
    default: return paymentStatus === 'CONFIRMED_MANUAL' ? 'PREPARING' : 'PAYMENT_PENDING';
  }
}

const orderInclude = {
  restaurant: { select: { name: true, defaultPrepMinutes: true } },
  items: { where: { supersededAt: null }, select: { name: true, unitSom: true, quantity: true, subtotalSom: true } },
  payment: { include: { card: { select: { last4: true, isTest: true } } } },
  taxiDispatches: { orderBy: { attemptNo: 'desc' as const }, take: 1, select: { status: true, deliveredAt: true, taxiCompany: { select: { name: true } } } },
  refundRequests: { orderBy: { number: 'desc' as const }, take: 1, select: { status: true, receiptKey: true } },
} as const;

const OPEN_REFUND = ['REQUESTED', 'APPROVED', 'SENT', 'DISPUTED'];

/** Loads an order only if it belongs to this customer (Telegram user or guest session) (anyone else's id is simply "not found"). */
export async function loadCustomerOrder(owner: CustomerOwner, orderId: string) {
  return db.order.findFirst({ where: { id: orderId, createdViaBot: true, customer: customerWhere(owner) }, include: orderInclude });
}
export type CustomerOrderRow = NonNullable<Awaited<ReturnType<typeof loadCustomerOrder>>>;

export function customerOrderView(o: CustomerOrderRow, now = new Date()) {
  const pay = o.payment;
  const taxi = o.taxiDispatches[0];
  const taxiSt = taxi ? taxiStage(taxi.status) : null;
  const stage = customerStage(o.status, pay?.status ?? null, taxiSt, now);
  const refund = o.refundRequests[0] ?? null;
  const openRefund = refund !== null && OPEN_REFUND.includes(refund.status);
  const cancel: 'UNPAID' | 'REFUND_REQUEST' | null = openRefund ? null
    : o.status === 'PAYMENT_PENDING' ? 'UNPAID'
    : ['PAYMENT_MATCHED_UNVERIFIED', 'PAYMENT_CONFIRMED', 'PREPARING'].includes(o.status) ? 'REFUND_REQUEST' : null;

  let instructions: unknown = null;
  if (pay?.status === 'AWAITING' && pay.card) {
    const requisite = pay.card.isTest ? null : realRequisite(pay.card.last4);
    instructions = {
      cardLast4: pay.card.last4, isTest: pay.card.isTest,
      // The payee number comes only from operator configuration; if it is not configured the customer is told NOT to pay.
      cardNumber: requisite, recipientUnavailable: !pay.card.isTest && !requisite,
      expiresAt: pay.expiresAt?.toISOString() ?? null,
    };
  }
  return {
    serverNow: now.toISOString(),
    id: o.id, number: o.number, status: o.status, stage,
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
    },
    prep: prepClock({ status: o.status, preparingStartedAt: o.preparingStartedAt, prepMinutes: o.prepMinutes, estimatedPrepMinutes: o.estimatedPrepMinutes, readyAt: o.readyAt, restaurant: o.restaurant }, now),
    readyAt: o.readyAt?.toISOString() ?? null,
    taxi: taxi ? { stage: taxiSt, companyName: taxi.taxiCompany.name } : null,
    deliveredAt: taxi?.deliveredAt?.toISOString() ?? null, // the operator-confirmed time; nothing earlier counts as delivered
    cancel: { allowed: cancel !== null, kind: cancel },
    refund: refund ? { status: refund.status, hasReceipt: refund.receiptKey !== null } : null,
  };
}
export type CustomerOrderView = ReturnType<typeof customerOrderView>;

export async function listCustomerOrders(owner: CustomerOwner, limit = 20) {
  const rows = await db.order.findMany({
    where: { createdViaBot: true, customer: customerWhere(owner) }, orderBy: { createdAt: 'desc' }, take: limit, include: orderInclude,
  });
  return rows.map(r => {
    const v = customerOrderView(r);
    return { id: v.id, number: v.number, status: v.status, stage: v.stage, createdAt: v.createdAt, restaurantName: v.restaurantName, foodTotalSom: v.foodTotalSom, itemsCount: v.items.reduce((n, i) => n + i.quantity, 0), serverNow: v.serverNow, prep: v.prep, taxi: v.taxi };
  });
}
