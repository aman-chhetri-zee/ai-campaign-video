// src/lib/pipeline/retry.ts

const TRANSIENT_ERROR_PATTERNS = [
  "fetch failed",
  "terminated",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EAI_AGAIN",
  "socket hang up",
  "Client network socket disconnected",
  "other side closed",
];

function isTransient(err: unknown): boolean {
  if (!err) return false;
  const msg = (err as Error)?.message ?? String(err);
  // Match transient network errors by message substring
  if (TRANSIENT_ERROR_PATTERNS.some((p) => msg.toLowerCase().includes(p.toLowerCase()))) {
    return true;
  }
  // Match 5xx HTTP responses (server-side problems, retryable)
  const m = msg.match(/HTTP[\s/]?(\d{3})|status[:\s]+(\d{3})|\b(5\d{2})\b/i);
  if (m) {
    const code = Number(m[1] ?? m[2] ?? m[3]);
    if (code >= 500 && code < 600) return true;
  }
  // The undici "cause" property sometimes carries the real reason
  const cause = (err as any)?.cause;
  if (cause && cause !== err) return isTransient(cause);
  return false;
}

/**
 * Run an async operation with retry-with-backoff for transient errors.
 *
 * Retries up to `maxAttempts` times (default 3 = original + 2 retries).
 * Backoff schedule: 2s, 5s, 10s.
 * Only retries on transient errors (network blips, 5xx). 4xx errors throw immediately.
 *
 * @param label - short string used in log messages so we know which call retried
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: { label?: string; maxAttempts?: number },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const label = options?.label ?? "vertex-call";
  const delays = [2_000, 5_000, 10_000];

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isTransient(err)) {
        throw err;
      }
      const delay = delays[Math.min(attempt - 1, delays.length - 1)];
      const msg = (err as Error)?.message ?? String(err);
      console.warn(
        `[retry] ${label} attempt ${attempt}/${maxAttempts} failed (${msg.slice(0, 100)}); retrying in ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
