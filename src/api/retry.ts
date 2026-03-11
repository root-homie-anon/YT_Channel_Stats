export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableErrors: number[];
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryableErrors: [429, 500, 502, 503],
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  opts: Partial<RetryOptions> = {}
): Promise<T> {
  const options = { ...DEFAULT_OPTIONS, ...opts };

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = extractHttpStatus(err);
      const isRetryable =
        status !== null && options.retryableErrors.includes(status);

      if (!isRetryable || attempt === options.maxRetries) {
        throw err;
      }

      const delay = Math.min(
        options.baseDelayMs * Math.pow(2, attempt) + Math.random() * 500,
        options.maxDelayMs
      );
      console.warn(
        `[retry] ${label} failed (HTTP ${status}), attempt ${attempt + 1}/${options.maxRetries}, retrying in ${Math.round(delay)}ms`
      );
      await sleep(delay);
    }
  }

  // Unreachable, but satisfies TypeScript
  throw new Error(`[retry] ${label} exhausted all retries`);
}

function extractHttpStatus(err: unknown): number | null {
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    // googleapis errors have err.code as HTTP status
    if (typeof obj.code === "number") return obj.code;
    // Nested response status
    if (
      typeof obj.response === "object" &&
      obj.response !== null &&
      typeof (obj.response as Record<string, unknown>).status === "number"
    ) {
      return (obj.response as Record<string, unknown>).status as number;
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
