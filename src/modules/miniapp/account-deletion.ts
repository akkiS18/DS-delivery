import { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';

/**
 * Account deletion (Google Play policy + privacy law). "Delete" here means: erase everything that identifies the person, keep what the business must keep.
 *
 *  - Erased / cleared: name, phone, Telegram id, saved addresses (and coordinates), device/installation ids, guest sessions (revoked), the phone / address /
 *    coordinates copied into each order, the phone / name / note copied into each table booking, free text of rating notes and support messages.
 *  - Kept, no longer tied to a person: the Customer row itself (deletedAt set), orders, payments, refunds, commission and audit rows (accounting, disputes).
 *  - A blocked customer, or one with active strikes, keeps the Telegram id on the row so the block cannot be dodged by deleting and coming back (fraud
 *    protection; disclosed in the privacy policy). Everything else is erased for them as well.
 *
 * Refused (409) while money or food is still in motion: an unfinished order, an unfinished booking, an open refund. The customer finishes or cancels it first.
 * Idempotent: a second call on a deleted account changes nothing. The Customer row is locked, so two simultaneous calls act once.
 */
export const DELETED_TEXT = '[o‘chirilgan]';

/** Order statuses that can no longer change by themselves (nothing is cooking, nobody is driving, no money is waiting). */
export const FINAL_ORDER_STATUSES = ['CUSTOMER_CANCELLED', 'RESTAURANT_REJECTED', 'RESTAURANT_EXPIRED', 'PAYMENT_EXPIRED', 'COMPLETED', 'CANCELLED', 'FAILED'] as const;
const OPEN_REFUND_STATUSES = ['REQUESTED', 'APPROVED', 'SENT', 'DISPUTED'];

export class AccountDeletionError extends Error {
  constructor(readonly statusCode: number, readonly code: 'NOT_FOUND' | 'OPEN_ORDER' | 'OPEN_RESERVATION' | 'OPEN_REFUND') { super(code); }
}

export type DeletionResult = {
  result: 'DELETED' | 'ALREADY_DELETED';
  orders: number; reservations: number; addresses: number; sessions: number; supportMessages: number; keptTelegramId: boolean;
};

const empty = (result: DeletionResult['result']): DeletionResult => ({ result, orders: 0, reservations: 0, addresses: 0, sessions: 0, supportMessages: 0, keptTelegramId: false });

/** `actor` goes to the audit row: "customer:<id>" for the person themselves, "cli:<name>" for an administrator working from an e-mail request. */
export async function deleteCustomerAccount(customerId: string, actor: string, now = new Date()): Promise<DeletionResult> {
  return db.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ id: string; deletedAt: Date | null; mergedIntoId: string | null }>>(
      Prisma.sql`SELECT "id", "deletedAt", "mergedIntoId" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`);
    const row = rows[0];
    if (!row || row.mergedIntoId) throw new AccountDeletionError(404, 'NOT_FOUND');

    // One person = this row plus the guest rows that were merged into it (orders made before the Telegram link live on those).
    const merged = await tx.customer.findMany({ where: { mergedIntoId: customerId }, select: { id: true } });
    const ids = [customerId, ...merged.map(m => m.id)];

    // Already deleted AND nothing personal came back (a blocked customer keeps their Telegram id and may open the app again): nothing to do, no new audit row.
    if (row.deletedAt) {
      const [again, addressesLeft, ordersLeft] = await Promise.all([
        tx.customer.count({ where: { id: { in: ids }, OR: [{ phone: { not: null } }, { displayName: { not: null } }] } }),
        tx.customerAddress.count({ where: { customerId: { in: ids } } }),
        tx.order.count({ where: { customerId: { in: ids }, OR: [{ phoneSnapshot: { not: null } }, { addressText: { not: DELETED_TEXT } }] } }),
      ]);
      if (again + addressesLeft + ordersLeft === 0) return empty('ALREADY_DELETED');
    }

    if (await tx.order.count({ where: { customerId: { in: ids }, status: { notIn: [...FINAL_ORDER_STATUSES] } } })) throw new AccountDeletionError(409, 'OPEN_ORDER');
    if (await tx.reservation.count({ where: { customerId: { in: ids }, OR: [{ status: 'PENDING_PAYMENT' }, { status: 'PAID', startsAt: { gt: now } }] } })) {
      throw new AccountDeletionError(409, 'OPEN_RESERVATION');
    }
    if (await tx.refundRequest.count({ where: { order: { customerId: { in: ids } }, status: { in: OPEN_REFUND_STATUSES } } })) throw new AccountDeletionError(409, 'OPEN_REFUND');

    const [activeStrikes, blocked] = await Promise.all([
      tx.customerStrike.count({ where: { customerId: { in: ids }, revokedAt: null } }),
      tx.customer.count({ where: { id: { in: ids }, blockedAt: { not: null } } }),
    ]);
    const keepTelegramId = activeStrikes > 0 || blocked > 0;

    const addresses = (await tx.customerAddress.deleteMany({ where: { customerId: { in: ids } } })).count;
    const sessions = (await tx.guestSession.updateMany({ where: { customerId: { in: ids }, revokedAt: null }, data: { revokedAt: now, revokedReason: 'ACCOUNT_DELETED' } })).count;
    await tx.guestSession.updateMany({ where: { customerId: { in: ids }, installationId: { not: null } }, data: { installationId: null } });
    await tx.telegramLinkAttempt.updateMany({ where: { guestCustomerId: { in: ids } }, data: { telegramUserId: null, telegramName: null, telegramUsername: null } });

    const orders = (await tx.order.updateMany({ where: { customerId: { in: ids } }, data: { phoneSnapshot: null, addressText: DELETED_TEXT, deliveryLat: null, deliveryLng: null } })).count;
    const reservations = (await tx.reservation.updateMany({ where: { customerId: { in: ids } }, data: { phoneSnapshot: '-', nameSnapshot: null, note: null } })).count;
    await tx.orderRating.updateMany({ where: { customerId: { in: ids }, note: { not: null } }, data: { note: null } });
    await tx.supportTicket.updateMany({ where: { customerId: { in: ids } }, data: { message: DELETED_TEXT } });
    const supportMessages = (await tx.supportTicketMessage.updateMany({
      where: { senderType: 'CUSTOMER', ticket: { customerId: { in: ids } } }, data: { text: DELETED_TEXT, senderName: null },
    })).count;

    await tx.customer.updateMany({ where: { id: { in: ids } }, data: { displayName: null, phone: null, deletedAt: now } });
    // The unique telegramUserId is freed (a returning person starts as a new customer) unless a block must keep following them.
    if (!keepTelegramId) await tx.customer.updateMany({ where: { id: { in: ids } }, data: { telegramUserId: null } });

    const summary = { orders, reservations, addresses, sessions, supportMessages, keptTelegramId: keepTelegramId };
    await tx.adminAuditEvent.create({ data: { actorId: actor, action: 'CUSTOMER_ACCOUNT_DELETED', targetType: 'Customer', targetId: customerId, details: summary } });
    return { result: 'DELETED', ...summary };
  });
}
