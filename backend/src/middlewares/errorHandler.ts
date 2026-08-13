import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z } from 'zod';
import { isLlmError } from '@call-intel/shared/llm';
import { logger } from '../logger.js';
import { env } from '../env.js';
import { ApiError, NotFoundError, zodFieldErrors } from '../utils/ApiError.js';

/**
 * The single exit for every failure.
 *
 * Anything thrown anywhere in the app arrives here and leaves as an `ApiError`
 * JSON body. Nothing else in the codebase writes an error response.
 */

export const notFoundHandler: RequestHandler = (req) => {
  throw new NotFoundError(`No route matches ${req.method} ${req.path}`);
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const requestId = typeof req.id === 'string' ? req.id : undefined;
  const apiError = toApiError(error);

  if (apiError.statusCode >= 500) {
    logger.error({ err: error, requestId, code: apiError.code }, 'request failed');
  } else {
    logger.warn({ requestId, code: apiError.code, msg: apiError.message }, 'request rejected');
  }

  if (res.headersSent) return;
  res.status(apiError.statusCode).json(apiError.toJSON(requestId));
};

/** Normalizes every throwable in the app into one error type. */
function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  // A Zod error reaching here is a validation failure we did not wrap.
  if (error instanceof z.ZodError) {
    return new ApiError(400, 'Request validation failed', {
      code: 'validation_error',
      errors: zodFieldErrors(error),
    });
  }

  // Body-parser rejected an oversized payload before our own limit check.
  if (isPayloadTooLarge(error)) {
    return new ApiError(413, 'Request body is too large', { code: 'payload_too_large' });
  }

  if (isLlmError(error)) {
    return new ApiError(502, 'The analysis provider could not be reached', {
      code: 'upstream_error',
      cause: error,
    });
  }

  // Unknown failure: the message may contain internals, so it is withheld in
  // production and kept in development where it is the fastest way to debug.
  return new ApiError(
    500,
    env.isProduction ? 'Something went wrong' : String((error as Error)?.message ?? error),
    { code: 'internal_error', cause: error },
  );
}

function isPayloadTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    (error as { type?: string }).type === 'entity.too.large'
  );
}
