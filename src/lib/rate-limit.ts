/**
 * Small in-memory sliding-window limiter for the Mini App API. Per process (the app runs as one process; a multi-instance
 * deployment needs a shared store such as Redis - documented as a production blocker). Memory is bounded: expired windows are
 * dropped on access and by a periodic sweep.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private sweeper: NodeJS.Timeout | undefined;

  constructor(private readonly now: () => number = Date.now, private readonly maxKeys = 50_000) {}

  /** Records an attempt and returns whether it is allowed. Rejected attempts do not extend the window. */
  allow(key: string, max: number, windowMs: number): { allowed: boolean; retryAfterSeconds: number } {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter(x => t - x < windowMs);
    if (recent.length >= max) {
      this.hits.set(key, recent);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (t - recent[0]!)) / 1000)) };
    }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) this.sweep(windowMs);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  sweep(windowMs: number): void {
    const t = this.now();
    for (const [k, v] of this.hits) if (!v.some(x => t - x < windowMs)) this.hits.delete(k);
  }

  startSweeper(windowMs = 120_000): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(windowMs), 60_000);
    this.sweeper.unref();
  }

  stop(): void { if (this.sweeper) clearInterval(this.sweeper); this.sweeper = undefined; }
  size(): number { return this.hits.size; }
}
