import type { RetryPolicy } from "@agent-world/core";

/**
 * Shared transient-failure retry. Used by notify / vcs / search / http / code
 * so the exponential-backoff loop isn't copy-pasted per node. The caller owns
 * the retryable decision via `isRetryable(err)` — auth failures and explicit
 * provider rejections return false so they bubble up immediately.
 *
 * Distinct from `rework` (a quality rejection that bumps the attempt number):
 * this retries infra faults (network drop, 5xx, rate limit) without changing
 * the attempt counter.
 */

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: Pick<RetryPolicy, "maxRetries" | "baseDelayMs" | "maxDelayMs">,
  isRetryable: (err: unknown) => boolean,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<T> {
  const maxAttempts = 1 + (policy.maxRetries ?? 0);
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || i >= maxAttempts - 1) break;
      const base = policy.baseDelayMs ?? 1000;
      const max = policy.maxDelayMs ?? 30000;
      await sleep(Math.min(max, base * 2 ** i));
    }
  }
  throw lastErr;
}
