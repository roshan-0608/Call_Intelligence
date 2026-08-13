import {
  DIMENSION_LABELS,
  leaderboardQuerySchema,
  round,
  type LeaderboardEntry,
  type ScoreDimension,
} from '@call-intel/shared';
import { prisma } from '../db/index.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { parseQuery } from '../middlewares/validate.js';
import { COMMITTED_OUTCOMES } from '../constants.js';

/**
 * Telecaller leaderboard, computed as an aggregate query.
 *
 * The original version fetched every call into the browser and reduced over it,
 * so the ranking silently changed depending on which page happened to be loaded,
 * and it sorted stringified scores (`"4.25" > "10.00"`). Here the database does
 * the arithmetic over all rows.
 */
export const getLeaderboard = asyncHandler(async (req, res) => {
  const { minCalls } = parseQuery(req, leaderboardQuerySchema);

  // Promise.all rather than $transaction: Prisma's precise groupBy result types
  // degrade inside a transaction array, and these are independent read-only
  // aggregates where a consistent snapshot buys nothing.
  const [grouped, committed, telecallers] = await Promise.all([
    // `orderBy` is required by Prisma's groupBy types; the meaningful ordering
    // happens after the averages are combined below.
    prisma.call.groupBy({
      by: ['telecallerId'],
      orderBy: { telecallerId: 'asc' },
      _count: { _all: true },
      _avg: {
        overallScore: true,
        discoveryScore: true,
        pitchScore: true,
        objectionHandlingScore: true,
        nextStepScore: true,
      },
    }),
    prisma.call.groupBy({
      by: ['telecallerId'],
      orderBy: { telecallerId: 'asc' },
      where: { siteVisitOutcome: { in: [...COMMITTED_OUTCOMES] } },
      _count: { _all: true },
    }),
    prisma.telecaller.findMany({ select: { id: true, name: true } }),
  ]);

  const nameById = new Map(telecallers.map((row) => [row.id, row.name]));
  const committedById = new Map(committed.map((row) => [row.telecallerId, row._count._all]));

  const entries = grouped
    .map((row) => {
      const callCount = row._count._all;
      const commits = committedById.get(row.telecallerId) ?? 0;

      const dimensionAverages: Record<ScoreDimension, number> = {
        discovery: round(row._avg.discoveryScore ?? 0),
        pitch: round(row._avg.pitchScore ?? 0),
        objection_handling: round(row._avg.objectionHandlingScore ?? 0),
        next_step: round(row._avg.nextStepScore ?? 0),
      };

      return {
        telecallerName: nameById.get(row.telecallerId) ?? 'Unknown',
        callCount,
        avgOverall: round(row._avg.overallScore ?? 0),
        dimensionAverages,
        siteVisitsCommitted: commits,
        commitRate: callCount === 0 ? 0 : round((commits / callCount) * 100, 1),
      };
    })
    .filter((entry) => entry.callCount >= minCalls)
    // Numeric sort, with call count as the tiebreaker so a single lucky call
    // cannot outrank a consistent performer.
    .sort((a, b) => b.avgOverall - a.avgOverall || b.callCount - a.callCount)
    .map((entry, index): LeaderboardEntry => ({ rank: index + 1, ...entry }));

  const payload = {
    data: entries,
    dimensions: Object.entries(DIMENSION_LABELS).map(([key, label]) => ({ key, label })),
  };

  res.status(200).json(new ApiResponse(200, payload, 'Leaderboard computed'));
});
