import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '../../lib/db.js';

/**
 * Stage 8B: payee cards managed by the restaurant in its app.
 *
 * Why approval: a card is where customers' money goes. Anyone who holds a restaurant session (or knows its password) could point
 * customers at another card. A new card therefore starts PENDING and inactive; only a platform administrator (Telegram) makes it
 * assignable. Disabling is always allowed (it can only reduce risk); re-enabling is allowed only for a card an administrator approved.
 * Assignment itself is unchanged: the payment engine only looks at `active` cards, and the DB forbids active + unapproved.
 */

export type CardStatus = 'PENDING' | 'ACTIVE' | 'DISABLED' | 'REJECTED';
export interface CardView { id: string; last4: string; masked: string; status: CardStatus; createdAt: string }

export const MAX_CARDS_DEFAULT = 6;
export const MAX_PENDING = 2;
const maxCards = (env: NodeJS.ProcessEnv = process.env): number => {
  const n = Number(env.RESTAURANT_MAX_CARDS);
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : MAX_CARDS_DEFAULT;
};

/** Typo guard only (Luhn): every UZCARD / Humo / Visa / Mastercard number passes it. */
export function luhnValid(digits: string): boolean {
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

export const cardNumberSchema = z.string().max(40)
  .transform(v => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^\d{16}$/, 'CARD_NUMBER_INVALID').refine(luhnValid, 'CARD_NUMBER_INVALID'));

/** The restaurant never gets the full number back: it typed it, and the app list does not need it. */
export const maskCard = (last4: string): string => `**** **** **** ${last4}`;
/** Grouped for administrators, who must compare it with what the restaurant says over the phone. */
export const groupCard = (number: string): string => number.replace(/(\d{4})(?=\d)/g, '$1 ');

export function statusOf(c: { approvalStatus: string; active: boolean }): CardStatus {
  if (c.approvalStatus === 'PENDING') return 'PENDING';
  if (c.approvalStatus === 'REJECTED') return 'REJECTED';
  return c.active ? 'ACTIVE' : 'DISABLED';
}
const view = (c: { id: string; last4: string; approvalStatus: string; active: boolean; createdAt: Date }): CardView => (
  { id: c.id, last4: c.last4, masked: maskCard(c.last4), status: statusOf(c), createdAt: c.createdAt.toISOString() });

const record = (tx: Prisma.TransactionClient, cardId: string, action: string, actorType: 'RESTAURANT' | 'ADMIN' | 'SYSTEM', actorId?: string, details?: Prisma.InputJsonValue) =>
  tx.cardEvent.create({ data: { cardId, action, actorType, actorId: actorId ?? null, ...(details !== undefined ? { details } : {}) } });

/** Real (non-test) cards of this restaurant, newest first. Test cards are an operator tool and never shown here. */
export async function listCards(restaurantId: string): Promise<CardView[]> {
  const rows = await db.card.findMany({ where: { restaurantId, isTest: false }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  return rows.map(view);
}

export type AddCardResult =
  | { ok: true; card: CardView }
  | { ok: false; code: 'CARD_TAKEN' | 'CARD_EXISTS' | 'CARD_LIMIT' | 'CARD_PENDING_LIMIT' };

/** Creates a PENDING card. The last four digits are the key the bank e-mail is matched on, so they must be unique platform-wide. */
export const holderNameSchema = z.string().trim().min(3).max(40).regex(/^\p{L}[\p{L}\s.'‘’ʻ-]*$/u).transform(v => v.replace(/\s+/g, ' '));

export async function addCard(restaurantId: string, number: string, actorId: string, env: NodeJS.ProcessEnv = process.env, holderName: string | null = null): Promise<AddCardResult> {
  const last4 = number.slice(-4);
  try {
    return await db.$transaction(async tx => {
      // One writer per restaurant: the limits below are checked and applied together.
      await tx.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(7016, hashtext(${restaurantId}))`;
      const mine = await tx.card.findMany({ where: { restaurantId, isTest: false } });
      const existing = await tx.card.findUnique({ where: { last4 } });
      if (existing) {
        // A rejected card of this restaurant may be submitted again (typo, wrong card); anything else is a clash.
        if (existing.restaurantId === restaurantId && !existing.isTest && existing.approvalStatus === 'REJECTED') {
          if (mine.filter(c => c.approvalStatus === 'PENDING').length >= MAX_PENDING) return { ok: false, code: 'CARD_PENDING_LIMIT' } as const;
          const { count } = await tx.card.updateMany({
            where: { id: existing.id, approvalStatus: 'REJECTED' },
            data: { number, approvalStatus: 'PENDING', active: false, decidedAt: null, decidedBy: null, adminNotifiedAt: null, ...(holderName ? { holderName } : {}) },
          });
          if (count !== 1) return { ok: false, code: 'CARD_TAKEN' } as const;
          await record(tx, existing.id, 'RESUBMITTED', 'RESTAURANT', actorId);
          return { ok: true, card: view({ ...existing, approvalStatus: 'PENDING', active: false }) } as const;
        }
        return { ok: false, code: existing.restaurantId === restaurantId && !existing.isTest ? 'CARD_EXISTS' : 'CARD_TAKEN' } as const;
      }
      if (mine.filter(c => c.approvalStatus !== 'REJECTED').length >= maxCards(env)) return { ok: false, code: 'CARD_LIMIT' } as const;
      if (mine.filter(c => c.approvalStatus === 'PENDING').length >= MAX_PENDING) return { ok: false, code: 'CARD_PENDING_LIMIT' } as const;
      const card = await tx.card.create({ data: { restaurantId, last4, number, holderName, isTest: false, active: false, approvalStatus: 'PENDING', label: 'UZCARD' } });
      await record(tx, card.id, 'ADDED', 'RESTAURANT', actorId);
      return { ok: true, card: view(card) } as const;
    });
  } catch (e) {
    // Two requests racing on the same number: the unique indexes decide.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: false, code: 'CARD_TAKEN' };
    throw e;
  }
}

export type ToggleResult = { ok: true; card: CardView } | { ok: false; code: 'NOT_FOUND' | 'NOT_APPROVED' };

/** Disable (always) or re-enable (approved cards only). Tenant-scoped: another restaurant's card is "not found". */
export async function setCardActive(restaurantId: string, cardId: string, active: boolean, actorId: string): Promise<ToggleResult> {
  return db.$transaction(async tx => {
    const card = await tx.card.findFirst({ where: { id: cardId, restaurantId, isTest: false } });
    if (!card) return { ok: false, code: 'NOT_FOUND' } as const;
    if (card.approvalStatus !== 'APPROVED') return { ok: false, code: 'NOT_APPROVED' } as const;
    if (card.active !== active) {
      const { count } = await tx.card.updateMany({ where: { id: card.id, approvalStatus: 'APPROVED', active: !active }, data: { active } });
      if (count === 1) await record(tx, card.id, active ? 'ENABLED' : 'DISABLED', 'RESTAURANT', actorId);
    }
    const fresh = await tx.card.findUniqueOrThrow({ where: { id: card.id } });
    return { ok: true, card: view(fresh) } as const;
  });
}

// ---------------------------------------------------------------------------------------------- administrators

export type DecideResult =
  | { result: 'APPROVED' | 'REJECTED'; card: { id: string; last4: string; restaurantId: string | null } }
  | { result: 'ALREADY_DECIDED' | 'NOT_FOUND'; status?: CardStatus };

/** Compare-and-set on PENDING: two admins pressing at once produce exactly one decision (the other sees ALREADY_DECIDED). */
export async function decideCard(input: { cardId: string; adminId: string; decision: 'APPROVE' | 'REJECT' }, now = new Date()): Promise<DecideResult> {
  return db.$transaction(async tx => {
    const card = await tx.card.findFirst({ where: { id: input.cardId, isTest: false } });
    if (!card) return { result: 'NOT_FOUND' } as const;
    const approve = input.decision === 'APPROVE';
    const { count } = await tx.card.updateMany({
      where: { id: card.id, approvalStatus: 'PENDING' },
      data: approve ? { approvalStatus: 'APPROVED', active: true, decidedAt: now, decidedBy: input.adminId }
        : { approvalStatus: 'REJECTED', active: false, decidedAt: now, decidedBy: input.adminId },
    });
    if (count !== 1) {
      const cur = await tx.card.findUniqueOrThrow({ where: { id: card.id } });
      return { result: 'ALREADY_DECIDED', status: statusOf(cur) } as const;
    }
    await record(tx, card.id, approve ? 'APPROVED' : 'REJECTED', 'ADMIN', input.adminId);
    return { result: approve ? 'APPROVED' : 'REJECTED', card: { id: card.id, last4: card.last4, restaurantId: card.restaurantId } } as const;
  });
}

/** What an administrator needs to compare with the restaurant: full number, restaurant, who/when. Never exposed to restaurants. */
export async function cardForAdmin(cardId: string) {
  const c = await db.card.findFirst({ where: { id: cardId, isTest: false }, include: { restaurant: { select: { name: true, slug: true, pickupPhone: true } } } });
  return c ? { id: c.id, last4: c.last4, number: c.number, holderName: c.holderName, status: statusOf(c), restaurant: c.restaurant, createdAt: c.createdAt } : null;
}

export async function cardsForAdmin(limit = 30) {
  const rows = await db.card.findMany({
    where: { isTest: false }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit,
    include: { restaurant: { select: { name: true } } },
  });
  return rows.map(c => ({ id: c.id, last4: c.last4, status: statusOf(c), restaurant: c.restaurant?.name ?? 'PLATFORMA', hasNumber: c.number !== null }));
}

/** Pending cards no administrator has been told about yet (the Telegram notifier marks them once a message went out). */
export const unannouncedPending = () => db.card.findMany({
  where: { isTest: false, approvalStatus: 'PENDING', adminNotifiedAt: null }, orderBy: { createdAt: 'asc' }, take: 20, select: { id: true },
});
export const markAnnounced = (cardId: string) => db.card.updateMany({ where: { id: cardId, adminNotifiedAt: null }, data: { adminNotifiedAt: new Date() } });
