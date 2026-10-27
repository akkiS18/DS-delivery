/** Parser for the OBSERVED Humocard Telegram bot incoming-credit message. Not a bank API. */
export type ParsedHumo = {
  cardLast4: string;
  amountTiyin: bigint;
  occurredAt: Date;
  operation: string;
  minutePrecision: true;
};

/**
 * Observed message (2026-10-27):
 *   🎉 To'ldirish / ➕ 5.000,00 UZS / 📍 PAYME P2P UZCARD NA / 💳 HUMOCARD *6062 / 🕓 15:39 27.10.2026 / 💰 5.000,00 UZS
 * The last 💰 line is the BALANCE, never the amount: the amount is only read from the ➕ line. A ➖ (debit) or any other shape returns null.
 * Amounts are read in the one observed shape (dot = thousands, comma = decimals); anything else is refused rather than guessed.
 */
export function parseHumoMessage(raw: string): ParsedHumo | null {
  const lines = raw.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const credit = lines.find(l => l.startsWith('➕'));
  if (!credit || lines.some(l => l.startsWith('➖'))) return null;
  const amount = credit.slice('➕'.length).trim().match(/^(\d{1,3}(?:[. ]\d{3})*|\d+)(?:,(\d{1,2}))?\s*UZS$/i);
  if (!amount) return null;
  const amountTiyin = BigInt(amount[1]!.replace(/[. ]/g, '')) * 100n + BigInt((amount[2] ?? '').padEnd(2, '0') || '0');
  if (amountTiyin <= 0n) return null;

  const cardLine = lines.find(l => l.startsWith('💳'));
  const card = cardLine?.match(/\*+(\d{4})\s*$/);
  const timeLine = lines.find(l => l.startsWith('🕓'));
  const time = timeLine?.match(/(\d{2}):(\d{2})\s+(\d{2})\.(\d{2})\.(\d{4})\s*$/);
  if (!card || !time) return null;

  const [, hh, min, dd, mm, yyyy] = time;
  const local = `${yyyy}-${mm}-${dd}T${hh}:${min}`;
  // The bot prints Uzbekistan time (+05:00) with minute precision.
  const occurredAt = new Date(`${local}:00+05:00`);
  if (Number.isNaN(occurredAt.getTime())) return null;
  if (new Date(occurredAt.getTime() + 5 * 3600_000).toISOString().slice(0, 16) !== local) return null;

  const operation = lines.find(l => l.startsWith('📍'))?.slice('📍'.length).trim() ?? '';
  return { cardLast4: card[1]!, amountTiyin, occurredAt, operation, minutePrecision: true };
}

/** A message in the observed format, for tests and the local sample tool. */
export function sampleHumoMessage(last4: string, tiyin: bigint, occurredAt = new Date(), balanceTiyin = tiyin): string {
  const t = new Date(occurredAt.getTime() + 5 * 3600_000);
  const pad = (x: number): string => String(x).padStart(2, '0');
  const money = (v: bigint): string => `${(v / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${pad(Number(v % 100n))} UZS`;
  return [
    '🎉 To\'ldirish', `➕ ${money(tiyin)}`, '📍 PAYME P2P UZCARD NA', `💳 HUMOCARD *${last4}`,
    `🕓 ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())} ${pad(t.getUTCDate())}.${pad(t.getUTCMonth() + 1)}.${t.getUTCFullYear()}`,
    `💰 ${money(balanceTiyin)}`,
  ].join('\n');
}
