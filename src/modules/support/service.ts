import { Prisma, type SupportTicketStatus } from '@prisma/client';
import { db } from '../../lib/db.js';

export const MIN_MESSAGE = 5;
export const MAX_MESSAGE = 1000;

/** Two equal administrators, configured by Telegram user id. Read per call so tests can override. */
export function supportAdminIds(src: NodeJS.ProcessEnv = process.env): string[] {
  const ids = [src.SUPPORT_ADMIN_1_TELEGRAM_ID, src.SUPPORT_ADMIN_2_TELEGRAM_ID]
    .map(v => v?.trim() ?? '')
    .filter(v => v !== '');
  for (const id of ids) {
    if (!/^\d{1,20}$/.test(id)) throw new Error('SUPPORT_ADMIN_*_TELEGRAM_ID faqat raqamlardan iborat bo‘lsin');
  }
  return [...new Set(ids)];
}
export function isSupportAdmin(telegramUserId: string, src: NodeJS.ProcessEnv = process.env): boolean {
  return supportAdminIds(src).includes(telegramUserId);
}
export function requireAdmin(actor: string): void {
  if (!isSupportAdmin(actor)) throw new Error('SUPPORT_ADMIN_RUXSAT_YOQ');
}

/** Orders of this Telegram user only. */
export async function listCustomerOrders(telegramUserId: string) {
  return db.order.findMany({
    where: { customer: { telegramUserId } },
    orderBy: { createdAt: 'desc' }, take: 10,
    select: { id: true, code: true, status: true },
  });
}

export type CreateTicketResult =
  | { result: 'CREATED'; ticketId: string; number: number }
  | { result: 'ALREADY_OPEN'; number: number; ticketId: string }
  | { result: 'NOT_FOUND' }
  | { result: 'UNAVAILABLE' }
  | { result: 'LIMIT' };

/** A customer writing from an app can have this many unresolved tickets at a time (a flood guard; each order still allows only one). */
export const MAX_OPEN_TICKETS_PER_CUSTOMER = 5;

/** Ownership is verified in the same query: an order id alone is never trusted.
 *  A foreign and a non-existent order are indistinguishable to the caller. */
export async function createTicket(input: {
  telegramUserId: string; orderId: string; message: string;
}): Promise<CreateTicketResult> {
  return createTicketFor({ customer: { telegramUserId: input.telegramUserId } }, input.telegramUserId, input.orderId, input.message, Infinity);
}

/** Same as createTicket for a customer written in an app (Mini App or Android guest): the customer row id comes from the authenticated session. */
export async function createAppTicket(input: {
  customerId: string; orderId: string; message: string;
}): Promise<CreateTicketResult> {
  return createTicketFor({ customerId: input.customerId }, `app:${input.customerId}`, input.orderId, input.message, MAX_OPEN_TICKETS_PER_CUSTOMER);
}

async function createTicketFor(
  owner: { customer: { telegramUserId: string } } | { customerId: string }, actor: string, orderId: string, rawMessage: string, maxOpen: number,
): Promise<CreateTicketResult> {
  const message = rawMessage.trim();
  if (message.length < MIN_MESSAGE || message.length > MAX_MESSAGE) throw new Error('SUPPORT_XABAR_UZUNLIGI');
  if (!supportAdminIds().length) return { result: 'UNAVAILABLE' };
  const order = await db.order.findFirst({ where: { id: orderId, ...owner }, select: { id: true, customerId: true } });
  if (!order) return { result: 'NOT_FOUND' };
  const existing = await db.supportTicket.findFirst({ where: { orderId: order.id, status: { in: ['OPEN', 'IN_PROGRESS'] } }, select: { id: true, number: true } });
  if (existing) return { result: 'ALREADY_OPEN', number: existing.number, ticketId: existing.id };
  if (await db.supportTicket.count({ where: { customerId: order.customerId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }) >= maxOpen) return { result: 'LIMIT' };
  try {
    return await db.$transaction(async tx => {
      const ticket = await tx.supportTicket.create({
        data: { orderId: order.id, customerId: order.customerId, message },
      });
      await tx.supportTicketEvent.create({
        data: { ticketId: ticket.id, actorTelegramId: actor, actorType: 'CUSTOMER',
          action: 'CREATED', toStatus: 'OPEN' },
      });
      return { result: 'CREATED' as const, ticketId: ticket.id, number: ticket.number };
    });
  } catch (err) {
    // Partial unique index: one unresolved ticket per order.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await db.supportTicket.findFirst({
        where: { orderId: order.id, status: { in: ['OPEN', 'IN_PROGRESS'] } }, select: { id: true, number: true },
      });
      if (existing) return { result: 'ALREADY_OPEN', number: existing.number, ticketId: existing.id };
    }
    throw err;
  }
}

/** The public ticket number (the "#12" in every bot message) -> its id and state. Callers must already have checked that the actor is an admin. */
export async function ticketByNumber(number: number) {
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return db.supportTicket.findUnique({ where: { number }, select: { id: true, status: true } });
}

export type ActionResult =
  | { result: 'DONE'; ticketId: string }
  | { result: 'DUPLICATE' }
  | { result: 'NOT_FOUND' }
  | { result: 'ALREADY_CLAIMED'; assignedAdminTelegramId: string; assignedAdminName: string }
  | { result: 'ALREADY_RESOLVED' }
  | { result: 'NOT_YOURS'; assignedAdminName: string }
  | { result: 'NOT_CLAIMED' };

/** Records the Telegram callback id; false if it was already processed (duplicate delivery). */
export async function firstDelivery(tx: Prisma.TransactionClient, input: {
  callbackQueryId: string; ticketId: string; actor: string; action: string;
}): Promise<boolean> {
  const { count } = await tx.supportCallbackLog.createMany({
    data: [{ callbackQueryId: input.callbackQueryId, ticketId: input.ticketId,
      actorTelegramId: input.actor, action: input.action }],
    skipDuplicates: true, // ON CONFLICT DO NOTHING keeps the transaction usable
  });
  return count === 1;
}

/** "Men oldim". The conditional UPDATE is the lock: under READ COMMITTED a concurrent
 *  claim waits for the row, re-checks status = 'OPEN' and updates 0 rows. */
export async function claimTicket(input: {
  actorTelegramId: string; actorName: string; ticketId: string; callbackQueryId: string;
}): Promise<ActionResult> {
  requireAdmin(input.actorTelegramId);
  return db.$transaction(async tx => {
    if (!await firstDelivery(tx, { callbackQueryId: input.callbackQueryId, ticketId: input.ticketId,
      actor: input.actorTelegramId, action: 'CLAIM' })) return { result: 'DUPLICATE' };
    const now = new Date();
    const { count } = await tx.supportTicket.updateMany({
      where: { id: input.ticketId, status: 'OPEN' },
      data: { status: 'IN_PROGRESS', assignedAdminTelegramId: input.actorTelegramId,
        assignedAdminName: input.actorName.slice(0, 100), claimedAt: now },
    });
    if (count === 1) {
      await tx.supportTicketEvent.create({
        data: { ticketId: input.ticketId, actorTelegramId: input.actorTelegramId, actorType: 'ADMIN',
          action: 'CLAIMED', fromStatus: 'OPEN', toStatus: 'IN_PROGRESS' },
      });
      return { result: 'DONE', ticketId: input.ticketId };
    }
    const t = await tx.supportTicket.findUnique({ where: { id: input.ticketId } });
    if (!t) return { result: 'NOT_FOUND' };
    await tx.supportTicketEvent.create({
      data: { ticketId: t.id, actorTelegramId: input.actorTelegramId, actorType: 'ADMIN',
        action: 'CLAIM_REJECTED', fromStatus: t.status, toStatus: t.status,
        details: { heldBy: t.assignedAdminTelegramId } },
    });
    if (t.status === 'RESOLVED') return { result: 'ALREADY_RESOLVED' };
    return { result: 'ALREADY_CLAIMED', assignedAdminTelegramId: t.assignedAdminTelegramId ?? '',
      assignedAdminName: t.assignedAdminName ?? '' };
  });
}

/** Only the admin who claimed the ticket may resolve it. */
export async function resolveTicket(input: {
  actorTelegramId: string; ticketId: string; callbackQueryId: string;
}): Promise<ActionResult> {
  requireAdmin(input.actorTelegramId);
  return db.$transaction(async tx => {
    if (!await firstDelivery(tx, { callbackQueryId: input.callbackQueryId, ticketId: input.ticketId,
      actor: input.actorTelegramId, action: 'RESOLVE' })) return { result: 'DUPLICATE' };
    const { count } = await tx.supportTicket.updateMany({
      where: { id: input.ticketId, status: 'IN_PROGRESS', assignedAdminTelegramId: input.actorTelegramId },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    if (count === 1) {
      await tx.supportTicketEvent.create({
        data: { ticketId: input.ticketId, actorTelegramId: input.actorTelegramId, actorType: 'ADMIN',
          action: 'RESOLVED', fromStatus: 'IN_PROGRESS', toStatus: 'RESOLVED' },
      });
      return { result: 'DONE', ticketId: input.ticketId };
    }
    const t = await tx.supportTicket.findUnique({ where: { id: input.ticketId } });
    if (!t) return { result: 'NOT_FOUND' };
    await tx.supportTicketEvent.create({
      data: { ticketId: t.id, actorTelegramId: input.actorTelegramId, actorType: 'ADMIN',
        action: 'RESOLVE_REJECTED', fromStatus: t.status, toStatus: t.status },
    });
    if (t.status === 'RESOLVED') return { result: 'ALREADY_RESOLVED' };
    if (t.status === 'OPEN') return { result: 'NOT_CLAIMED' };
    return { result: 'NOT_YOURS', assignedAdminName: t.assignedAdminName ?? '' };
  });
}

/** Admin-only listing of unresolved tickets. */
export async function listActiveTickets(actorTelegramId: string) {
  requireAdmin(actorTelegramId);
  return db.supportTicket.findMany({
    where: { status: { in: ['OPEN', 'IN_PROGRESS'] } }, orderBy: { createdAt: 'asc' }, take: 20,
    select: { id: true, number: true, status: true, assignedAdminName: true, order: { select: { code: true } } },
  });
}

const ticketView = {
  id: true, number: true, message: true, status: true, assignedAdminTelegramId: true,
  assignedAdminName: true, createdAt: true,
  order: { select: { code: true, totalSom: true, status: true, restaurant: { select: { name: true } } } },
  customer: { select: { displayName: true, phone: true } },
} satisfies Prisma.SupportTicketSelect;

/** Admin view of one ticket (full customer contact data, admins only). */
export async function ticketForAdmin(actorTelegramId: string, ticketId: string) {
  requireAdmin(actorTelegramId);
  return db.supportTicket.findUnique({ where: { id: ticketId }, select: ticketView });
}
export type AdminTicket = NonNullable<Awaited<ReturnType<typeof ticketForAdmin>>>;

/** Customer view: scoped by the owner's Telegram id, never by ticket id alone. */
export async function listCustomerTickets(telegramUserId: string) {
  return db.supportTicket.findMany({
    where: { customer: { telegramUserId } }, orderBy: { createdAt: 'desc' }, take: 10,
    select: { number: true, status: true, createdAt: true, order: { select: { code: true } } },
  });
}

export function statusLabel(s: SupportTicketStatus): string {
  return s === 'OPEN' ? '🆕 Ochiq' : s === 'IN_PROGRESS' ? '🛠 Jarayonda' : '✅ Hal qilindi';
}
