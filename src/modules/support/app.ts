import { db } from '../../lib/db.js';

/**
 * The customer side of the support chat inside the apps (Mini App and Android). Every read is scoped to the customer row that the
 * authenticated session resolved to; a foreign and an unknown ticket look the same (null). Admin names are never shown to the customer.
 */
export type AppTicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

export interface AppTicketSummary {
  id: string; number: number; orderId: string; orderCode: string; restaurantName: string;
  status: AppTicketStatus; createdAt: string; lastAt: string; lastFrom: 'CUSTOMER' | 'ADMIN'; lastText: string; unread: boolean;
}

const LIST_LIMIT = 30;

/** Unread = an admin message (or the resolution) newer than the last time the customer opened the ticket. */
export function isUnread(input: { seenAt: Date | null; lastAdminAt: Date | null; status: AppTicketStatus; resolvedAt: Date | null }): boolean {
  const newest = [input.lastAdminAt, input.status === 'RESOLVED' ? input.resolvedAt : null]
    .filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0];
  if (!newest) return false;
  return !input.seenAt || newest.getTime() > input.seenAt.getTime();
}

export async function listAppTickets(customerId: string): Promise<AppTicketSummary[]> {
  const tickets = await db.supportTicket.findMany({
    where: { customerId }, orderBy: { createdAt: 'desc' }, take: LIST_LIMIT,
    select: {
      id: true, number: true, orderId: true, message: true, status: true, createdAt: true, resolvedAt: true, customerSeenAt: true,
      order: { select: { code: true, restaurant: { select: { name: true } } } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { senderType: true, text: true, createdAt: true } },
    },
  });
  if (!tickets.length) return [];
  const admin = await db.supportTicketMessage.groupBy({
    by: ['ticketId'], where: { ticketId: { in: tickets.map(t => t.id) }, senderType: 'ADMIN' }, _max: { createdAt: true },
  });
  const lastAdmin = new Map(admin.map(g => [g.ticketId, g._max.createdAt]));
  return tickets.map(t => {
    const last = t.messages[0];
    const status = t.status as AppTicketStatus;
    return {
      id: t.id, number: t.number, orderId: t.orderId, orderCode: t.order.code, restaurantName: t.order.restaurant.name, status,
      createdAt: t.createdAt.toISOString(),
      lastAt: (last?.createdAt ?? t.createdAt).toISOString(),
      lastFrom: (last?.senderType === 'ADMIN' ? 'ADMIN' : 'CUSTOMER') as 'ADMIN' | 'CUSTOMER',
      lastText: (last?.text ?? t.message).slice(0, 140),
      unread: isUnread({ seenAt: t.customerSeenAt, lastAdminAt: lastAdmin.get(t.id) ?? null, status, resolvedAt: t.resolvedAt }),
    };
  }).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export async function countUnreadAppTickets(customerId: string): Promise<number> {
  return (await listAppTickets(customerId)).filter(t => t.unread).length;
}

export interface AppThread {
  ticket: { id: string; number: number; orderId: string; orderCode: string; restaurantName: string; status: AppTicketStatus; createdAt: string };
  messages: Array<{ id: string; from: 'CUSTOMER' | 'ADMIN'; text: string; at: string }>;
}

/** The conversation, oldest first (the first bubble is the message the ticket was opened with). Opening it marks it as read. */
export async function appTicketThread(customerId: string, ticketId: string): Promise<AppThread | null> {
  const t = await db.supportTicket.findFirst({
    where: { id: ticketId, customerId },
    select: {
      id: true, number: true, orderId: true, message: true, status: true, createdAt: true,
      order: { select: { code: true, restaurant: { select: { name: true } } } },
      messages: { orderBy: { createdAt: 'asc' }, take: 300, select: { id: true, senderType: true, text: true, createdAt: true } },
    },
  });
  if (!t) return null;
  await db.supportTicket.updateMany({ where: { id: t.id, customerId }, data: { customerSeenAt: new Date() } });
  return {
    ticket: { id: t.id, number: t.number, orderId: t.orderId, orderCode: t.order.code, restaurantName: t.order.restaurant.name, status: t.status as AppTicketStatus, createdAt: t.createdAt.toISOString() },
    messages: [
      { id: `first-${t.id}`, from: 'CUSTOMER', text: t.message, at: t.createdAt.toISOString() },
      ...t.messages.map(m => ({ id: m.id, from: (m.senderType === 'ADMIN' ? 'ADMIN' : 'CUSTOMER') as 'ADMIN' | 'CUSTOMER', text: m.text, at: m.createdAt.toISOString() })),
    ],
  };
}
