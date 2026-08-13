import { randomUUID } from 'node:crypto';
import pino from 'pino';
// Named import: pino-http is CJS, and its default export is not callable under
// NodeNext module resolution.
import { pinoHttp } from 'pino-http';
import { env } from './env.js';

/**
 * Structured logging.
 *
 * Replaces emoji `console.log` calls with JSON lines carrying a request id, so
 * a failed upload can be traced through validation, cache lookup, and the
 * provider call. Pretty-printed in development, raw JSON in production where a
 * log aggregator consumes it.
 */
export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  base: { service: 'call-intel-api' },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'GROQ_API_KEY'],
    censor: '[redacted]',
  },
  ...(env.isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
        },
      }),
});

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const existing = req.headers['x-request-id'];
    const id = typeof existing === 'string' && existing.length > 0 ? existing : randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  // Health checks are noise once a platform polls them every few seconds.
  autoLogging: {
    ignore: (req) => req.url === '/health/live' || req.url === '/health/ready',
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});
