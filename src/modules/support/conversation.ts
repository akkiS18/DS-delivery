import { randomUUID } from 'node:crypto';
import { Prisma, type SupportTicketStatus } from '@prisma/client';
import { db } from '../../lib/db.js';
import { firstDelivery, isSupportAdmin, requireAdmin } from './service.js';

export const MAX_FOLLOWUP = 1000;
export const MAX_DELIVERY_ATTEMPTS = 8;
/** A message being sent is leased this long; a crashed sender's message becomes due again afterwards. */
export const SEND_LEASE_MS = 60_000;

/** Exponential backoff after the n-th failed attempt: 5s, 10s, 20s ... capped at 1h. */
export function retryDelayMs(attempts: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 60 * 60_000);
}

export function validateText(raw: string): string {
  const text = raw.trim();
  if (!text || text.length > MAX_FOLLOWUP) throw new Error('SUPPORT_XABAR_UZUNLIGI');
  return text;
}

interface LockedTicket {
  id: string; number: number; orderId: string; customerId: string;
  status: SupportTicketStatus; assignedAdminTelegramId: string | null; assignedAdminName: string | null;
}
/** Row lock: concurrent state changes on one ticket are serialized and always see the committed state. */
async function lockTicket(tx: Prisma.TransactionClient, id: string): Promise<LockedTicket | null> {
  const rows = await tx.$queryRaw<LockedTicket[]>`
    SELECT "id","number","orderId","customerId","status","assignedAdminTelegramId","assignedAdminName"
    FROM "SupportTicket" WHERE "id" = ${id} FOR UPDATE`;
  return rows[0] ?? null;
}

export type MessageResult =
  | { result: 'SENT'; messageId: string; number: number }
  | { result: 'DUPLICATE' }
  | { result: 'NOT_FOUND' }
  | { result: 'ALREADY_RESOLVED' }
  | { result: 'NOT_CLAIMED' }
  | { result: 'NOT_YOURS'; assignedAdminName: string };

/** Customer follow-up. The ticket must belong to this Telegram user; foreign and unknown ids look the same. */
export async function addCustomerMessage(input: {
  telegramUserId: string; ticketId: string; text: string; telegramMessageId: number;
}): Promise<MessageResult> {
  const text = validateText(input.text);
  return db.$transaction(async tx => {
    const customer = await tx.customer.findUnique({ where: { telegramUserId: input.telegramUserId }, select: { id: true } });
    const t = await lockTicket(tx, input.ticketId);
    if (!customer || !t || t.customerId !== customer.id) return { result: 'NOT_FOUND' };
    if (t.status === 'RESOLVED') return { result: 'ALREADY_RESOLVED' };
    const id = randomUUID();
    const { count } = await tx.supportTicketMessage.createMany({
      data: [{ id, ticketId: t.id, senderType: 'CUSTOMER', senderTelegramId: input.telegramUserId,
        telegramMessageId: input.telegramMessageId, text }],
      skipDuplicates: true, // redelivered Telegram update
    });
    if (count !== 1) return { result: 'DUPLICATE' };
    await tx.supportTicketEvent.create({
      data: { ticketId: t.id, actorTelegramId: input.telegramUserId, actorType: 'CUSTOMER',
        action: 'CUSTOMER_MESSAGE', fromStatus: t.status, toStatus: t.status, details: { messageId: id } },
    });
    return { result: 'SENT', messageId: id, number: t.number };
  });
}

/** A customer who keeps writing without any answer can send this many messages in a row (a flood guard; the next admin reply resets it). */
export const MAX_UNANSWERED_APP_MESSAGES = 10;

export type AppMessageResult = MessageResult | { result: 'TOO_MANY' };

/** Customer message written in an app. The customer comes from the authenticated session (never from the request), a foreign and an unknown
 *  ticket look the same, and a retry with the same clientKey returns DUPLICATE without a second row. */
export async function addAppCustomerMessage(input: {
  customerId: string; ticketId: string; text: string; clientKey: string;
}): Promise<AppMessageResult> {
  const text = validateText(input.text);
  const sender = `app:${input.customerId}`;
  return db.$transaction(async tx => {
    const t = await lockTicket(tx, input.ticketId);
    if (!t || t.customerId !== input.customerId) return { result: 'NOT_FOUND' };
    if (t.status === 'RESOLVED') return { result: 'ALREADY_RESOLVED' };
    const lastAdmin = await tx.supportTicketMessage.findFirst({
      where: { ticketId: t.id, senderType: 'ADMIN' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true },
    });
    const unanswered = await tx.supportTicketMessage.count({
      where: { ticketId: t.id, senderType: 'CUSTOMER', ...(lastAdmin ? { createdAt: { gt: lastAdmin.createdAt } } : {}) },
    });
    if (unanswered >= MAX_UNANSWERED_APP_MESSAGES) return { result: 'TOO_MANY' };
    const id = randomUUID();
    const { count } = await tx.supportTicketMessage.createMany({
      data: [{ id, ticketId: t.id, senderType: 'CUSTOMER', senderTelegramId: sender, clientKey: input.clientKey, text }],
      skipDuplicates: true, // the app retried a message whose answer it did not see
    });
    if (count !== 1) return { result: 'DUPLICATE' };
    await tx.supportTicketEvent.create({
      data: { ticketId: t.id, actorTelegramId: sender, actorType: 'CUSTOMER',
        action: 'CUSTOMER_MESSAGE', fromStatus: t.status, toStatus: t.status, details: { messageId: id, via: 'app' } },
    });
    return { result: 'SENT', messageId: id, number: t.number };
  });
}

/** Admin reply: only the admin who currently owns an IN_PROGRESS ticket. Written in Telegram it carries the Telegram message id; written in the
 *  admin app it carries a `clientKey` instead (a retry with the same key is a DUPLICATE, never a second message). One of the two is required. */
export async function addAdminReply(input: {
  actorTelegramId: string; actorName: string; ticketId: string; text: string; telegramMessageId?: number | undefined; clientKey?: string | undefined;
}): Promise<MessageResult> {
  requireAdmin(input.actorTelegramId);
  if (input.telegramMessageId === undefined && !input.clientKey) throw new Error('SUPPORT_XABAR_KALITI_YOQ');
  const text = validateText(input.text);
  return db.$transaction(async tx => {
    const t = await lockTicket(tx, input.ticketId);
    if (!t) return { result: 'NOT_FOUND' };
    if (t.status === 'RESOLVED') return { result: 'ALREADY_RESOLVED' };
    if (t.status === 'OPEN') return { result: 'NOT_CLAIMED' };
    if (t.assignedAdminTelegramId !== input.actorTelegramId) {
      return { result: 'NOT_YOURS', assignedAdminName: t.assignedAdminName ?? '' };
    }
    const id = randomUUID();
    const { count } = await tx.supportTicketMessage.createMany({
      data: [{ id, ticketId: t.id, senderType: 'ADMIN', senderTelegramId: input.actorTelegramId,
        senderName: input.actorName.slice(0, 100), telegramMessageId: input.telegramMessageId ?? null, clientKey: input.clientKey ?? null, text }],
      skipDuplicates: true,
    });
    if (count !== 1) return { result: 'DUPLICATE' };
    await tx.supportTicketEvent.create({
      data: { ticketId: t.id, actorTelegramId: input.actorTelegramId, actorType: 'ADMIN',
        action: 'ADMIN_REPLY', fromStatus: t.status, toStatus: t.status, details: { messageId: id, ...(input.clientKey ? { via: 'admin-app' } : {}) } },
    });
    return { result: 'SENT', messageId: id, number: t.number };
  });
}

export type TransitionResult =
  | { result: 'DONE'; ticketId: string; previousAdminTelegramId?: string }
  | { result: 'DUPLICATE' }
  | { result: 'NOT_FOUND' }
  | { result: 'NOT_ACTIVE' }
  | { result: 'NOT_RESOLVED' }
  | { result: 'SAME_ADMIN' }
  | { result: 'NOT_ALLOWED' }
  | { result: 'INVALID_TARGET' }
  | { result: 'ALREADY_ACTIVE'; number: number };

/** Moves an IN_PROGRESS ticket to another admin. The owner may hand it over; any other admin may
 *  only take it over for themselves. The row lock makes the owner read + update one atomic step. */
export async function reassignTicket(input: {
  actorTelegramId: string; ticketId: string; targetTelegramId: string; targetName: string; callbackQueryId: string;
}): Promise<TransitionResult> {
  requireAdmin(input.actorTelegramId);
  if (!isSupportAdmin(input.targetTelegramId)) return { result: 'INVALID_TARGET' };
  return db.$transaction(async tx => {
    if (!await firstDelivery(tx, { callbackQueryId: input.callbackQueryId, ticketId: input.ticketId,
      actor: input.actorTelegramId, action: 'REASSIGN' })) return { result: 'DUPLICATE' };
    const t = await lockTicket(tx, input.ticketId);
    if (!t) return { result: 'NOT_FOUND' };
    const reject = async (result: 'NOT_ACTIVE' | 'SAME_ADMIN' | 'NOT_ALLOWED') => {
      await tx.supportTicketEvent.create({
        data: { ticketId: t.id, actorTelegramId: input.actorTelegramId, actorType: 'ADMIN',
          action: 'REASSIGN_REJECTED', fromStatus: t.status, toStatus: t.status,
          details: { reason: result, target: input.targetTelegramId } },
      });
      return { result } as const;
    };
    if (t.status !== 'IN_PROGRESS' || !t.assignedAdminTelegramId) return reject('NOT_ACTIVE');
    if (t.assignedAdminTelegramId === input.targetTelegramId) return reject('SAME_ADMIN');
    if (input.actorTelegramId !== t.assignedAdminTelegramId && input.actorTelegramId !== input.targetTelegramId) {
      return reject('NOT_ALLOWED');
    }
    const { count } = await tx.supportTicket.updateMany({
      where: { id: t.id, status: 'IN_PROGRESS', assignedAdminTelegramId: t.assignedAdminTelegramId },
      data: { assignedAdminTelegramId: input.targetTelegramId, assignedAdminName: input.targetName.slice(0, 100),
        claimedAt: new Date() },
    });
    if (count !== 1) return reject('NOT_ACTIVE'); // unreachable under the row lock; kept as a guard
    await tx.supportTicketEvent.create({
      data: { ticketId: t.id, actorTelegramId: input.actorTelegramId, actorType: 'ADMIN', action: 'REASSIGNED',
        fromStatus: 'IN_PROGRESS', toStatus: 'IN_PROGRESS',
        details: { from: t.assignedAdminTelegramId, to: input.targetTelegramId } },
    });
    return { result: 'DONE', ticketId: t.id, previousAdminTelegramId: t.assignedAdminTelegramId };
  });
}

/** RESOLVED -> OPEN with no owner, so either admin can claim it again. The customer is told again
 *  on the next resolve (customerNotifiedAt is cleared). Refused while another unresolved ticket exists for the order. */
export async function reopenTicket(input: {
  actorTelegramId: string; ticketId: string; callbackQueryId: string;
}): Promise<TransitionResult> {
  requireAdmin(input.actorTelegramId);
  try {
    return await db.$transaction(async tx => {
      if (!await firstDelivery(tx, { callbackQueryId: input.callbackQueryId, ticketId: input.ticketId,
        actor: input.actorTelegramId, action: 'REOPEN' })) return { result: 'DUPLICATE' };
      const t = await lockTicket(tx, input.ticketId);
      if (!t) return { result: 'NOT_FOUND' };
      const reject = async (details: Prisma.InputJsonValue) => tx.supportTicketEvent.create({
        data: { ticketId: t.id, actorTelegramId: input.actorTelegramId, actorType: 'ADMIN',
          action: 'REOPEN_REJECTED', fromStatus: t.status, toStatus: t.status, details },
      });
      if (t.status !== 'RESOLVED') { await reject({ reason: 'NOT_RESOLVED' }); return { result: 'NOT_RESOLVED' }; }
      const active = await tx.supportTicket.findFirst({
        where: { orderId: t.orderId, status: { in: ['OPEN', 'IN_PROGRESS'] } }, select: { number: true },
      });
      if (active) { await reject({ reason: 'ALREADY_ACTIVE', number: active.number }); return { result: 'ALREADY_ACTIVE', number: active.number }; }
      await tx.supportTicket.update({
        where: { id: t.id },
        data: { status: 'OPEN', assignedAdminTelegramId: null, assignedAdminName: null, claimedAt: null,
          resolvedAt: null, customerNotifiedAt: null },
      });
      await tx.supportTicketEvent.create({
        data: { ticketId: t.id, actorTelegramId: input.actorTelegramId, actorType: 'ADMIN', action: 'REOPENED',
          fromStatus: 'RESOLVED', toStatus: 'OPEN', details: { previousAdmin: t.assignedAdminTelegramId } },
      });
      return { result: 'DONE', ticketId: t.id, previousAdminTelegramId: t.assignedAdminTelegramId ?? undefined };
    });
  } catch (err) {
    // Partial unique index lost a race with a newly created ticket for the same order.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const t = await db.supportTicket.findUnique({ where: { id: input.ticketId }, select: { orderId: true } });
      const active = t && await db.supportTicket.findFirst({
        where: { orderId: t.orderId, status: { in: ['OPEN', 'IN_PROGRESS'] } }, select: { number: true },
      });
      if (active) return { result: 'ALREADY_ACTIVE', number: active.number };
    }
    throw err;
  }
}

/** The customer's own unresolved tickets (ids are only ever returned for the owner). */
export async function listCustomerActiveTickets(telegramUserId: string) {
  return db.supportTicket.findMany({
    where: { customer: { telegramUserId }, status: { in: ['OPEN', 'IN_PROGRESS'] } },
    orderBy: { createdAt: 'desc' }, take: 5,
    select: { id: true, number: true, order: { select: { code: true } } },
  });
}
export async function customerActiveTicket(telegramUserId: string, ticketId: string) {
  return db.supportTicket.findFirst({
    where: { id: ticketId, customer: { telegramUserId }, status: { in: ['OPEN', 'IN_PROGRESS'] } },
    select: { id: true, number: true },
  });
}
