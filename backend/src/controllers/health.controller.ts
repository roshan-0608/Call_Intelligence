import type { Request, Response } from 'express';
import { env } from '../env.js';
import { checkDatabase, prisma } from '../db/index.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Liveness and readiness are separate probes on purpose.
 *
 * Liveness answers "is the process up" and must never touch the database, or a
 * transient DB blip gets the container killed. Readiness answers "can it serve
 * traffic" and does check the database. The dashboard also uses readiness as its
 * wake-up ping on free-tier hosting, where the first request after sleep is slow.
 *
 * These three responses are deliberately *not* wrapped in `ApiResponse`: uptime
 * checkers, load balancers and platform probes expect a flat body they can match
 * on, and they are not consumers of the application API.
 */

const startedAt = Date.now();

export const getLiveness = (_req: Request, res: Response): void => {
  res.status(200).json({ status: 'ok', uptimeSec: Math.round(process.uptime()) });
};

export const getReadiness = asyncHandler(async (_req, res) => {
  const databaseOk = await checkDatabase();

  res.status(databaseOk ? 200 : 503).json({
    status: databaseOk ? 'ready' : 'degraded',
    checks: {
      database: databaseOk ? 'ok' : 'unreachable',
      // Reported, not required: the API is fully usable read-only without a key.
      llm: env.GROQ_API_KEY ? 'configured' : 'not_configured',
    },
    uptimeSec: Math.round(process.uptime()),
    startedAt: new Date(startedAt).toISOString(),
  });
});

/** Small operational summary, handy once this is deployed. */
export const getStats = asyncHandler(async (_req, res) => {
  const [calls, cacheEntries, cacheHits] = await prisma.$transaction([
    prisma.call.count(),
    prisma.analysisCache.count(),
    prisma.analysisCache.aggregate({ _sum: { hitCount: true } }),
  ]);

  const payload = {
    calls,
    cache: { entries: cacheEntries, hits: cacheHits._sum.hitCount ?? 0 },
    model: env.LLM_MODEL,
    promptVersion: env.PROMPT_VERSION,
    uploadsEnabled: Boolean(env.GROQ_API_KEY),
  };

  res.status(200).json(new ApiResponse(200, payload, 'Stats fetched'));
});
