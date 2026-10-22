import { createHash } from 'node:crypto';
/** Pure, independently tested time-window logic; UZCARD time is rounded to minutes. */
export function overlapsPaymentWindow(
  occurredAtMs: number,
  assignedAtMs: number,
  expiresAtMs: number,
  minutePrecision: boolean,
): boolean {
  const upperExclusive = occurredAtMs + (minutePrecision ? 60_000 : 1);
  return occurredAtMs < expiresAtMs && upperExclusive > assignedAtMs;
}

/** A prior assignment may have received money late, even after its timeout. */
export function couldBelongToEarlierPayment(
  priorAssignedAtMs: number,
  occurredAtMs: number,
  ambiguityMs: number,
): boolean {
  return priorAssignedAtMs <= occurredAtMs + 60_000 &&
    priorAssignedAtMs + ambiguityMs > occurredAtMs;
}

/** Content fingerprint of a bank notification. The same bank event forwarded or re-sent as a different
 *  Gmail message has a different message id but the same fingerprint. */
export function incomingFingerprint(cardLast4: string, amountTiyin: bigint, occurredAt: Date): string {
  return createHash('sha256').update(`${cardLast4}|${amountTiyin}|${occurredAt.toISOString()}`).digest('hex');
}

/** Received amount differs from the expected one: never matched automatically, always reviewed. */
export function classifyAmountMismatch(expectedTiyin: bigint, receivedTiyin: bigint):
  'AMOUNT_BELOW_EXPECTED' | 'AMOUNT_ABOVE_EXPECTED' | null {
  if (receivedTiyin < expectedTiyin) return 'AMOUNT_BELOW_EXPECTED';
  if (receivedTiyin > expectedTiyin) return 'AMOUNT_ABOVE_EXPECTED';
  return null;
}

/** The mail arrived long after the bank operation (UZCARD time is minute-rounded, so this is approximate). */
export function isDelayedNotification(occurredAtMs: number, emailReceivedAtMs: number, maxDelayMs: number): boolean {
  return emailReceivedAtMs - occurredAtMs > maxDelayMs;
}
