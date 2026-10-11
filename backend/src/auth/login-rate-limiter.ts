interface Bucket {
  failures: number;
  windowEndsAt: number;
}

/**
 * Counts *failed* logins per key (client IP and target email) in a fixed
 * window. In memory, which is right for a single backend instance; a second
 * instance would need a shared store (Redis).
 */
export class LoginRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Seconds the caller must wait, or 0 when another attempt is allowed. */
  retryAfterSeconds(...keys: string[]): number {
    const now = this.now();
    let wait = 0;
    for (const key of keys) {
      const bucket = this.live(key, now);
      if (bucket && bucket.failures >= this.maxFailures) {
        wait = Math.max(wait, Math.ceil((bucket.windowEndsAt - now) / 1000));
      }
    }
    return wait;
  }

  recordFailure(...keys: string[]): void {
    const now = this.now();
    for (const key of keys) {
      const bucket = this.live(key, now);
      if (bucket) bucket.failures += 1;
      else this.buckets.set(key, { failures: 1, windowEndsAt: now + this.windowMs });
    }
    if (this.buckets.size > 10_000) this.sweep(now);
  }

  /** A successful login forgives earlier typos for that key. */
  reset(...keys: string[]): void {
    for (const key of keys) this.buckets.delete(key);
  }

  private live(key: string, now: number): Bucket | undefined {
    const bucket = this.buckets.get(key);
    if (bucket && bucket.windowEndsAt <= now) {
      this.buckets.delete(key);
      return undefined;
    }
    return bucket;
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.windowEndsAt <= now) this.buckets.delete(key);
    }
  }
}
