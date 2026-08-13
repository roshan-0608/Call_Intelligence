import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type RequestHandler } from 'express';
import { logger } from '../logger.js';

/**
 * Optionally serves the built dashboard from the API process.
 *
 * In development the two run separately (Vite on :5173 proxying to :5000), which
 * is what you want for hot reload. In a single-service deploy — the whole app on
 * one Render service instead of Render plus Vercel — there is one process and one
 * port, so the API serves `frontend/dist` too. That also removes CORS from the
 * picture entirely, because the dashboard and the API share an origin.
 *
 * Mounted only when the build output actually exists, so a dev run or a
 * backend-only deploy is unaffected.
 */

/** `backend/dist/utils/staticWeb.js` → `<repo>/frontend/dist` */
function defaultWebRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../frontend/dist');
}

export function resolveWebRoot(override?: string): string | undefined {
  const candidate = override ? resolve(override) : defaultWebRoot();
  return existsSync(join(candidate, 'index.html')) ? candidate : undefined;
}

/**
 * Paths owned by the API. A SPA fallback must never swallow these.
 *
 * Only `/api` and `/health` appear here: this module is mounted exclusively in
 * single-origin mode, where `app.ts` has already moved the API under `/api`
 * precisely so the SPA can own `/calls/:id`. Listing `/calls` here would send
 * the dashboard's own deep links to the 404 handler.
 */
const API_PREFIXES = ['/api', '/health'];

function isApiPath(path: string): boolean {
  return API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Single-page-app fallback.
 *
 * Written as path-less middleware rather than `app.get('*')`: Express 5 upgraded
 * path-to-regexp, where a bare `*` is no longer a valid pattern and throws at
 * startup. This also lets the API keep ownership of its own routes explicitly.
 */
function spaFallback(indexPath: string): RequestHandler {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (isApiPath(req.path)) return next();
    // A request for a missing asset should 404, not silently return HTML.
    if (req.path.includes('.')) return next();

    res.sendFile(indexPath, (error) => {
      if (error) next(error);
    });
  };
}

/**
 * Mounts static hosting if a build is present. Returns the served directory, or
 * undefined when nothing was mounted.
 */
export function mountWebApp(app: Express, override?: string): string | undefined {
  const root = resolveWebRoot(override);
  if (!root) return undefined;

  app.use(
    express.static(root, {
      // Vite fingerprints asset filenames, so they can be cached hard.
      // index.html must not be, or a deploy keeps serving the old bundle.
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (/\/assets\//.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  app.use(spaFallback(join(root, 'index.html')));

  logger.info({ root }, 'serving dashboard from the API process');
  return root;
}
