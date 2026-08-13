/**
 * Typed failure modes for the pipeline.
 *
 * The original implementation returned `null` for every kind of failure, which
 * made "your API key is wrong" indistinguishable from "the model wrote prose
 * instead of JSON" — so the batch runner retried both, six times, pointlessly.
 * Each class below carries whether it is worth retrying.
 */

export type LlmErrorCode =
  | 'http'
  | 'timeout'
  | 'network'
  | 'malformed_json'
  | 'schema_validation'
  | 'empty_response'
  | 'config';

export abstract class LlmError extends Error {
  abstract readonly code: LlmErrorCode;
  abstract readonly retryable: boolean;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Non-2xx response from the provider. */
export class LlmHttpError extends LlmError {
  readonly code = 'http' as const;
  readonly status: number;
  readonly body: string;
  /** Parsed from the `Retry-After` header when the provider sends one. */
  readonly retryAfterMs?: number;

  constructor(status: number, body: string, retryAfterMs?: number) {
    super(`Provider returned HTTP ${status}: ${truncate(body, 300)}`);
    this.status = status;
    this.body = body;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }

  /**
   * 429 and 5xx are transient. 400/401/403/404/422 are not — retrying a bad key
   * or a decommissioned model name only burns quota and wall-clock.
   */
  get retryable(): boolean {
    return this.status === 429 || this.status === 408 || this.status >= 500;
  }
}

export class LlmTimeoutError extends LlmError {
  readonly code = 'timeout' as const;
  readonly retryable = true;

  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
  }
}

export class LlmNetworkError extends LlmError {
  readonly code = 'network' as const;
  readonly retryable = true;

  constructor(cause: unknown) {
    super(`Network error contacting provider: ${describe(cause)}`, { cause });
  }
}

export class LlmEmptyResponseError extends LlmError {
  readonly code = 'empty_response' as const;
  readonly retryable = true;

  constructor() {
    super('Provider returned no message content');
  }
}

/** Response body was not parseable JSON. */
export class LlmMalformedJsonError extends LlmError {
  readonly code = 'malformed_json' as const;
  readonly retryable = true;
  readonly raw: string;

  constructor(raw: string, cause?: unknown) {
    super(`Model output was not valid JSON: ${truncate(raw, 200)}`, { cause });
    this.raw = raw;
  }
}

/** Parsed as JSON but violated the analysis schema. */
export class LlmSchemaError extends LlmError {
  readonly code = 'schema_validation' as const;
  readonly retryable = true;
  readonly issues: string[];
  readonly raw: string;

  constructor(issues: string[], raw: string) {
    super(`Model output failed schema validation: ${issues.join('; ')}`);
    this.issues = issues;
    this.raw = raw;
  }
}

/** Missing API key or an unknown prompt version — never retryable. */
export class LlmConfigError extends LlmError {
  readonly code = 'config' as const;
  readonly retryable = false;
}

export function isLlmError(error: unknown): error is LlmError {
  return error instanceof LlmError;
}

export function isRetryable(error: unknown): boolean {
  return isLlmError(error) ? error.retryable : false;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
