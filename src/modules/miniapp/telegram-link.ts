import { Prisma, type TelegramLinkStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { db } from '../../lib/db.js';
import { hashToken, issueSession, type IssuedSession } from './guest.js';

/**
 * Optional guest -> Telegram link. Four independent proofs are needed before anything moves:
 *   1. the app session asked for the attempt (authenticated guest session),
 *   2. the Telegram user opened the bot with the one-time token (identity comes from the real bot update, never from the token),
 *   3. that Telegram user pressed "confirm" in the bot,
 *   4. the app owner confirmed the Telegram identity shown in the app.
 * The deep link by itself never gives access to an existing Telegram account.
 *
 * Merge rule when the Telegram account already has a customer (documented in docs/CUSTOMER_ANDROID_MVP.md):
 * orders and support tickets move to it (rows are re-pointed, never re-created, so payments/commission are untouched);
 * saved addresses move unless the same text already exists; the Telegram profile wins phone/name conflicts, the guest value
 * only fills an empty field; the guest row is kept with mergedIntoId and its sessions are revoked.
 */
export const LINK_START_PREFIX = 'lnk_';
export const LINK_TTL_MINUTES = (): number => { const n = Number(process.env.TELEGRAM_LINK_TTL_MINUTES ?? 10); return Number.isInteger(n) && n >= 1 && n <= 60 ? n : 10; };
const LIVE: TelegramLinkStatus[] = ['CREATED', 'BOT_BOUND', 'BOT_CONFIRMED'];

export class LinkError extends Error {
  constructor(readonly statusCode: number, code: string) { super(code); }
}

/** Telegram allows [A-Za-z0-9_-]{1,64} in a /start payload: "lnk_" + 32 base64url chars (24 random bytes) = 36. */
export const botUsername = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const u = env.BOT_USERNAME?.trim().replace(/^@/, '');
  return u && /^[A-Za-z0-9_]{5,32}$/.test(u) ? u : null;
};

export interface LinkPrincipal { customerId: string; sessionId: string }

export async function createLinkAttempt(p: LinkPrincipal, now = new Date()) {
  const username = botUsername();
  if (!username) throw new LinkError(503, 'TELEGRAM_LINK_NOT_CONFIGURED');
  const raw = randomBytes(24).toString('base64url');
  const expiresAt = new Date(now.getTime() + LINK_TTL_MINUTES() * 60_000);
  const attempt = await db.$transaction(async tx => {
    await lockCustomer(tx, p.customerId);
    const c = await tx.customer.findUnique({ where: { id: p.customerId }, select: { telegramUserId: true, mergedIntoId: true } });
    if (!c || c.mergedIntoId) throw new LinkError(404, 'NOT_FOUND');
    if (c.telegramUserId) throw new LinkError(409, 'ALREADY_LINKED');
    // one live attempt per guest: older ones are superseded (the partial unique index enforces it even under a race)
    await tx.telegramLinkAttempt.updateMany({ where: { guestCustomerId: p.customerId, status: { in: LIVE }, expiresAt: { lte: now } }, data: { status: 'EXPIRED' } });
    await tx.telegramLinkAttempt.updateMany({ where: { guestCustomerId: p.customerId, status: { in: LIVE } }, data: { status: 'CANCELLED' } });
    return tx.telegramLinkAttempt.create({ data: { guestCustomerId: p.customerId, sessionId: p.sessionId, tokenHash: hashToken(raw), expiresAt } });
  });
  return { id: attempt.id, status: attempt.status, expiresAt: attempt.expiresAt.toISOString(), deepLink: `https://t.me/${username}?start=${LINK_START_PREFIX}${raw}` };
}

// ------------------------------------------------------------------ the bot side

export interface TelegramIdentity { id: string; name: string | null; username: string | null }
export type BindResult =
  | { result: 'BOUND'; attemptId: string; existingAccount: boolean }
  | { result: 'INVALID' };

/** `/start lnk_<token>`. The first Telegram user to present a live token owns the attempt; anyone else (replay) gets INVALID. */
export async function bindFromBot(rawToken: string, tg: TelegramIdentity, now = new Date()): Promise<BindResult> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(rawToken)) return { result: 'INVALID' };
  const hash = hashToken(rawToken);
  return db.$transaction(async (tx): Promise<BindResult> => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "TelegramLinkAttempt" WHERE "tokenHash" = ${hash} FOR UPDATE`;
    if (!rows[0]) return { result: 'INVALID' };
    const a = await tx.telegramLinkAttempt.findUniqueOrThrow({ where: { id: rows[0].id } });
    if (LIVE.includes(a.status) && a.expiresAt <= now) {
      await tx.telegramLinkAttempt.update({ where: { id: a.id }, data: { status: 'EXPIRED' } });
      return { result: 'INVALID' };
    }
    const exists = Boolean(await tx.customer.findUnique({ where: { telegramUserId: tg.id }, select: { id: true } }));
    if (a.status === 'CREATED') {
      await tx.telegramLinkAttempt.update({ where: { id: a.id }, data: {
        status: 'BOT_BOUND', telegramUserId: tg.id, telegramName: tg.name?.slice(0, 100) ?? null, telegramUsername: tg.username?.slice(0, 64) ?? null, botBoundAt: now,
      } });
      return { result: 'BOUND', attemptId: a.id, existingAccount: exists };
    }
    // the same Telegram user pressing the link again just gets the prompt again; any other user or state is a replay
    if (a.status === 'BOT_BOUND' && a.telegramUserId === tg.id) return { result: 'BOUND', attemptId: a.id, existingAccount: exists };
    return { result: 'INVALID' };
  });
}

/** Bot button. Compare-and-set on (id, status, the bound Telegram id): nobody but the user who opened the link can confirm. */
export async function botDecision(attemptId: string, tgId: string, accept: boolean, now = new Date()): Promise<'CONFIRMED' | 'CANCELLED' | 'INVALID'> {
  if (accept) {
    const r = await db.telegramLinkAttempt.updateMany({
      where: { id: attemptId, status: 'BOT_BOUND', telegramUserId: tgId, expiresAt: { gt: now } },
      data: { status: 'BOT_CONFIRMED', botConfirmedAt: now },
    });
    return r.count === 1 ? 'CONFIRMED' : 'INVALID';
  }
  const r = await db.telegramLinkAttempt.updateMany({
    where: { id: attemptId, status: { in: ['BOT_BOUND', 'BOT_CONFIRMED'] }, telegramUserId: tgId },
    data: { status: 'CANCELLED' },
  });
  return r.count === 1 ? 'CANCELLED' : 'INVALID';
}

// ------------------------------------------------------------------ the app side

async function owned(p: LinkPrincipal, attemptId: string) {
  const a = await db.telegramLinkAttempt.findFirst({ where: { id: attemptId, guestCustomerId: p.customerId, sessionId: p.sessionId } });
  if (!a) throw new LinkError(404, 'NOT_FOUND'); // somebody else's attempt looks exactly like a missing one
  return a;
}

export async function linkStatus(p: LinkPrincipal, attemptId: string, now = new Date()) {
  let a = await owned(p, attemptId);
  if (LIVE.includes(a.status) && a.expiresAt <= now) {
    await db.telegramLinkAttempt.updateMany({ where: { id: a.id, status: { in: LIVE } }, data: { status: 'EXPIRED' } });
    a = await owned(p, attemptId);
  }
  const confirmed = a.status === 'BOT_CONFIRMED';
  const existingAccount = confirmed && a.telegramUserId
    ? Boolean(await db.customer.findUnique({ where: { telegramUserId: a.telegramUserId }, select: { id: true } })) : false;
  return {
    id: a.id, status: a.status, expiresAt: a.expiresAt.toISOString(),
    // The Telegram identity is shown only after that Telegram user confirmed it in the bot.
    telegram: confirmed ? { name: a.telegramName, username: a.telegramUsername } : null,
    existingAccount,
  };
}

export async function cancelLink(p: LinkPrincipal, attemptId: string) {
  await owned(p, attemptId);
  await db.telegramLinkAttempt.updateMany({ where: { id: attemptId, status: { in: LIVE } }, data: { status: 'CANCELLED' } });
  return linkStatus(p, attemptId);
}

async function lockCustomer(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${id} FOR UPDATE`;
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export type CompleteResult =
  | { result: 'COMPLETED'; merged: boolean; session: IssuedSession; summary: Record<string, number | boolean> }
  | { result: 'ALREADY_COMPLETED' };

/**
 * The app owner confirms. One transaction: lock the attempt, lock both customers (id order, so two merges cannot deadlock), move the data,
 * revoke the guest's sessions and issue a fresh one, mark the attempt COMPLETED. A second concurrent confirm waits on the attempt lock and
 * then sees COMPLETED (idempotent: nothing is moved twice). If another request created the Telegram customer meanwhile, the unique
 * telegramUserId rejects our UPDATE and the whole transaction is retried once in merge mode.
 */
export async function completeLink(p: LinkPrincipal, attemptId: string, now = new Date()): Promise<CompleteResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(tx => completeTx(tx, p, attemptId, now), { timeout: 20_000 });
    } catch (err) {
      if (attempt === 0 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
      throw err;
    }
  }
}

async function completeTx(tx: Prisma.TransactionClient, p: LinkPrincipal, attemptId: string, now: Date): Promise<CompleteResult> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "TelegramLinkAttempt" WHERE "id" = ${attemptId} AND "guestCustomerId" = ${p.customerId} AND "sessionId" = ${p.sessionId} FOR UPDATE`;
  if (!locked[0]) throw new LinkError(404, 'NOT_FOUND');
  const a = await tx.telegramLinkAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  if (a.status === 'COMPLETED') return { result: 'ALREADY_COMPLETED' };
  if (a.status === 'CANCELLED' || a.status === 'EXPIRED') throw new LinkError(409, 'LINK_CLOSED');
  if (a.expiresAt <= now) {
    await tx.telegramLinkAttempt.update({ where: { id: a.id }, data: { status: 'EXPIRED' } });
    return Promise.reject(new LinkError(410, 'LINK_EXPIRED'));
  }
  if (a.status !== 'BOT_CONFIRMED' || !a.telegramUserId) throw new LinkError(409, 'BOT_CONFIRMATION_PENDING');

  const target = await tx.customer.findUnique({ where: { telegramUserId: a.telegramUserId }, select: { id: true } });
  const ids = [p.customerId, ...(target ? [target.id] : [])].sort();
  for (const id of ids) await lockCustomer(tx, id); // fixed order
  const guest = await tx.customer.findUniqueOrThrow({ where: { id: p.customerId } });
  if (guest.telegramUserId || guest.mergedIntoId) throw new LinkError(409, 'ALREADY_LINKED');

  let summary: Record<string, number | boolean> = { merged: false };
  let finalId = guest.id;
  if (!target) {
    await tx.customer.update({ where: { id: guest.id }, data: { telegramUserId: a.telegramUserId, ...(guest.displayName ? {} : { displayName: a.telegramName }) } });
  } else {
    const t = await tx.customer.findUniqueOrThrow({ where: { id: target.id } });
    if (t.mergedIntoId) throw new LinkError(409, 'LINK_CLOSED');
    finalId = t.id;
    const orders = await tx.order.updateMany({ where: { customerId: guest.id }, data: { customerId: t.id } });
    const tickets = await tx.supportTicket.updateMany({ where: { customerId: guest.id }, data: { customerId: t.id } });
    const theirs = await tx.customerAddress.findMany({ where: { customerId: t.id } });
    const seen = new Set(theirs.map(x => norm(x.addressText)));
    const mine = await tx.customerAddress.findMany({ where: { customerId: guest.id }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
    let moved = 0; let dropped = 0;
    let defaultTaken = theirs.some(x => x.isDefault);
    for (const addr of mine) {
      if (seen.has(norm(addr.addressText))) { await tx.customerAddress.delete({ where: { id: addr.id } }); dropped++; continue; }
      seen.add(norm(addr.addressText));
      const makeDefault = addr.isDefault && !defaultTaken;
      if (makeDefault) defaultTaken = true;
      await tx.customerAddress.update({ where: { id: addr.id }, data: { customerId: t.id, isDefault: makeDefault } });
      moved++;
    }
    const adoptPhone = !t.phone && Boolean(guest.phone);
    await tx.customer.update({ where: { id: t.id }, data: {
      ...(adoptPhone ? { phone: guest.phone } : {}), ...(!t.displayName && guest.displayName ? { displayName: guest.displayName } : {}),
    } });
    await tx.customer.update({ where: { id: guest.id }, data: { mergedIntoId: t.id } });
    summary = { merged: true, orders: orders.count, tickets: tickets.count, addressesMoved: moved, addressesDuplicate: dropped, phoneAdopted: adoptPhone };
  }
  // the old credential must not outlive the link: revoke every session of the guest row, then issue a fresh one for the final profile
  await tx.guestSession.updateMany({ where: { customerId: guest.id, revokedAt: null }, data: { revokedAt: now, revokedReason: 'TELEGRAM_LINKED' } });
  const session = await issueSession(tx, finalId, null, now);
  await tx.telegramLinkAttempt.update({ where: { id: a.id }, data: { status: 'COMPLETED', completedAt: now, targetCustomerId: finalId, mergeSummary: summary } });
  return { result: 'COMPLETED', merged: summary.merged === true, session, summary };
}
