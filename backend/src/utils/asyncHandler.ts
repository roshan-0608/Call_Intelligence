import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wraps an async controller so a rejected promise reaches the error handler.
 *
 * A note on why this is thin: Express 5 already forwards rejected promises from
 * async handlers to the error middleware, which Express 4 did not — that is what
 * `asyncHandler` classically existed to fix. It is kept here for two reasons
 * that still hold:
 *
 *   1. Every controller is wrapped identically, so nobody has to remember which
 *      Express version's behaviour they are relying on.
 *   2. If this ever runs on Express 4 (or a router that predates 5), the safety
 *      net is already in place rather than being discovered by a hung request.
 *
 * It is deliberately a pass-through beyond that: no logging, no response
 * shaping. Errors belong to `errorHandler`, which is the only place that decides
 * what a client sees.
 */
export function asyncHandler<T>(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<T>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
