import { describe, expect, it, vi } from 'vitest';
import {
  LlmConfigError,
  LlmHttpError,
  LlmTimeoutError,
  computeDelayMs,
  parseRetryAfter,
  withRetry,
} from '@call-intel/shared/llm';

/**
 * Retry behaviour is the part of the pipeline most likely to waste money when
 * it is wrong: the original code retried 4xx responses in two nested loops, so a
 * bad API key cost six calls per transcript.
 */

describe('LlmHttpError.retryable', () => {
  it('retries 429, 408 and 5xx', () => {
    expect(new LlmHttpError(429, '').retryable).toBe(true);
    expect(new LlmHttpError(408, '').retryable).toBe(true);
    expect(new LlmHttpError(500, '').retryable).toBe(true);
    expect(new LlmHttpError(503, '').retryable).toBe(true);
  });

  it('does not retry client errors that can never succeed', () => {
    expect(new LlmHttpError(400, '').retryable).toBe(false);
    expect(new LlmHttpError(401, '').retryable).toBe(false);
    expect(new LlmHttpError(403, '').retryable).toBe(false);
    expect(new LlmHttpError(404, '').retryable).toBe(false);
  });
});

describe('withRetry', () => {
  const sleep = () => Promise.resolve();

  it('returns the first successful result without sleeping', async () => {
    const operation = vi.fn().mockResolvedValue('ok');
    const spy = vi.fn(sleep);

    await expect(withRetry(operation, { sleep: spy })).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('retries a retryable failure and then succeeds', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new LlmHttpError(500, 'boom'))
      .mockResolvedValue('recovered');

    await expect(withRetry(operation, { sleep, random: () => 0.5 })).resolves.toBe('recovered');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('fails fast on a non-retryable error', async () => {
    const operation = vi.fn().mockRejectedValue(new LlmHttpError(401, 'bad key'));

    await expect(withRetry(operation, { sleep })).rejects.toBeInstanceOf(LlmHttpError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('gives up after the configured number of attempts', async () => {
    const operation = vi.fn().mockRejectedValue(new LlmTimeoutError(1000));

    await expect(
      withRetry(operation, { attempts: 3, sleep, random: () => 0 }),
    ).rejects.toBeInstanceOf(LlmTimeoutError);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('treats an unknown error type as non-retryable', async () => {
    const operation = vi.fn().mockRejectedValue(new LlmConfigError('no key'));

    await expect(withRetry(operation, { sleep })).rejects.toBeInstanceOf(LlmConfigError);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe('computeDelayMs', () => {
  const options = { baseDelayMs: 1000, maxDelayMs: 30_000, random: () => 1 };

  it('grows exponentially across attempts', () => {
    expect(computeDelayMs(1, new LlmTimeoutError(1), options)).toBe(1000);
    expect(computeDelayMs(2, new LlmTimeoutError(1), options)).toBe(2000);
    expect(computeDelayMs(3, new LlmTimeoutError(1), options)).toBe(4000);
  });

  it('applies jitter in the lower half of the window', () => {
    const jittered = computeDelayMs(3, new LlmTimeoutError(1), { ...options, random: () => 0 });
    expect(jittered).toBe(2000);
  });

  it('caps at maxDelayMs', () => {
    expect(computeDelayMs(20, new LlmTimeoutError(1), options)).toBe(30_000);
  });

  it("honours the provider's Retry-After over its own computation", () => {
    const error = new LlmHttpError(429, 'slow down', 5000);
    expect(computeDelayMs(1, error, options)).toBe(5000);
  });

  it('still caps a Retry-After that exceeds the maximum', () => {
    const error = new LlmHttpError(429, 'slow down', 120_000);
    expect(computeDelayMs(1, error, options)).toBe(30_000);
  });
});

describe('parseRetryAfter', () => {
  it('reads a seconds value', () => {
    expect(parseRetryAfter(new Headers({ 'retry-after': '3' }))).toBe(3000);
  });

  it('reads an HTTP date', () => {
    const future = new Date(Date.now() + 10_000).toUTCString();
    const parsed = parseRetryAfter(new Headers({ 'retry-after': future }));
    expect(parsed).toBeGreaterThan(0);
    expect(parsed).toBeLessThanOrEqual(10_000);
  });

  it('returns undefined when absent or unparseable', () => {
    expect(parseRetryAfter(new Headers())).toBeUndefined();
    expect(parseRetryAfter(new Headers({ 'retry-after': 'soon' }))).toBeUndefined();
  });
});
