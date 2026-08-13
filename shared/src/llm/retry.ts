import { LlmHttpError, isRetryable } from './errors.js';

/**
 * One retry policy for the whole project.
 *
 * The original code retried in two nested places (twice in the pipeline, three
 * times in the batch runner), so a single transcript could cost six API calls,
 * and it retried 4xx responses that could never succeed. This is the only
 * retry loop; everything else calls through it.
 */

export interface RetryOptions {
  /** Total attempts including the first. */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Decides whether a thrown error is worth another attempt. */
  isRetryable?: (error: unknown) => boolean;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  signal?: AbortSignal;
}

export const DEFAULT_RETRY: Required<
  Pick<RetryOptions, 'attempts' | 'baseDelayMs' | 'maxDelayMs'>
> = {
  attempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Exponential backoff with full jitter, capped. When the provider tells us how
 * long to wait via `Retry-After`, that wins over our own computation.
 */
export function computeDelayMs(
  attempt: number,
  error: unknown,
  options: { baseDelayMs: number; maxDelayMs: number; random: () => number },
): number {
  if (error instanceof LlmHttpError && error.retryAfterMs !== undefined) {
    return Math.min(error.retryAfterMs, options.maxDelayMs);
  }
  const exponential = options.baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, options.maxDelayMs);
  // Full jitter: spreads concurrent retries instead of synchronising them.
  return Math.round(capped * (0.5 + options.random() * 0.5));
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_RETRY.attempts;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs;
  const retryable = options.isRetryable ?? isRetryable;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    options.signal?.throwIfAborted();
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt === attempts;
      if (isLastAttempt || !retryable(error)) throw error;

      const delayMs = computeDelayMs(attempt, error, { baseDelayMs, maxDelayMs, random });
      options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }

  throw lastError;
}
