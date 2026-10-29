import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import type { PaymentEngineV3 } from '../payment/engine.js';
import { realPaymentsGateActive, realPaymentsOpen } from '../platform/settings.js';
import { autoActorOfSource, autoConfirmEnabledForSource, autoSourceOfActor } from '../restaurant/auto-policy.js';
import { matchedTransactionSources } from '../restaurant-orders/auto.js';
import { openState } from '../restaurant-operations/hours.js';
import { cardOwnerOf, usableCardCount } from '../payment/pool.js';
import { paymentInstructionsOf } from '../miniapp/views.js';

/**
 * Table reservations (owner request 2026-10-27). The customer picks a restaurant, a date/time and the number of guests, and pays a deposit
 * (the restaurant sets the amount, default 100 000 so'm) to the restaurant's card. There is no accept/reject step: once the money is matched and
 * confirmed the table is booked and the restaurant is told. If something is wrong, a person from the restaurant contacts the customer and returns
 * the money outside the app (the restaurant can mark the reservation cancelled).
 *
 * Money is handled by the SAME payment engine as orders (a Payment without an order, on the restaurant's own card), so the allocation rules, the
 * cooldowns and the review of odd money are unchanged. Confirmation follows the same policy as an order: a bank signal only produces
 * MATCHED_UNVERIFIED; the automatic actor of that signal (gmail-auto / humo-auto, with its kill switch) or the restaurant's own tap confirms it.
 */
export class ReservationError extends Error {
  constructor(code: string, readonly statusCode: number, readonly details?: unknown) { super(code); }
}

export const MIN_LEAD_MINUTES = 60;
export const MAX_AHEAD_DAYS = 30;
export const MAX_PARTY = 30;
const MAX_OPEN_UNPAID = 2;

export const reservationSchema = z.object({
  restaurantId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  startsAt: z.string().datetime({ offset: true }),
  partySize: z.number().int().min(1).max(MAX_PARTY),
  note: z.string().trim().max(200).optional(),
  phone: z.string().regex(/^\+998\d{9}$/).optional(),
  checkoutKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
}).strict();
export type ReservationInput = z.infer<typeof reservationSchema>;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = (): string => 'B' + Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

const include = {
  restaurant: { select: { name: true, pickupPhone: true, timezone: true } },
  payment: { include: { card: { select: { last4: true, isTest: true, number: true, holderName: true } } } },
} as const;
type Row = Prisma.ReservationGetPayload<{ include: typeof include }>;

const DEAD_PAYMENT = ['EXPIRED', 'QUEUE_EXPIRED', 'CANCELLED'];

/** What the customer sees. A still-unpaid reservation whose payment window has passed reads as EXPIRED at once (the sweep stores it shortly after). */
export function customerReservationView(r: Row, now = new Date()) {
  const pay = r.payment;
  const status = r.status === 'PENDING_PAYMENT' && DEAD_PAYMENT.includes(pay.status) ? 'EXPIRED' : r.status;
  return {
    serverNow: now.toISOString(),
    id: r.id, code: r.code, status,
    restaurantName: r.restaurant.name,
    restaurantPhone: r.restaurant.pickupPhone ?? null,
    startsAt: r.startsAt.toISOString(), partySize: r.partySize, note: r.note,
    depositSom: r.depositSom, createdAt: r.createdAt.toISOString(), paidAt: r.paidAt?.toISOString() ?? null,
    isTest: pay.isTest,
    payment: {
      status: pay.status, amountSom: Number(pay.amountTiyin / 100n), mode: pay.isTest ? 'MOCK' as const : 'REAL' as const,
      queued: pay.status === 'QUEUED', checking: pay.status === 'MATCHED_UNVERIFIED', instructions: paymentInstructionsOf(pay),
    },
  };
}

export async function loadCustomerReservation(customerId: string, id: string): Promise<Row | null> {
  return db.reservation.findFirst({ where: { id, customerId }, include });
}

export async function listCustomerReservations(customerId: string, limit = 30): Promise<Array<ReturnType<typeof customerReservationView>>> {
  const now = new Date();
  const rows = await db.reservation.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: limit, include });
  return rows.map(r => customerReservationView(r, now));
}

/**
 * Creates the reservation and its deposit payment. A retry with the same checkoutKey returns the first one untouched.
 * Refusals (all 4xx, nothing is written): restaurant not taking reservations, time outside the allowed range or the opening hours, no card to pay to,
 * the payments door closed (production), too many unpaid reservations, the same slot booked twice by the same customer.
 */
export async function placeReservation(
  engine: PaymentEngineV3,
  customer: { id: string; displayName: string | null; phone: string | null },
  input: ReservationInput,
  paymentMode: 'MOCK' | 'REAL',
  now = new Date(),
): Promise<{ reservation: Row; replayed: boolean }> {
  if (process.env.NODE_ENV === 'production' && paymentMode === 'MOCK') throw new ReservationError('MOCK_DISABLED', 403);
  if (input.checkoutKey) {
    const prior = await db.reservation.findUnique({ where: { checkoutKey: input.checkoutKey }, include });
    if (prior) {
      if (prior.customerId !== customer.id) throw new ReservationError('CHECKOUT_KEY_BEGONA', 409);
      return { reservation: prior, replayed: true };
    }
  }
  const phone = input.phone ?? customer.phone;
  if (!phone) throw new ReservationError('PHONE_REQUIRED', 400);
  const startsAt = new Date(input.startsAt);
  if (startsAt.getTime() < now.getTime() + MIN_LEAD_MINUTES * 60_000) throw new ReservationError('BRON_VAQTI_JUDA_YAQIN', 409, { minMinutes: MIN_LEAD_MINUTES });
  if (startsAt.getTime() > now.getTime() + MAX_AHEAD_DAYS * 86_400_000) throw new ReservationError('BRON_VAQTI_JUDA_UZOQ', 409, { maxDays: MAX_AHEAD_DAYS });
  const isTest = paymentMode === 'MOCK';

  try {
    const { reservation } = await engine.createReservationCheckout({ restaurantId: input.restaurantId, depositSom: await depositFor(input.restaurantId), isTest },
      async (tx, payment) => {
        const r = await tx.restaurant.findUnique({
          where: { id: input.restaurantId },
          select: { isActive: true, isPaused: true, reservationsEnabled: true, reservationDepositSom: true, workingHours: true, timezone: true },
        });
        if (!r?.isActive || r.isPaused || !r.reservationsEnabled) throw new ReservationError('BRON_YOPIQ', 409);
        // The deposit the customer was told at quote time cannot change between the two reads.
        if (Number(payment.amountTiyin / 100n) !== r.reservationDepositSom) throw new ReservationError('BRON_SUMMASI_OZGARDI', 409);
        if (!openState(r, startsAt).open) throw new ReservationError('RESTORAN_SHU_VAQTDA_YOPIQ', 409);
        if (paymentMode === 'REAL' && realPaymentsGateActive() && !(await realPaymentsOpen(tx))) throw new ReservationError('TOLOV_YOPIQ', 409);
        if (paymentMode === 'REAL' && (await usableCardCount(tx, input.restaurantId, r.reservationDepositSom)) === 0) throw new ReservationError('RESTORAN_TOLOV_QABUL_QILMAYDI', 409);
        const unpaid = await tx.reservation.count({ where: { customerId: customer.id, status: 'PENDING_PAYMENT', payment: { is: { status: { notIn: DEAD_PAYMENT } } } } });
        if (unpaid >= MAX_OPEN_UNPAID) throw new ReservationError('KOP_TOLANMAGAN_BRON', 429);
        if (await tx.reservation.findFirst({ where: { customerId: customer.id, restaurantId: input.restaurantId, startsAt, status: { in: ['PENDING_PAYMENT', 'PAID'] } }, select: { id: true } })) throw new ReservationError('BRON_ALLAQACHON_BOR', 409);
        let code = newCode();
        for (let i = 0; i < 5 && await tx.reservation.findUnique({ where: { code }, select: { id: true } }); i++) code = newCode();
        return tx.reservation.create({ data: {
          code, restaurantId: input.restaurantId, customerId: customer.id, paymentId: payment.id,
          ...(input.checkoutKey ? { checkoutKey: input.checkoutKey } : {}),
          startsAt, partySize: input.partySize, note: input.note ?? null, phoneSnapshot: phone, nameSnapshot: customer.displayName,
          depositSom: r.reservationDepositSom,
        } });
      });
    return { reservation: await db.reservation.findUniqueOrThrow({ where: { id: reservation.id }, include }), replayed: false };
  } catch (err) {
    // A lost race on the same checkoutKey: return the winner.
    if (input.checkoutKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const prior = await db.reservation.findUnique({ where: { checkoutKey: input.checkoutKey }, include });
      if (prior && prior.customerId === customer.id) return { reservation: prior, replayed: true };
    }
    throw err;
  }
}

async function depositFor(restaurantId: string): Promise<number> {
  const r = await db.restaurant.findUnique({ where: { id: restaurantId }, select: { reservationDepositSom: true } });
  if (!r) throw new ReservationError('BRON_YOPIQ', 409);
  return r.reservationDepositSom;
}

// ------------------------------------------------------------------------------------------------ confirmation of the deposit

export type ConfirmActor =
  | { kind: 'AUTO'; actorId: string }                              // gmail-auto / humo-auto: relies only on its own signal
  | { kind: 'MOCK' }                                               // test payments only
  | { kind: 'STAFF'; restaurantId: string; label: string };       // the restaurant's own explicit tap in its app

/**
 * Turns a MATCHED_UNVERIFIED deposit into a booked table, in one transaction (the same checks as an order's VERIFY_PAYMENT: exact amount, one linked
 * trusted transaction of the right source). 'ALREADY' = it was booked before (a repeat changes nothing); 'STALE' = not in a state that can be confirmed.
 */
export async function confirmReservationPayment(reservationId: string, actor: ConfirmActor): Promise<'CONFIRMED' | 'ALREADY' | 'NOT_FOUND' | 'STALE'> {
  return db.$transaction(async tx => {
    const scope = actor.kind === 'STAFF' ? Prisma.sql`AND "restaurantId" = ${actor.restaurantId}` : Prisma.empty;
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Reservation" WHERE "id" = ${reservationId} ${scope} FOR UPDATE`;
    if (!locked.length) return 'NOT_FOUND';
    const r = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId }, include: { payment: true } });
    if (r.status === 'PAID') return 'ALREADY';
    if (r.status !== 'PENDING_PAYMENT') return 'STALE';
    const pay = r.payment;
    if (pay.status !== 'MATCHED_UNVERIFIED') return 'STALE';
    if (pay.amountTiyin !== BigInt(r.depositSom) * 100n) throw new Error('TOLOV_SUMMASI_MOS_EMAS');
    if (actor.kind === 'MOCK' && !pay.isTest) throw new Error('RUXSAT_YOQ');
    if (actor.kind === 'AUTO' && pay.isTest) throw new Error('RUXSAT_YOQ');
    if (!pay.isTest) {
      const incoming = pay.matchedTransactionId ? await tx.incomingTransaction.findUnique({ where: { id: pay.matchedTransactionId } }) : null;
      if (!incoming || incoming.status !== 'MATCHED_UNVERIFIED' || incoming.matchedPaymentId !== pay.id
        || incoming.amountTiyin !== pay.amountTiyin || !incoming.trustedSender) throw new Error('TOLOV_MOS_EMAS');
      if (actor.kind === 'AUTO') {
        if (incoming.source !== autoSourceOfActor(actor.actorId) || !autoConfirmEnabledForSource(incoming.source)) throw new Error('RUXSAT_YOQ');
      }
    }
    const label = actor.kind === 'AUTO' ? `system:${actor.actorId}` : actor.kind === 'MOCK' ? 'system:mock-auto' : actor.label;
    const verified = await tx.payment.updateMany({ where: { id: pay.id, status: 'MATCHED_UNVERIFIED' }, data: { status: 'CONFIRMED_MANUAL' } });
    if (verified.count !== 1) throw new Error('TOLOV_MOS_EMAS');
    await tx.paymentEvent.create({ data: {
      paymentId: pay.id, action: 'CONFIRMED_MANUAL', fromStatus: 'MATCHED_UNVERIFIED', toStatus: 'CONFIRMED_MANUAL',
      actorType: actor.kind === 'STAFF' ? 'RESTAURANT_STAFF' : 'SYSTEM', actorId: label, incomingTransactionId: pay.matchedTransactionId,
    } });
    const booked = await tx.reservation.updateMany({ where: { id: r.id, status: 'PENDING_PAYMENT' }, data: { status: 'PAID', paidAt: new Date(), paidBy: label } });
    if (booked.count !== 1) throw new Error('HOLAT_ORALIQDA_OZGARDI');
    return 'CONFIRMED';
  });
}

/** Restart-safe sweep: confirms matched deposits whose signal has its automatic actor (and whose kill switch is on). Never throws. */
export async function autoConfirmReservations(limit = 25): Promise<{ confirmed: string[]; refused: Array<{ reservationId: string; reason: string }> }> {
  const out = { confirmed: [] as string[], refused: [] as Array<{ reservationId: string; reason: string }> };
  const rows = await db.reservation.findMany({
    where: { status: 'PENDING_PAYMENT', payment: { is: { status: 'MATCHED_UNVERIFIED' } } },
    orderBy: { updatedAt: 'asc' }, take: limit, select: { id: true, payment: { select: { isTest: true, matchedTransactionId: true } } },
  });
  if (!rows.length) return out;
  const sources = await matchedTransactionSources(rows.map(r => r.payment.matchedTransactionId));
  for (const row of rows) {
    try {
      let result: string;
      if (row.payment.isTest) result = await confirmReservationPayment(row.id, { kind: 'MOCK' });
      else {
        const source = sources.get(row.payment.matchedTransactionId ?? '');
        const actorId = source ? autoActorOfSource(source) : null;
        if (!actorId || !autoConfirmEnabledForSource(source)) continue; // not a signal we confirm automatically: the restaurant confirms in its app
        result = await confirmReservationPayment(row.id, { kind: 'AUTO', actorId });
      }
      if (result === 'CONFIRMED') out.confirmed.push(row.id);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'UNKNOWN';
      out.refused.push({ reservationId: row.id, reason });
      console.error(`[RESERVATION AUTO-CONFIRM] ${row.id} refused: ${reason}`);
    }
  }
  return out;
}

/** Stores EXPIRED for unpaid reservations whose payment attempt is dead (window passed or cancelled). Idempotent. */
export async function expireReservations(): Promise<number> {
  const r = await db.reservation.updateMany({ where: { status: 'PENDING_PAYMENT', payment: { is: { status: { in: DEAD_PAYMENT } } } }, data: { status: 'EXPIRED' } });
  return r.count;
}

// ------------------------------------------------------------------------------------------------ the restaurant's side

const restaurantInclude = { payment: { select: { status: true, isTest: true } }, restaurant: { select: { timezone: true } } } as const;
type RestaurantRow = Prisma.ReservationGetPayload<{ include: typeof restaurantInclude }>;

function restaurantView(r: RestaurantRow) {
  return {
    id: r.id, code: r.code, status: r.status,
    startsAt: r.startsAt.toISOString(), partySize: r.partySize, note: r.note,
    customerName: r.nameSnapshot, customerPhone: r.phoneSnapshot,
    depositSom: r.depositSom, paidAt: r.paidAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
    seen: r.restaurantSeenAt !== null, isTest: r.payment.isTest,
    /** The deposit arrived (a bank signal matched) but nothing confirmed it automatically: the restaurant taps once to book the table. */
    awaitingConfirm: r.status === 'PENDING_PAYMENT' && r.payment.status === 'MATCHED_UNVERIFIED',
    cancelReason: r.cancelReason,
  };
}

/** Upcoming = booked (or paid-but-unconfirmed) from 2 hours before now on; past = the rest, newest first. Only THIS restaurant's rows. */
export async function listRestaurantReservations(restaurantId: string, now = new Date()) {
  const from = new Date(now.getTime() - 2 * 3_600_000);
  const base = { restaurantId } as const;
  const [upcoming, past, unseen, settings] = await Promise.all([
    db.reservation.findMany({
      where: { ...base, startsAt: { gte: from }, OR: [{ status: 'PAID' }, { status: 'PENDING_PAYMENT', payment: { is: { status: 'MATCHED_UNVERIFIED' } } }] },
      orderBy: { startsAt: 'asc' }, take: 200, include: restaurantInclude,
    }),
    db.reservation.findMany({
      where: { ...base, OR: [{ status: 'CANCELLED' }, { status: 'PAID', startsAt: { lt: from } }] },
      orderBy: { startsAt: 'desc' }, take: 50, include: restaurantInclude,
    }),
    db.reservation.count({ where: { ...base, status: 'PAID', restaurantSeenAt: null } }),
    db.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: { reservationsEnabled: true, reservationDepositSom: true } }),
  ]);
  return { serverNow: now.toISOString(), settings: { enabled: settings.reservationsEnabled, depositSom: settings.reservationDepositSom }, unseenCount: unseen, upcoming: upcoming.map(restaurantView), past: past.map(restaurantView) };
}

/** "I have seen it": silences the new-reservation marker. Idempotent; another restaurant's id is the same 204. */
export async function markReservationSeen(restaurantId: string, id: string): Promise<void> {
  await db.reservation.updateMany({ where: { id, restaurantId, restaurantSeenAt: null }, data: { restaurantSeenAt: new Date() } });
}

/** The restaurant cannot honour a booked table. The customer is contacted by a person and the money returned outside the app; this only records it. */
export async function cancelReservationByRestaurant(restaurantId: string, id: string, reason: string | undefined, label: string): Promise<'CANCELLED' | 'ALREADY' | 'NOT_FOUND' | 'STALE'> {
  return db.$transaction(async tx => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Reservation" WHERE "id" = ${id} AND "restaurantId" = ${restaurantId} FOR UPDATE`;
    if (!locked.length) return 'NOT_FOUND';
    const r = await tx.reservation.findUniqueOrThrow({ where: { id }, select: { status: true } });
    if (r.status === 'CANCELLED') return 'ALREADY';
    if (r.status !== 'PAID') return 'STALE';
    await tx.reservation.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: `${label}${reason ? `: ${reason.slice(0, 200)}` : ''}` } });
    return 'CANCELLED';
  });
}

export const cancelBodySchema = z.object({ reason: z.string().trim().max(200).optional() }).strict();

/** Settings: switching on needs at least one active card to receive the deposit. */
export const reservationSettingsSchema = z.object({
  enabled: z.boolean(),
  depositSom: z.number().int().min(1000).max(5_000_000),
}).strict();

export async function setReservationSettings(restaurantId: string, input: z.infer<typeof reservationSettingsSchema>) {
  if (input.enabled && (await db.card.count({ where: { restaurantId: await cardOwnerOf(db, restaurantId, false), active: true } })) === 0) throw new ReservationError('KARTA_YOQ', 409);
  const r = await db.restaurant.update({ where: { id: restaurantId }, data: { reservationsEnabled: input.enabled, reservationDepositSom: input.depositSom }, select: { reservationsEnabled: true, reservationDepositSom: true } });
  return { reservationsEnabled: r.reservationsEnabled, reservationDepositSom: r.reservationDepositSom };
}
