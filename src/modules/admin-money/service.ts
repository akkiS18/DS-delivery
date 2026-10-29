import { db } from '../../lib/db.js';
import { cardForAdmin, cardsForAdmin, groupCard, maskCard, statusOf, type CardStatus } from '../restaurant-cards/service.js';
import { cardTurnoverSom, poolCapSom, POOL_TURNOVER_DAYS } from '../payment/pool.js';
import { REVIEW_ACTIONS, REVIEW_ACTION_LABEL, explainReason } from '../payment/review-reasons.js';
import { listStaleUnverified, listUnhandledReviews } from '../payment/review.js';
import { TURNOVER_HIGH, TURNOVER_MID } from '../admin-attention/service.js';

/**
 * DS Admin app, stage A2: read models for money and cards. The write paths are the existing services the Telegram commands use
 * (handleReview, decideCard, addPlatformCard, setCollectsToPlatform): the app only adds a second door to the same guarded code.
 */

const som = (tiyin: bigint): number => Number(tiyin / 100n);

export interface MoneySnapshot {
  reviews: Array<{
    id: string; cardLast4: string; amountSom: number; occurredAt: string; emailReceivedAt: string | null;
    reason: string | null; reasonText: string; source: string; restaurantName: string | null;
  }>;
  stale: Array<{ orderCode: string | null; restaurantName: string; amountSom: number; matchedAt: string }>;
  actions: Array<{ action: string; label: string }>;
}

export async function moneySnapshot(): Promise<MoneySnapshot> {
  const [reviews, stale] = await Promise.all([listUnhandledReviews(50), listStaleUnverified(10)]);
  return {
    reviews: reviews.map(r => ({
      id: r.id, cardLast4: r.cardLast4, amountSom: som(r.amountTiyin), occurredAt: r.occurredAt.toISOString(), emailReceivedAt: r.emailReceivedAt?.toISOString() ?? null,
      reason: r.reason, reasonText: explainReason(r.reason), source: r.source, restaurantName: r.restaurantName,
    })),
    stale: stale.map(s => ({ orderCode: s.orderCode, restaurantName: s.restaurantName, amountSom: som(s.amountTiyin), matchedAt: s.matchedAt.toISOString() })),
    actions: REVIEW_ACTIONS.map(a => ({ action: a, label: REVIEW_ACTION_LABEL[a] })),
  };
}

export interface CardRow { id: string; last4: string; masked: string; status: CardStatus; restaurant: string; platform: boolean }

/** Every real card, newest first. Numbers are masked here; the full number is only in {@link cardDetail} and only while a card waits for approval. */
export async function cardList(): Promise<CardRow[]> {
  const rows = await cardsForAdmin(60);
  return rows.map(r => ({ id: r.id, last4: r.last4, masked: maskCard(r.last4), status: r.status, restaurant: r.restaurant, platform: r.restaurant === 'PLATFORMA' }));
}

export interface CardDetail {
  id: string; last4: string; status: CardStatus; holderName: string | null; createdAt: string;
  /** Grouped full number: ONLY for a PENDING card (the administrator must compare it with what the owner says by phone). */
  number: string | null;
  restaurant: { name: string; phone: string | null } | null;
}

export async function cardDetail(cardId: string): Promise<CardDetail | null> {
  const c = await cardForAdmin(cardId);
  if (!c) return null;
  return {
    id: c.id, last4: c.last4, status: c.status, holderName: c.holderName, createdAt: c.createdAt.toISOString(),
    number: c.status === 'PENDING' && c.number ? groupCard(c.number) : null,
    restaurant: c.restaurant ? { name: c.restaurant.name, phone: c.restaurant.pickupPhone } : null,
  };
}

export type PoolLevel = 'OK' | 'MID' | 'HIGH';
export const levelOf = (ratio: number): PoolLevel => (ratio >= TURNOVER_HIGH ? 'HIGH' : ratio >= TURNOVER_MID ? 'MID' : 'OK');

export interface PoolSnapshot {
  capSom: number;
  days: number;
  cards: Array<{ id: string; last4: string; status: CardStatus; holderName: string | null; turnoverSom: number; percent: number | null; level: PoolLevel }>;
  /** Every restaurant that can be switched, with its current mode. */
  restaurants: Array<{ slug: string; name: string; collectsToPlatform: boolean }>;
}

export async function poolSnapshot(now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<PoolSnapshot> {
  const cap = poolCapSom(env);
  const cards = await db.card.findMany({ where: { restaurantId: null, isTest: false }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const turnover = await cardTurnoverSom(db, cards.map(c => c.id), now);
  const restaurants = await db.restaurant.findMany({
    where: { OR: [{ isActive: true }, { collectsToPlatform: true }] }, select: { slug: true, name: true, collectsToPlatform: true }, orderBy: { name: 'asc' },
  });
  return {
    capSom: cap, days: POOL_TURNOVER_DAYS,
    cards: cards.map(c => {
      const used = turnover.get(c.id) ?? 0;
      const ratio = cap > 0 ? used / cap : 0;
      return { id: c.id, last4: c.last4, status: statusOf(c), holderName: c.holderName, turnoverSom: used, percent: cap > 0 ? Math.floor(ratio * 100) : null, level: levelOf(ratio) };
    }),
    restaurants,
  };
}
