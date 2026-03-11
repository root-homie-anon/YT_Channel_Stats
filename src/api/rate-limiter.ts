/**
 * Simple token-bucket rate limiter for YouTube API quota management.
 * YouTube Data API v3 default quota: 10,000 units/day.
 * search.list = 100 units, channels.list = 1 unit, videos.list = 1 unit.
 *
 * This limiter enforces a per-second request cap to avoid burst throttling.
 */
export class RateLimiter {
  private queue: Array<{ resolve: () => void }> = [];
  private activeRequests = 0;
  private lastRequestTime = 0;

  constructor(
    private maxConcurrent: number = 5,
    private minIntervalMs: number = 200
  ) {}

  async acquire(): Promise<void> {
    // Wait for concurrency slot
    if (this.activeRequests >= this.maxConcurrent) {
      await new Promise<void>((resolve) => {
        this.queue.push({ resolve });
      });
    }

    // Enforce minimum interval between requests
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minIntervalMs) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, this.minIntervalMs - elapsed)
      );
    }

    this.activeRequests++;
    this.lastRequestTime = Date.now();
  }

  release(): void {
    this.activeRequests--;
    const next = this.queue.shift();
    if (next) next.resolve();
  }

  async wrap<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
