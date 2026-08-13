import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { env } from './env.js';
import { httpLogger } from './logger.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { readLimiter } from './middlewares/rateLimit.js';
import { analyticsRouter } from './routes/analytics.routes.js';
import { callRouter } from './routes/call.routes.js';
import { healthRouter } from './routes/health.routes.js';
import { leaderboardRouter } from './routes/leaderboard.routes.js';
import { uploadRouter } from './routes/upload.routes.js';
import { mountWebApp, resolveWebRoot } from './utils/staticWeb.js';

/**
 * Express setup: middleware, CORS, routes.
 *
 * Kept separate from `index.ts` (which owns the process) so integration tests
 * can mount the app with Supertest without binding a port.
 */
export function createApp(): Express {
  const app = express();

  // Behind Render/Vercel/Fly the client IP arrives in X-Forwarded-For. Without
  // this, rate limiting keys every request to the proxy's address — one bucket
  // for the entire internet.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins === '*' ? true : env.corsOrigins,
      methods: ['GET', 'POST'],
      maxAge: 86_400,
    }),
  );
  app.use(compression());
  // Bounded body: the transcript limit is enforced per-field in the controller,
  // this stops a multi-megabyte payload from being buffered at all.
  app.use(express.json({ limit: '1mb' }));
  app.use(httpLogger);
  app.use(readLimiter);

  /**
   * Two deployment shapes, one app:
   *
   * - **Split** (Render + Vercel, and development): the API owns the root, so
   *   `GET /calls` is the API. This is the default and what the tests exercise.
   * - **Single origin** (the whole app on one service): the dashboard is served
   *   from this same process, so the SPA owns `/calls/:id` and the API moves to
   *   `/api/*`. The frontend already defaults its base URL to `/api`, so nothing
   *   else changes — and CORS stops applying, because there is one origin.
   *
   * Without the prefix switch, a browser deep link to `/calls/CALL_0052` in
   * single-origin mode renders the API's JSON instead of the dashboard.
   *
   * `auto` deliberately means "production only", not "whenever a build exists":
   * a stale `frontend/dist` must not silently move the API under /api during
   * `npm run dev`, where Vite proxies /api to the root.
   */
  const serveWeb =
    env.SERVE_WEB === 'on' ||
    (env.SERVE_WEB === 'auto' && env.isProduction && resolveWebRoot() !== undefined);
  const apiPrefix = serveWeb ? '/api' : '';

  // Health stays at the root as well, because platform probes and uptime checks
  // are configured against /health/live and cannot know about a prefix.
  app.use('/health', healthRouter);
  if (serveWeb) app.use('/api/health', healthRouter);

  app.use(`${apiPrefix}/calls`, callRouter);
  app.use(`${apiPrefix}/leaderboard`, leaderboardRouter);
  app.use(`${apiPrefix}/analytics`, analyticsRouter);
  app.use(`${apiPrefix}/upload`, uploadRouter);

  // Registered after the API routes so static files can never shadow them.
  const webRoot = serveWeb ? mountWebApp(app) : undefined;

  if (!webRoot) {
    // No dashboard build here, so the root path documents the API instead.
    app.get('/', (_req, res) => {
      res.json({
        name: 'Call Intelligence API',
        version: 2,
        docs: 'https://github.com/roshan-0608/Call_Intelligence#api',
        endpoints: [
          'GET  /health/live',
          'GET  /health/ready',
          'GET  /health/stats',
          'GET  /calls',
          'GET  /calls/:id',
          'GET  /leaderboard',
          'GET  /analytics',
          'POST /upload',
        ],
      });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
