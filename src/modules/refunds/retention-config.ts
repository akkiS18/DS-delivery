/** Pure (no database): how long a confirmed refund's receipt photo is kept. Shared by the purge job and the privacy policy text. */
export const DEFAULT_RETENTION_DAYS = 365;

export function receiptRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.RECEIPT_RETENTION_DAYS);
  return Number.isInteger(n) && n >= 30 && n <= 3650 ? n : DEFAULT_RETENTION_DAYS;
}
