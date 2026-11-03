import { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';
import { cardNumberSchema, holderNameSchema, statusOf, type CardStatus } from '../restaurant-cards/service.js';
import { isSupportAdmin } from '../support/service.js';
import { POOL_TURNOVER_DAYS, cardLabelOf, cardTurnoverSom, poolCapSom } from './pool.js';

/** Administrator tools for the platform card pool (owner decision 2026-10-30). Everything here is support-admin only and audited. */

export type AddPlatformCardResult =
  | { ok: true; cardId: string; last4: string }
  | { ok: false; code: 'CARD_NUMBER_INVALID' | 'HOLDER_INVALID' | 'CARD_TAKEN' };

/**
 * Adds a platform card as PENDING (restaurantId null). It is announced to the administrators like any new card and only becomes usable after the
 * existing two-step approval (card-admin.ts), so a typo or a stray command never sends customers' money to a card.
 */
export async function addPlatformCard(input: { adminId: string; number: string; holderName: string }): Promise<AddPlatformCardResult> {
  if (!isSupportAdmin(input.adminId)) throw new Error('ADMIN_RUXSAT_YOQ');
  const number = cardNumberSchema.safeParse(input.number);
  if (!number.success) return { ok: false, code: 'CARD_NUMBER_INVALID' };
  const holder = holderNameSchema.safeParse(input.holderName);
  if (!holder.success) return { ok: false, code: 'HOLDER_INVALID' };
  const last4 = number.data.slice(-4);
  try {
    return await db.$transaction(async tx => {
      if (await tx.card.findUnique({ where: { last4 }, select: { id: true } })) return { ok: false, code: 'CARD_TAKEN' } as const;
      const card = await tx.card.create({ data: { restaurantId: null, last4, number: number.data, holderName: holder.data, isTest: false, active: false, approvalStatus: 'PENDING', label: cardLabelOf(number.data) } });
      await tx.cardEvent.create({ data: { cardId: card.id, action: 'ADDED', actorType: 'ADMIN', actorId: input.adminId, details: { platformCard: true } } });
      return { ok: true, cardId: card.id, last4 } as const;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: false, code: 'CARD_TAKEN' };
    throw e;
  }
}

export type EditCardResult =
  | { result: 'DONE' | 'UNCHANGED'; last4: string }
  | { result: 'NOT_FOUND' | 'HOLDER_INVALID' | 'NOT_APPROVED' | 'LAST_ACTIVE_CARD' }
  | { result: 'OPEN_PAYMENTS'; count: number };

const findPoolCard = (tx: Prisma.TransactionClient, last4: string) => tx.card.findFirst({ where: { last4, restaurantId: null, isTest: false } });

/** Changes the name shown to paying customers on a platform card (audited). Letters, spaces, dots and hyphens only, like when the card is added. */
export async function renamePlatformCard(input: { adminId: string; last4: string; holderName: string }): Promise<EditCardResult> {
  if (!isSupportAdmin(input.adminId)) throw new Error('ADMIN_RUXSAT_YOQ');
  const holder = holderNameSchema.safeParse(input.holderName);
  if (!holder.success) return { result: 'HOLDER_INVALID' };
  return db.$transaction(async tx => {
    const card = await findPoolCard(tx, input.last4);
    if (!card) return { result: 'NOT_FOUND' } as const;
    if (card.holderName === holder.data) return { result: 'UNCHANGED', last4: card.last4 } as const;
    await tx.card.update({ where: { id: card.id }, data: { holderName: holder.data } });
    await tx.cardEvent.create({ data: { cardId: card.id, action: 'RENAMED', actorType: 'ADMIN', actorId: input.adminId, details: { from: card.holderName, to: holder.data } } });
    return { result: 'DONE', last4: card.last4 } as const;
  });
}

/**
 * Switches a platform card off (customers stop being given it; the card and its history stay) or back on. Runs under the payment lock. Switching OFF
 * is refused while a customer is still paying to the card, and for the last active card (the pool would be empty). Switching ON needs an approved card.
 */
export async function setPlatformCardActive(input: { adminId: string; last4: string; active: boolean }): Promise<EditCardResult> {
  if (!isSupportAdmin(input.adminId)) throw new Error('ADMIN_RUXSAT_YOQ');
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(7013, 3001)`;
    const card = await findPoolCard(tx, input.last4);
    if (!card) return { result: 'NOT_FOUND' } as const;
    if (card.approvalStatus !== 'APPROVED') return { result: 'NOT_APPROVED' } as const;
    if (card.active === input.active) return { result: 'UNCHANGED', last4: card.last4 } as const;
    if (!input.active) {
      const open = await tx.payment.count({ where: { cardId: card.id, status: { in: ['QUEUED', 'AWAITING'] } } });
      if (open > 0) return { result: 'OPEN_PAYMENTS', count: open } as const;
      const others = await tx.card.count({ where: { restaurantId: null, isTest: false, active: true, approvalStatus: 'APPROVED', id: { not: card.id } } });
      const served = await tx.restaurant.count({ where: { collectsToPlatform: true } });
      if (others === 0 && served > 0) return { result: 'LAST_ACTIVE_CARD' } as const;
    }
    await tx.card.update({ where: { id: card.id }, data: { active: input.active } });
    await tx.cardEvent.create({ data: { cardId: card.id, action: input.active ? 'ENABLED' : 'DISABLED', actorType: 'ADMIN', actorId: input.adminId } });
    return { result: 'DONE', last4: card.last4 } as const;
  });
}

export type CollectResult =
  | { result: 'CHANGED' | 'UNCHANGED'; name: string }
  | { result: 'NOT_FOUND' }
  | { result: 'NO_POOL_CARD' }
  | { result: 'OPEN_PAYMENTS'; name: string; count: number };

/**
 * Switches one restaurant between "paid on its own cards" and "paid on the platform pool". Runs under the payment advisory lock (the same one that
 * serializes card assignment and bank matching) and refuses while the restaurant still has an unpaid card payment: such a payment sits on a card of
 * the OLD owner, and the match check would send its money to review. Payments already matched are not affected.
 */
export async function setCollectsToPlatform(input: { adminId: string; slug: string; on: boolean }): Promise<CollectResult> {
  if (!isSupportAdmin(input.adminId)) throw new Error('ADMIN_RUXSAT_YOQ');
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(7013, 3001)`;
    const r = await tx.restaurant.findUnique({ where: { slug: input.slug }, select: { id: true, name: true, collectsToPlatform: true } });
    if (!r) return { result: 'NOT_FOUND' } as const;
    if (r.collectsToPlatform === input.on) return { result: 'UNCHANGED', name: r.name } as const;
    if (input.on && (await tx.card.count({ where: { restaurantId: null, isTest: false, active: true, approvalStatus: 'APPROVED' } })) === 0) return { result: 'NO_POOL_CARD' } as const;
    const open = await tx.payment.count({ where: { restaurantId: r.id, isTest: false, method: 'CARD', status: { in: ['QUEUED', 'AWAITING'] } } });
    if (open > 0) return { result: 'OPEN_PAYMENTS', name: r.name, count: open } as const;
    await tx.restaurant.update({ where: { id: r.id }, data: { collectsToPlatform: input.on } });
    await tx.adminAuditEvent.create({ data: {
      actorId: input.adminId, action: input.on ? 'COLLECTS_TO_PLATFORM_ON' : 'COLLECTS_TO_PLATFORM_OFF', targetType: 'Restaurant', targetId: r.id, details: { slug: input.slug },
    } });
    return { result: 'CHANGED', name: r.name } as const;
  });
}

export interface PoolOverview {
  capSom: number;
  days: number;
  cards: Array<{ last4: string; status: CardStatus; turnoverSom: number }>;
  restaurants: Array<{ name: string; slug: string }>;
}

export async function poolOverview(now = new Date()): Promise<PoolOverview> {
  const cards = await db.card.findMany({ where: { restaurantId: null, isTest: false }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const turnover = await cardTurnoverSom(db, cards.map(c => c.id), now);
  const restaurants = await db.restaurant.findMany({ where: { collectsToPlatform: true }, select: { name: true, slug: true }, orderBy: { name: 'asc' } });
  return {
    capSom: poolCapSom(), days: POOL_TURNOVER_DAYS,
    cards: cards.map(c => ({ last4: c.last4, status: statusOf(c), turnoverSom: turnover.get(c.id) ?? 0 })), restaurants,
  };
}
