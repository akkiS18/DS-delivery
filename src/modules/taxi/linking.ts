import { createHash, randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';

// No 0/O/1/I/L: codes are typed by hand from a message.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;
export const INVITE_TTL_HOURS = 24;

export const hashInviteCode = (code: string): string => createHash('sha256').update(normalizeInviteCode(code)).digest('hex');
export function normalizeInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '');
}
export function looksLikeInviteCode(raw: string): boolean {
  const c = normalizeInviteCode(raw);
  return c.length === CODE_LENGTH && [...c].every(ch => ALPHABET.includes(ch));
}
export function generateInviteCode(): string {
  const raw = Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/** Administrator (local CLI) creates a one-time code for an existing company. Only its SHA-256 is stored; older
 *  unused codes of the same company are revoked so at most one is valid. */
export async function createOperatorInvite(companyName: string, createdBy: string, now = new Date()) {
  const company = await db.taxiCompany.findUnique({ where: { name: companyName } });
  if (!company) throw new Error('TAKSI_KOMPANIYASI_TOPILMADI');
  if (!company.isActive) throw new Error('TAKSI_KOMPANIYASI_FAOL_EMAS');
  const code = generateInviteCode();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_HOURS * 3_600_000);
  await db.$transaction([
    db.taxiOperatorInvite.updateMany({ where: { taxiCompanyId: company.id, usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } }),
    db.taxiOperatorInvite.create({ data: { taxiCompanyId: company.id, codeHash: hashInviteCode(code), expiresAt, createdBy } }),
  ]);
  return { code, companyName: company.name, expiresAt };
}

export type LinkResult =
  | { result: 'LINKED'; companyName: string }
  | { result: 'INVALID' }                    // unknown, expired or already used: deliberately indistinguishable
  | { result: 'ALREADY_LINKED_ELSEWHERE' }
  | { result: 'RATE_LIMITED' };

const attempts = new Map<string, number[]>();
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
function rateLimited(telegramId: string, now: number): boolean {
  const recent = (attempts.get(telegramId) ?? []).filter(t => now - t < WINDOW_MS);
  attempts.set(telegramId, recent);
  return recent.length >= MAX_FAILURES;
}
const recordFailure = (telegramId: string, now: number) => attempts.set(telegramId, [...(attempts.get(telegramId) ?? []), now]);
export function resetLinkRateLimit(): void { attempts.clear(); }

/** The operator redeems a code in the taxi bot. The code is consumed by a compare-and-swap, so two chats racing with the
 *  same code cannot both link; a Telegram id can belong to one company only (unique column). */
export async function redeemOperatorInvite(telegramUserId: string, rawCode: string, now = new Date()): Promise<LinkResult> {
  if (rateLimited(telegramUserId, now.getTime())) return { result: 'RATE_LIMITED' };
  const fail = (): LinkResult => { recordFailure(telegramUserId, now.getTime()); return { result: 'INVALID' }; };
  if (!looksLikeInviteCode(rawCode)) return fail();
  try {
    return await db.$transaction(async tx => {
      const invite = await tx.taxiOperatorInvite.findUnique({ where: { codeHash: hashInviteCode(rawCode) }, include: { taxiCompany: true } });
      if (!invite || invite.usedAt || invite.expiresAt <= now || !invite.taxiCompany.isActive) return fail();
      const other = await tx.taxiCompany.findUnique({ where: { operatorTelegramUserId: telegramUserId }, select: { id: true } });
      if (other && other.id !== invite.taxiCompanyId) return { result: 'ALREADY_LINKED_ELSEWHERE' } as const;
      const claimed = await tx.taxiOperatorInvite.updateMany({
        where: { id: invite.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now, usedByTelegramId: telegramUserId },
      });
      if (claimed.count !== 1) return fail();
      await tx.taxiCompany.update({ where: { id: invite.taxiCompanyId }, data: { operatorTelegramUserId: telegramUserId, operatorLinkedAt: now } });
      return { result: 'LINKED', companyName: invite.taxiCompany.name } as const;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { result: 'ALREADY_LINKED_ELSEWHERE' };
    throw err;
  }
}
