import { db } from '../../lib/db.js';
import { discardReceipt, receiptDir } from './receipts.js';
import { receiptRetentionDays } from './retention-config.js';

export { DEFAULT_RETENTION_DAYS, receiptRetentionDays } from './retention-config.js';

/**
 * Stage 8C: refund receipt photos contain bank details, so they are not kept forever. After RECEIPT_RETENTION_DAYS (default 365) the photo of a
 * CONFIRMED refund (the customer or an administrator attested it) is deleted from the volume. The row keeps type, size and SHA-256 and a
 * purge time; SENT and DISPUTED refunds are never purged (still evidence). The privacy policy states this period.
 */

export interface PurgeResult { purged: number; failed: number }

export async function purgeExpiredReceipts(now = new Date(), dir = receiptDir(), env: NodeJS.ProcessEnv = process.env, batch = 200): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - receiptRetentionDays(env) * 86_400_000);
  const rows = await db.refundRequest.findMany({
    where: { status: 'CONFIRMED', receiptKey: { not: null }, sentAt: { lt: cutoff } },
    select: { id: true, receiptKey: true }, orderBy: { sentAt: 'asc' }, take: batch,
  });
  let purged = 0; let failed = 0;
  for (const r of rows) {
    try {
      await discardReceipt(r.receiptKey!, dir); // the file goes first: a row that still points at a missing file is harmless, an orphan file is not
      const { count } = await db.refundRequest.updateMany({
        where: { id: r.id, status: 'CONFIRMED', receiptKey: r.receiptKey }, data: { receiptKey: null, receiptPurgedAt: now },
      });
      if (count === 1) purged++;
    } catch { failed++; }
  }
  return { purged, failed };
}

/** Runs once shortly after start and then every 6 hours; one pass at a time. Returns the stop function. */
export function startReceiptRetention(log: (line: string) => void = console.log, intervalMs = 6 * 3600_000): () => void {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await purgeExpiredReceipts();
      if (r.purged || r.failed) log(`[RECEIPT RETENTION] purged ${r.purged}, failed ${r.failed}`);
    } catch (err) { console.error('[RECEIPT RETENTION]', err instanceof Error ? err.message : 'error'); }
    finally { busy = false; }
  };
  const first = setTimeout(() => void run(), 60_000);
  const timer = setInterval(() => void run(), intervalMs);
  return () => { clearTimeout(first); clearInterval(timer); };
}
