import type { z } from 'zod';

/**
 * One error type for the whole API.
 *
 * Every failure leaves through `errorHandler` as an `ApiError`, so responses
 * have a single shape and internal details never leak to the client. The
 * original app returned bare strings, HTML stack traces, or nothing at all
 * depending on where it failed.
 *
 * Serialized form:
 * ```json
 * {
 *   "success": false,
 *   "statusCode": 400,
 *   "code": "bad_request",
 *   "message": "Invalid query parameters",
 *   "errors": [{ "path": "stage", "message": "Invalid enum value..." }],
 *   "requestId": "b3f1c2e0-..."
 * }
 * ```
 *
 * `code` and `requestId` are additions to the conventional shape: `code` gives
 * the client something stable to branch on when the message is only for humans,
 * and `requestId` ties a user-reported failure to a line in the server log.
 */

export interface FieldError {
  path: string;
  message: string;
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly errors: FieldError[];
  /** Client errors are expected; only server errors are logged as errors. */
  readonly success = false as const;

  constructor(
    statusCode: number,
    message: string,
    options?: { code?: string; errors?: FieldError[]; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = options?.code ?? defaultCodeFor(statusCode);
    this.errors = options?.errors ?? [];
  }

  toJSON(requestId?: string) {
    return {
      success: false as const,
      statusCode: this.statusCode,
      code: this.code,
      message: this.message,
      ...(this.errors.length > 0 ? { errors: this.errors } : {}),
      ...(requestId ? { requestId } : {}),
    };
  }
}

export class BadRequestError extends ApiError {
  constructor(message: string, errors?: FieldError[]) {
    super(400, message, { code: 'bad_request', ...(errors ? { errors } : {}) });
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Resource not found') {
    super(404, message, { code: 'not_found' });
  }
}

export class PayloadTooLargeError extends ApiError {
  constructor(message: string) {
    super(413, message, { code: 'payload_too_large' });
  }
}

/** The pipeline is unavailable — for example, no API key is configured. */
export class ServiceUnavailableError extends ApiError {
  constructor(message: string, code = 'service_unavailable') {
    super(503, message, { code });
  }
}

/** The upstream model failed after retries — distinct from our own bugs. */
export class UpstreamError extends ApiError {
  constructor(message: string, cause?: unknown) {
    super(502, message, { code: 'upstream_error', ...(cause !== undefined ? { cause } : {}) });
  }
}

function defaultCodeFor(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 413:
      return 'payload_too_large';
    case 429:
      return 'rate_limited';
    case 502:
      return 'upstream_error';
    case 503:
      return 'service_unavailable';
    default:
      return statusCode >= 500 ? 'internal_error' : 'error';
  }
}

/** Flattens a Zod error into the `errors` array clients can display per field. */
export function zodFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}
