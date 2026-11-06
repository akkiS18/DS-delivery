import type { OrderStatus } from '@prisma/client';
import { db } from '../../lib/db.js';
import { isSupportAdmin } from '../support/service.js';

/**
 * Administrators remove test restaurants and taxi companies from Telegram.
 *  - Nothing ever happened with it (no orders / payments / dispatches / commission): it is DELETED for good.
 *  - It has history (money and delivery records are append-only and are never deleted): it is ARCHIVED - switched off, hidden from customers,
 *    sign-in and sessions removed, cards disabled, Telegram link released, and its slug/name freed so the same name can be created again.
 *  - It still has an unfinished order / open dispatch / unresolved refund: refused (finish or cancel those first).
 * Every outcome is written to the append-only AdminAuditEvent.
 */
const FINISHED: OrderStatus[] = ['COMPLETED', 'CUSTOMER_CANCELLED', 'RESTAURANT_REJECTED', 'RESTAURANT_EXPIRED', 'PAYMENT_EXPIRED', 'CANCELLED', 'FAILED'];
const OPEN_DISPATCH = ['SCHEDULED', 'SENDING', 'REQUESTED', 'ACCEPTED', 'CANCELLATION_PENDING', 'ASSIGNED', 'NEEDS_HELP'] as const;
const OPEN_REFUND = ['REQUESTED', 'APPROVED', 'SENT', 'DISPUTED'] as const;

const requireAdmin = (adminId: string): void => { if (!isSupportAdmin(adminId)) throw new Error('ADMIN_RUXSAT_YOQ'); };

export type RemovalPlan =
  | { result: 'NOT_FOUND' }
  | { result: 'BLOCKED'; name: string; reason: 'OPEN_ORDERS' | 'OPEN_REFUNDS' | 'OPEN_DISPATCHES'; count: number }
  | { result: 'DELETE' | 'ARCHIVE'; name: string; orders: number; dueSom: number };

export type RemovalOutcome =
  | { result: 'NOT_FOUND' }
  | { result: 'BLOCKED'; name: string; reason: 'OPEN_ORDERS' | 'OPEN_REFUNDS' | 'OPEN_DISPATCHES'; count: number }
  | { result: 'DELETED' | 'ARCHIVED'; name: string };

const shortId = (id: string): string => id.slice(-5).toLowerCase();

export async function planRestaurantRemoval(adminId: string, restaurantId: string): Promise<RemovalPlan> {
  requireAdmin(adminId);
  const r = await db.restaurant.findUnique({ where: { id: restaurantId }, select: { id: true, name: true } });
  if (!r) return { result: 'NOT_FOUND' };
  const [orders, openOrders, openRefunds, payments, commission] = await Promise.all([
    db.order.count({ where: { restaurantId, isDemo: false } }), // an admin "sinov" order is no history
    db.order.count({ where: { restaurantId, isDemo: false, status: { notIn: FINISHED } } }),
    db.refundRequest.count({ where: { order: { restaurantId }, status: { in: [...OPEN_REFUND] } } }),
    db.payment.count({ where: { restaurantId } }),
    db.commissionEntry.aggregate({ where: { restaurantId, waiver: null }, _count: { _all: true }, _sum: { amountSom: true } }),
  ]);
  if (openOrders) return { result: 'BLOCKED', name: r.name, reason: 'OPEN_ORDERS', count: openOrders };
  if (openRefunds) return { result: 'BLOCKED', name: r.name, reason: 'OPEN_REFUNDS', count: openRefunds };
  const settlements = await db.commissionSettlement.count({ where: { restaurantId } });
  const hasHistory = orders > 0 || payments > 0 || commission._count._all > 0 || settlements > 0;
  return { result: hasHistory ? 'ARCHIVE' : 'DELETE', name: r.name, orders, dueSom: commission._sum.amountSom ?? 0 };
}

export async function removeRestaurant(input: { adminId: string; restaurantId: string }): Promise<RemovalOutcome> {
  const plan = await planRestaurantRemoval(input.adminId, input.restaurantId);
  if (plan.result === 'NOT_FOUND') return plan;
  if (plan.result === 'BLOCKED') return plan;
  const r = await db.restaurant.findUniqueOrThrow({ where: { id: input.restaurantId }, select: { id: true, slug: true, name: true } });
  await db.order.deleteMany({ where: { restaurantId: r.id, isDemo: true } }); // the fake order must not stop (or survive) the removal
  const audit = (action: string) => db.adminAuditEvent.create({ data: { actorId: input.adminId, action, targetType: 'Restaurant', targetId: r.id, details: { slug: r.slug, name: r.name, orders: plan.orders } } });

  if (plan.result === 'DELETE') {
    try {
      await db.$transaction(async tx => {
        const cards = await tx.card.findMany({ where: { restaurantId: r.id }, select: { id: true } });
        const cardIds = cards.map(c => c.id);
        await tx.cardEvent.deleteMany({ where: { cardId: { in: cardIds } } });
        await tx.cardCooldown.deleteMany({ where: { cardId: { in: cardIds } } });
        await tx.card.deleteMany({ where: { restaurantId: r.id } });
        await tx.catalogEvent.deleteMany({ where: { restaurantId: r.id } });
        await tx.product.deleteMany({ where: { restaurantId: r.id } });
        await tx.category.deleteMany({ where: { restaurantId: r.id } });
        await tx.restaurant.delete({ where: { id: r.id } }); // credential and sessions cascade
      });
      await audit('RESTAURANT_DELETED');
      return { result: 'DELETED', name: r.name };
    } catch {
      // Something we did not expect still references it: keep every record, archive instead.
    }
  }

  await db.$transaction(async tx => {
    const now = new Date();
    await tx.restaurant.update({
      where: { id: r.id },
      data: { isActive: false, isPaused: true, staffTelegramUserId: null, staffLinkedAt: null, slug: `arxiv-${shortId(r.id)}-${r.slug}`.slice(0, 40) },
    });
    await tx.card.updateMany({ where: { restaurantId: r.id }, data: { active: false } });
    await tx.restaurantSession.updateMany({ where: { restaurantId: r.id, revokedAt: null }, data: { revokedAt: now } });
    await tx.restaurantCredential.deleteMany({ where: { restaurantId: r.id } });
  });
  await audit('RESTAURANT_ARCHIVED');
  return { result: 'ARCHIVED', name: r.name };
}

export async function planTaxiRemoval(adminId: string, companyId: string): Promise<RemovalPlan> {
  requireAdmin(adminId);
  const c = await db.taxiCompany.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
  if (!c) return { result: 'NOT_FOUND' };
  const [open, dispatches, orders] = await Promise.all([
    db.taxiDispatch.count({ where: { taxiCompanyId: companyId, status: { in: [...OPEN_DISPATCH] } } }),
    db.taxiDispatch.count({ where: { taxiCompanyId: companyId } }),
    db.order.count({ where: { taxiCompanyId: companyId } }),
  ]);
  if (open) return { result: 'BLOCKED', name: c.name, reason: 'OPEN_DISPATCHES', count: open };
  return { result: dispatches > 0 || orders > 0 ? 'ARCHIVE' : 'DELETE', name: c.name, orders: Math.max(dispatches, orders), dueSom: 0 };
}

export async function removeTaxiCompany(input: { adminId: string; companyId: string }): Promise<RemovalOutcome> {
  const plan = await planTaxiRemoval(input.adminId, input.companyId);
  if (plan.result === 'NOT_FOUND') return plan;
  if (plan.result === 'BLOCKED') return plan;
  const c = await db.taxiCompany.findUniqueOrThrow({ where: { id: input.companyId }, select: { id: true, name: true } });
  const audit = (action: string) => db.adminAuditEvent.create({ data: { actorId: input.adminId, action, targetType: 'TaxiCompany', targetId: c.id, details: { name: c.name, records: plan.orders } } });

  if (plan.result === 'DELETE') {
    try {
      await db.taxiCompany.delete({ where: { id: c.id } }); // credential, sessions and invites cascade
      await audit('TAXI_COMPANY_DELETED');
      return { result: 'DELETED', name: c.name };
    } catch { /* still referenced: archive below */ }
  }

  await db.$transaction(async tx => {
    const now = new Date();
    await tx.taxiCompany.update({
      where: { id: c.id },
      data: { isActive: false, operatorTelegramUserId: null, operatorLinkedAt: null, name: `${c.name} [arxiv ${shortId(c.id)}]`.slice(0, 120) },
    });
    await tx.taxiSession.updateMany({ where: { taxiCompanyId: c.id, revokedAt: null }, data: { revokedAt: now } });
    await tx.taxiCredential.deleteMany({ where: { taxiCompanyId: c.id } });
    await tx.taxiOperatorInvite.updateMany({ where: { taxiCompanyId: c.id, usedAt: null }, data: { expiresAt: now } });
  });
  await audit('TAXI_COMPANY_ARCHIVED');
  return { result: 'ARCHIVED', name: c.name };
}
