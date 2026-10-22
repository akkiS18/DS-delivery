/**
 * Stage 8A: operational state of the Gmail reader. Pure logic (no network, no database) so it is unit-testable.
 * A silent Gmail failure means customers have paid but nothing matches, so the state is exposed by /health/ready,
 * checked by the watchdog and announced to the admins on the transition (see src/bot/gmail-alerts.ts).
 */
export type GmailFailure = 'auth' | 'network' | 'api' | 'config';
export type GmailStatus = 'disabled' | 'starting' | 'ok' | 'degraded' | 'down';

/** Maps an error message to a coarse, secret-free category. The raw message is never returned to callers outside the logs. */
export function classifyGmailError(message: string): GmailFailure {
  if (/GMAIL_(TOKEN|CREDENTIALS)_|credentials\.json|GMAIL_FROM/i.test(message)) return 'config';
  if (/invalid_grant|invalid_client|unauthorized_client|Refresh token yo|Gmail 401|insufficient.?permission|Gmail 403(?![^]*(rate|quota))/i.test(message)) return 'auth';
  if (/fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|UND_ERR|timeout|aborted/i.test(message)) return 'network';
  return 'api';
}

export const MAX_BACKOFF_MS = 300_000;
/** Wait before the next attempt: the normal poll interval doubles per consecutive failure, capped at 5 minutes. */
export function backoffMs(consecutiveFailures: number, pollMs: number): number {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(MAX_BACKOFF_MS, pollMs * 2 ** Math.min(consecutiveFailures, 10));
}

export type GmailTransition = 'DOWN' | 'RECOVERED' | null;

export class GmailHealth {
  private enabled = false;
  private lastOkAt: number | null = null;
  private failures = 0;
  private lastFailure: GmailFailure | null = null;
  private pollMs = 12_000;
  private wasDown = false;

  /** Call once when Gmail is configured. `pollMs` sets the staleness threshold (a poll that hangs is also "down"). */
  enable(pollMs: number): void { this.enabled = true; this.pollMs = pollMs; }
  /** Test/shutdown helper. */
  reset(): void { this.enabled = false; this.lastOkAt = null; this.failures = 0; this.lastFailure = null; this.wasDown = false; }

  get failure(): GmailFailure | null { return this.lastFailure; }
  get consecutiveFailures(): number { return this.failures; }

  status(now = Date.now()): GmailStatus {
    if (!this.enabled) return 'disabled';
    if (this.lastFailure === 'auth' || this.lastFailure === 'config') return 'down';
    if (this.failures >= 3) return 'down';
    if (this.lastOkAt === null) return this.failures > 0 ? 'degraded' : 'starting';
    if (now - this.lastOkAt > Math.max(MAX_BACKOFF_MS + this.pollMs, this.pollMs * 10)) return 'down';
    return this.failures > 0 ? 'degraded' : 'ok';
  }

  /** A full poll finished without an error. Returns RECOVERED once after a DOWN. */
  succeeded(now = Date.now()): GmailTransition {
    this.lastOkAt = now; this.failures = 0; this.lastFailure = null;
    return this.settle(now);
  }

  /** A poll (or startup) failed. Returns DOWN once, on entering the down state. */
  failed(kind: GmailFailure, now = Date.now()): GmailTransition {
    this.failures += 1; this.lastFailure = kind;
    return this.settle(now);
  }

  private settle(now: number): GmailTransition {
    const down = this.status(now) === 'down';
    if (down && !this.wasDown) { this.wasDown = true; return 'DOWN'; }
    if (!down && this.wasDown) { this.wasDown = false; return 'RECOVERED'; }
    return null;
  }
}

export const gmailHealth = new GmailHealth();

/** A mail is worth an immediate admin message only when it is fresh: the first poll after a restart re-reads 24 h of old mail. */
export function isFreshIncoming(emailReceivedAtMs: number, nowMs: number, windowMs = 30 * 60_000): boolean {
  return Number.isFinite(emailReceivedAtMs) && nowMs - emailReceivedAtMs <= windowMs && emailReceivedAtMs <= nowMs + 120_000;
}
