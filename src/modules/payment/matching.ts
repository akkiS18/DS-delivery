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
