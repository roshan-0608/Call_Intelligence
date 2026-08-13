import type { Request } from 'express';
import type { z } from 'zod';
import { BadRequestError, zodFieldErrors } from '../utils/ApiError.js';

/**
 * Request parsing helpers.
 *
 * Returning the parsed value (instead of stashing it on `req`) keeps handlers
 * fully typed without declaration merging, and guarantees a handler cannot
 * accidentally read the raw, unvalidated input.
 */

export function parseQuery<T extends z.ZodTypeAny>(req: Request, schema: T): z.infer<T> {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    throw new BadRequestError('Invalid query parameters', zodFieldErrors(result.error));
  }
  return result.data;
}

export function parseBody<T extends z.ZodTypeAny>(req: Request, schema: T): z.infer<T> {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    throw new BadRequestError('Invalid request body', zodFieldErrors(result.error));
  }
  return result.data;
}

export function parseParams<T extends z.ZodTypeAny>(req: Request, schema: T): z.infer<T> {
  const result = schema.safeParse(req.params);
  if (!result.success) {
    throw new BadRequestError('Invalid path parameters', zodFieldErrors(result.error));
  }
  return result.data;
}
