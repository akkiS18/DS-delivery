import { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';
import { isSupportAdmin } from '../support/service.js';

/**
 * Customer strikes and blocks (owner decision 2026-10-30). A customer who did not receive an order gets a strike:
 *   1 active strike  -> cash on delivery is off for them (they can still pay by card);
 *   5 active strikes -> they cannot order at all;
 *   an administrator may also block a customer directly (fake orders), and lift it.
 * Strikes are never deleted: an administrator REVOKES one with a note. Everything an administrator does is audited and needs a written note.
 * Known gap: the block follows the customer record (their Telegram account and the records merged into it); blocking by Android device id needs
 * the customer app to send one and is not built.
 */
export const CASH_OFF_AT = 1;
export const BLOCK_AT = 5;
export const NOTE_MIN = 10;
export const NOTE_MAX = 300;

type Tx = Prisma.TransactionClient | typeof db;

export interface Standing { strikes: number; cashAllowed: boolean; blocked: boolean; manuallyBlocked: boolean }

/** Pure rule. */
export function standingOf(activeStrikes: number, blockedAt: Date | null): Standing {
  const manuallyBlocked = blockedAt !== null;
  return { strikes: activeStrikes, cashAllowed: activeStrikes < CASH_OFF_AT && !manuallyBlocked, blocked: manuallyBlocked || activeStrikes >= BLOCK_AT, manuallyBlocked };
}

/** The customer row and the guest/Telegram records that were merged into it: one person. */
async function familyIds(tx: Tx, customerId: string): Promise<string[]> {
  const merged = await tx.customer.findMany({ where: { mergedIntoId: customerId }, select: { id: true } });
  return [customerId, ...merged.map(m => m.id)];
}

export async function standingOfCustomer(tx: Tx, customerId: string): Promise<Standing> {
  const ids = await familyIds(tx, customerId);
  const [strikes, blocked] = await Promise.all([
    tx.customerStrike.count({ where: { customerId: { in: ids }, revokedAt: null } }),
    tx.customer.findFirst({ where: { id: { in: ids }, blockedAt: { not: null } }, select: { blockedAt: true } }),
  ]);
  return standingOf(strikes, blocked?.blockedAt ?? null);
}

/** What checkout and the "switch to cash" step ask before taking an order. */
export async function orderVerdict(tx: Tx, customerId: string, opts: { cash: boolean }): Promise<'OK' | 'BLOCKED' | 'CASH_OFF'> {
  const s = await standingOfCustomer(tx, customerId);
  if (s.blocked) return 'BLOCKED';
  if (opts.cash && !s.cashAllowed) return 'CASH_OFF';
  return 'OK';
}

function requireAdmin(adminId: string): void {
  if (!isSupportAdmin(adminId)) throw new Error('ADMIN_RUXSAT_YOQ');
}
function cleanNote(raw: string): string {
  const note = raw.trim();
  if (note.length < NOTE_MIN || note.length > NOTE_MAX) throw new Error('ADMIN_IZOH_NOTOGRI');
  return note;
}
const lockCustomer = (tx: Prisma.TransactionClient, customerId: string) =>
  tx.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(7031, hashtext(${customerId}))`;

export type AddStrikeResult =
  | { result: 'ADDED'; strikeId: string; standing: Standing }
  | { result: 'ALREADY_RECORDED'; strikeId: string; standing: Standing }
  | { result: 'NOT_FOUND' };

/**
 * Records a strike. `orderId` makes it idempotent per (order, source): the restaurant button tapped twice, or a retry, gives the first strike back.
 * The administrator form passes no order.
 */
export async function recordStrike(input: { customerId: string; orderId?: string; source: 'ADMIN' | 'RESTAURANT' | 'TAXI'; reportedBy: string; note: string }): Promise<AddStrikeResult> {
  const note = cleanNote(input.note);
  if (input.source === 'ADMIN') requireAdmin(input.reportedBy);
  return db.$transaction(async tx => {
    await lockCustomer(tx, input.customerId);
    const customer = await tx.customer.findUnique({ where: { id: input.customerId }, select: { id: true } });
    if (!customer) return { result: 'NOT_FOUND' } as const;
    if (input.orderId) {
      const prior = await tx.customerStrike.findFirst({ where: { orderId: input.orderId, source: input.source }, select: { id: true } });
      if (prior) return { result: 'ALREADY_RECORDED', strikeId: prior.id, standing: await standingOfCustomer(tx, input.customerId) } as const;
    }
    const strike = await tx.customerStrike.create({
      data: { customerId: input.customerId, orderId: input.orderId ?? null, source: input.source, reportedBy: input.reportedBy, note },
      select: { id: true },
    });
    if (input.source === 'ADMIN') {
      await tx.adminAuditEvent.create({ data: { actorId: input.reportedBy, action: 'CUSTOMER_STRIKE_ADDED', targetType: 'Customer', targetId: input.customerId, details: { strikeId: strike.id } } });
    }
    return { result: 'ADDED', strikeId: strike.id, standing: await standingOfCustomer(tx, input.customerId) } as const;
  });
}

export type RevokeResult = { result: 'REVOKED'; standing: Standing } | { result: 'NOT_FOUND' } | { result: 'ALREADY_REVOKED' };

export async function revokeStrike(input: { adminId: string; customerId: string; strikeId: string; note: string }): Promise<RevokeResult> {
  requireAdmin(input.adminId);
  const note = cleanNote(input.note);
  return db.$transaction(async tx => {
    await lockCustomer(tx, input.customerId);
    const strike = await tx.customerStrike.findFirst({ where: { id: input.strikeId, customerId: input.customerId }, select: { id: true, revokedAt: true } });
    if (!strike) return { result: 'NOT_FOUND' } as const;
    const done = await tx.customerStrike.updateMany({ where: { id: strike.id, revokedAt: null }, data: { revokedAt: new Date(), revokedBy: input.adminId, revokeNote: note } });
    if (done.count !== 1) return { result: 'ALREADY_REVOKED' } as const;
    await tx.adminAuditEvent.create({ data: { actorId: input.adminId, action: 'CUSTOMER_STRIKE_REVOKED', targetType: 'Customer', targetId: input.customerId, details: { strikeId: strike.id } } });
    return { result: 'REVOKED', standing: await standingOfCustomer(tx, input.customerId) } as const;
  });
}

export type BlockResult = { result: 'CHANGED'; standing: Standing } | { result: 'UNCHANGED' } | { result: 'NOT_FOUND' };

/** Blocks or unblocks one customer record by hand. A repeat changes nothing. */
export async function setCustomerBlock(input: { adminId: string; customerId: string; block: boolean; note: string }): Promise<BlockResult> {
  requireAdmin(input.adminId);
  const note = cleanNote(input.note);
  return db.$transaction(async tx => {
    await lockCustomer(tx, input.customerId);
    const exists = await tx.customer.findUnique({ where: { id: input.customerId }, select: { id: true } });
    if (!exists) return { result: 'NOT_FOUND' } as const;
    const done = input.block
      ? await tx.customer.updateMany({ where: { id: input.customerId, blockedAt: null }, data: { blockedAt: new Date(), blockedBy: input.adminId, blockNote: note } })
      : await tx.customer.updateMany({ where: { id: input.customerId, blockedAt: { not: null } }, data: { blockedAt: null, blockedBy: null, blockNote: null } });
    if (done.count !== 1) return { result: 'UNCHANGED' } as const;
    await tx.adminAuditEvent.create({ data: {
      actorId: input.adminId, action: input.block ? 'CUSTOMER_BLOCKED' : 'CUSTOMER_UNBLOCKED', targetType: 'Customer', targetId: input.customerId, details: { note },
    } });
    return { result: 'CHANGED', standing: await standingOfCustomer(tx, input.customerId) } as const;
  });
}

export interface CustomerRow {
  id: string; name: string | null; phone: string | null; telegramUserId: string | null;
  strikes: number; cashAllowed: boolean; blocked: boolean; manuallyBlocked: boolean; lastStrikeAt: string | null;
}

const rowSelect = { id: true, displayName: true, phone: true, telegramUserId: true, createdAt: true } as const;
type RowSource = { id: string; displayName: string | null; phone: string | null; telegramUserId: string | null };

async function toRow(c: RowSource): Promise<CustomerRow> {
  const s = await standingOfCustomer(db, c.id);
  const last = await db.customerStrike.findFirst({ where: { customerId: c.id, revokedAt: null }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  return { id: c.id, name: c.displayName, phone: c.phone, telegramUserId: c.telegramUserId, ...s, lastStrikeAt: last?.createdAt.toISOString() ?? null };
}

/** With no query: customers who currently have a strike or a block. With a query: a Telegram id, a phone fragment (5+ digits) or a name fragment. */
export async function listCustomers(query: string | undefined): Promise<CustomerRow[]> {
  const q = (query ?? '').trim();
  if (!q) {
    const rows = await db.customer.findMany({
      where: { OR: [{ blockedAt: { not: null } }, { strikes: { some: { revokedAt: null } } }] },
      select: rowSelect, orderBy: { createdAt: 'desc' }, take: 50,
    });
    return Promise.all(rows.map(toRow));
  }
  const digits = q.replace(/\D/g, '');
  const or: Prisma.CustomerWhereInput[] = [];
  if (/^\d{5,}$/.test(q)) or.push({ telegramUserId: q });
  if (digits.length >= 5) or.push({ phone: { contains: digits } });
  if (q.length >= 2 && !/^[+\d\s-]+$/.test(q)) or.push({ displayName: { contains: q, mode: 'insensitive' } });
  if (!or.length) return [];
  const rows = await db.customer.findMany({ where: { OR: or }, select: rowSelect, orderBy: { createdAt: 'desc' }, take: 20 });
  return Promise.all(rows.map(toRow));
}

export interface StrikeLine {
  id: string; source: string; reportedBy: string; note: string; createdAt: string; orderCode: string | null;
  revokedAt: string | null; revokedBy: string | null; revokeNote: string | null;
}
export interface CustomerDetail extends CustomerRow {
  blockNote: string | null; blockedAt: string | null;
  strikeLines: StrikeLine[];
  recentOrders: Array<{ code: string; status: string; totalSom: number; at: string; payment: string | null }>;
}

export async function customerDetail(id: string): Promise<CustomerDetail | null> {
  const c = await db.customer.findUnique({
    where: { id },
    select: {
      ...rowSelect, blockedAt: true, blockNote: true,
      strikes: { orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, source: true, reportedBy: true, note: true, createdAt: true, revokedAt: true, revokedBy: true, revokeNote: true, order: { select: { code: true } } } },
      orders: { orderBy: { createdAt: 'desc' }, take: 8, select: { code: true, status: true, totalSom: true, createdAt: true, payment: { select: { method: true } } } },
    },
  });
  if (!c) return null;
  const row = await toRow(c);
  return {
    ...row, blockNote: c.blockNote, blockedAt: c.blockedAt?.toISOString() ?? null,
    strikeLines: c.strikes.map(s => ({
      id: s.id, source: s.source, reportedBy: s.reportedBy, note: s.note, createdAt: s.createdAt.toISOString(), orderCode: s.order?.code ?? null,
      revokedAt: s.revokedAt?.toISOString() ?? null, revokedBy: s.revokedBy, revokeNote: s.revokeNote,
    })),
    recentOrders: c.orders.map(o => ({ code: o.code, status: o.status, totalSom: o.totalSom, at: o.createdAt.toISOString(), payment: o.payment?.method ?? null })),
  };
}
