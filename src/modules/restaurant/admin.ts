import { db } from '../../lib/db.js';
import { isSupportAdmin } from '../support/service.js';

/**
 * Stage 8C: platform-administrator control of a restaurant's participation (Telegram /restaurants, no admin APK in the pilot).
 * Suspending stops new checkouts (the quote/checkout rule already refuses an inactive restaurant), blocks login and signs out every
 * open session. Existing orders are untouched. Every change is recorded in the append-only AdminAuditEvent.
 */
export interface AdminRestaurantRow {
  id: string; slug: string; name: string; isActive: boolean; isPaused: boolean; staffLinked: boolean; hasPassword: boolean; hasFinancePin: boolean; enabledCards: number; pendingCards: number;
}

export async function listRestaurantsForAdmin(): Promise<AdminRestaurantRow[]> {
  const rows = await db.restaurant.findMany({
    orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 50,
    select: {
      id: true, slug: true, name: true, isActive: true, isPaused: true, staffTelegramUserId: true, credential: { select: { restaurantId: true } }, financePin: { select: { id: true } },
      cards: { where: { isTest: false }, select: { active: true, approvalStatus: true } },
    },
  });
  return rows.map(r => ({
    id: r.id, slug: r.slug, name: r.name, isActive: r.isActive, isPaused: r.isPaused, staffLinked: r.staffTelegramUserId !== null, hasPassword: r.credential !== null, hasFinancePin: r.financePin !== null,
    enabledCards: r.cards.filter(c => c.active).length, pendingCards: r.cards.filter(c => c.approvalStatus === 'PENDING').length,
  }));
}

export type SetActiveResult = { result: 'CHANGED' | 'UNCHANGED' | 'NOT_FOUND'; signedOut?: number };

export async function setRestaurantActive(input: { restaurantId: string; active: boolean; adminId: string }, now = new Date()): Promise<SetActiveResult> {
  if (!isSupportAdmin(input.adminId)) throw new Error('ADMIN_RUXSAT_YOQ');
  return db.$transaction(async tx => {
    const r = await tx.restaurant.findUnique({ where: { id: input.restaurantId }, select: { id: true } });
    if (!r) return { result: 'NOT_FOUND' } as const;
    const { count } = await tx.restaurant.updateMany({ where: { id: r.id, isActive: !input.active }, data: { isActive: input.active } });
    if (count !== 1) return { result: 'UNCHANGED' } as const;
    let signedOut = 0;
    if (!input.active) {
      signedOut = (await tx.restaurantSession.updateMany({ where: { restaurantId: r.id, revokedAt: null }, data: { revokedAt: now } })).count;
    }
    await tx.adminAuditEvent.create({ data: {
      actorId: input.adminId, action: input.active ? 'RESTAURANT_RESUMED' : 'RESTAURANT_SUSPENDED', targetType: 'Restaurant', targetId: r.id, details: { signedOut },
    } });
    return { result: 'CHANGED', signedOut } as const;
  });
}
