import type { Prisma } from '@prisma/client';

/**
 * Who owns an order / profile. A Telegram customer is addressed by the verified Telegram id (as before); an Android guest, or any
 * customer reached through a guest session, by the internal customer id taken from the server-side session row - never from a request.
 */
export type CustomerOwner = string | { customerId: string };

export const customerWhere = (owner: CustomerOwner): Prisma.CustomerWhereInput =>
  typeof owner === 'string' ? { telegramUserId: owner } : { id: owner.customerId };

/** Audit label for the `actorTelegramId` columns: the Telegram id, or "guest:<customerId>" when there is none. */
export const actorLabel = (owner: CustomerOwner): string => (typeof owner === 'string' ? owner : `guest:${owner.customerId}`);
