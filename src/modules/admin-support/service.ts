import { db } from '../../lib/db.js';
import { supportAdminIds } from '../support/service.js';

/**
 * DS Admin app, A4a: the support inbox. Reads are assembled here; every change calls the same guarded service the Telegram buttons call
 * (claimTicket / resolveTicket / reassignTicket / reopenTicket / addAdminReply), so the bot and the app are two doors on one set of rules.
 */
const RESOLVED_DAYS = 7;
const LIST_LIMIT = 60;
const PREVIEW = 140;

export interface TicketRow {
  id: string; number: number; status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
  assignedAdminName: string | null; mine: boolean;
  orderCode: string; restaurantName: string; customerName: string | null;
  createdAt: string; lastAt: string; lastFrom: 'CUSTOMER' | 'ADMIN'; lastText: string;
  /** The customer wrote last (or only the opening message exists) and the ticket is not resolved: somebody owes an answer. */
  waiting: boolean;
}

/** A general question (no order) keeps the same JSON shape for the admin app: these stand in for the order code and the restaurant. */
const NO_ORDER_CODE = "—";
const NO_ORDER_NAME = "Buyurtmasiz";

const rowSelect = {
  id: true, number: true, status: true, message: true, createdAt: true, resolvedAt: true,
  assignedAdminTelegramId: true, assignedAdminName: true,
  order: { select: { code: true, restaurant: { select: { name: true } } } },
  customer: { select: { displayName: true } },
  messages: { orderBy: { createdAt: 'desc' as const }, take: 1, select: { senderType: true, text: true, createdAt: true } },
} as const;

type RowSource = {
  id: string; number: number; status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'; message: string; createdAt: Date;
  assignedAdminTelegramId: string | null; assignedAdminName: string | null;
  order: { code: string; restaurant: { name: string } } | null; customer: { displayName: string | null };
  messages: Array<{ senderType: string; text: string; createdAt: Date }>;
};

/** Pure: one inbox row. */
export function toRow(t: RowSource, adminId: string): TicketRow {
  const last = t.messages[0];
  const lastFrom: 'CUSTOMER' | 'ADMIN' = last?.senderType === 'ADMIN' ? 'ADMIN' : 'CUSTOMER';
  return {
    id: t.id, number: t.number, status: t.status, assignedAdminName: t.assignedAdminName,
    mine: t.status === 'IN_PROGRESS' && t.assignedAdminTelegramId === adminId,
    orderCode: t.order?.code ?? NO_ORDER_CODE, restaurantName: t.order?.restaurant.name ?? NO_ORDER_NAME, customerName: t.customer.displayName,
    createdAt: t.createdAt.toISOString(), lastAt: (last?.createdAt ?? t.createdAt).toISOString(),
    lastFrom, lastText: (last?.text ?? t.message).slice(0, PREVIEW),
    waiting: t.status !== 'RESOLVED' && lastFrom === 'CUSTOMER',
  };
}

export async function listInbox(adminId: string): Promise<{ active: TicketRow[]; resolved: TicketRow[] }> {
  const since = new Date(Date.now() - RESOLVED_DAYS * 86_400_000);
  const [active, resolved] = await Promise.all([
    db.supportTicket.findMany({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } }, orderBy: { createdAt: 'asc' }, take: LIST_LIMIT, select: rowSelect }),
    db.supportTicket.findMany({ where: { status: 'RESOLVED', resolvedAt: { gte: since } }, orderBy: { resolvedAt: 'desc' }, take: 30, select: rowSelect }),
  ]);
  return { active: active.map(t => toRow(t, adminId)), resolved: resolved.map(t => toRow(t, adminId)) };
}

export interface ThreadMessage { id: string; from: 'CUSTOMER' | 'ADMIN'; text: string; at: string; byName: string | null; failed: boolean }

export interface TicketThread {
  ticket: TicketRow & { resolvedAt: string | null };
  order: { code: string; status: string; totalSom: number; restaurantName: string };
  customer: { name: string | null; phone: string | null; viaApp: boolean };
  messages: ThreadMessage[];
  /** The other administrators a ticket can be handed to. */
  others: Array<{ telegramId: string; name: string }>;
}

/** The display name the other administrators see: the last name this administrator claimed a ticket under, else "Admin <id>". */
export async function adminDisplayName(telegramId: string): Promise<string> {
  const t = await db.supportTicket.findFirst({
    where: { assignedAdminTelegramId: telegramId, assignedAdminName: { not: null } },
    orderBy: { claimedAt: 'desc' }, select: { assignedAdminName: true },
  });
  return t?.assignedAdminName?.trim() || `Admin ${telegramId}`;
}

export async function ticketThread(adminId: string, ticketId: string): Promise<TicketThread | null> {
  const t = await db.supportTicket.findUnique({
    where: { id: ticketId },
    select: {
      ...rowSelect, resolvedAt: true,
      order: { select: { code: true, status: true, totalSom: true, restaurant: { select: { name: true } } } },
      customer: { select: { displayName: true, phone: true, telegramUserId: true } },
      messages: { orderBy: { createdAt: 'asc' }, take: 300, select: { id: true, senderType: true, senderName: true, text: true, createdAt: true, failedAt: true } },
    },
  });
  if (!t) return null;
  const latest = t.messages[t.messages.length - 1];
  const row = toRow({ ...t, messages: latest ? [{ senderType: latest.senderType, text: latest.text, createdAt: latest.createdAt }] : [] }, adminId);
  const others = await Promise.all(supportAdminIds().filter(id => id !== adminId).map(async id => ({ telegramId: id, name: await adminDisplayName(id) })));
  return {
    ticket: { ...row, resolvedAt: t.resolvedAt?.toISOString() ?? null },
    order: t.order ? { code: t.order.code, status: t.order.status, totalSom: t.order.totalSom, restaurantName: t.order.restaurant.name } : { code: NO_ORDER_CODE, status: "", totalSom: 0, restaurantName: NO_ORDER_NAME },
    customer: { name: t.customer.displayName, phone: t.customer.phone, viaApp: t.customer.telegramUserId === null },
    messages: [
      { id: `first-${t.id}`, from: 'CUSTOMER', text: t.message, at: t.createdAt.toISOString(), byName: null, failed: false },
      ...t.messages.map(m => ({
        id: m.id, from: (m.senderType === 'ADMIN' ? 'ADMIN' : 'CUSTOMER') as 'ADMIN' | 'CUSTOMER', text: m.text, at: m.createdAt.toISOString(),
        byName: m.senderType === 'ADMIN' ? m.senderName : null, failed: m.failedAt !== null,
      })),
    ],
    others,
  };
}

/**
 * Edits the administrators' Telegram copies of a ticket and sends what is pending (admin cards, "resolved" notices, conversation messages).
 * The HTTP app is built before the bot, so server.ts registers the real function once polling is up; without one nothing happens and the
 * normal 5-second support worker catches up anyway. Best effort: a failed refresh never fails or undoes the change.
 */
export type SupportSync = (ticketId: string) => Promise<void>;
let sync: SupportSync | null = null;
export function setSupportSync(fn: SupportSync | null): void { sync = fn; }
export async function syncSupport(ticketId: string): Promise<void> {
  if (!sync) return;
  try { await sync(ticketId); } catch { /* best effort */ }
}
