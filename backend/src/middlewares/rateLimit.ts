import rateLimit, { type Options } from 'express-rate-limit';
import { env } from '../env.js';
import { logger } from '../logger.js';

/**
 * Abuse limits.
 *
 * The upload endpoint spends money on every request, and in the original build
 * it was unauthenticated, unbounded and unmetered — a loop over it would drain
 * the API quota. Read endpoints get a looser limit purely to blunt scrapers.
 */

const jsonHandler: Options['handler'] = (req, res, _next, options) => {
  logger.warn({ ip: req.ip, path: req.path }, 'rate limit exceeded');
  res.status(options.statusCode).json({
    error: {
      code: 'rate_limited',
      message: options.message as string,
      ...(typeof req.id === 'string' ? { requestId: req.id } : {}),
    },
  });
};

export const readLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Too many requests. Try again in a minute.',
  handler: jsonHandler,
  // Health probes must never be rate limited or a platform will mark the
  // service unhealthy under load.
  skip: (req) => req.path.startsWith('/health'),
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: env.UPLOAD_RATE_LIMIT_PER_HOUR,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: `Upload limit reached (${env.UPLOAD_RATE_LIMIT_PER_HOUR}/hour). Each upload costs an LLM call.`,
  handler: jsonHandler,
  // Cached and duplicate uploads cost nothing, so they are refunded in the
  // route handler via `req.rateLimit.resetKey`-free accounting: we only count
  // requests that reached the model.
  skipFailedRequests: false,
});
