import {
  ACTION_LABELS,
  DIMENSION_LABELS,
  STAGE_LABELS,
  TIMELINE_LABELS,
  UNIT_LABELS,
  round,
  type Analytics,
  type CountByKey,
} from '@call-intel/shared';
import { prisma } from '../db/index.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { COMMITTED_OUTCOMES, SCORE_BUCKETS, VALIDATION_STATUS } from '../constants.js';

/**
 * Aggregate view for the dashboard's charts.
 *
 * All of it is group-by work the database is good at. The point of exposing it
 * as one endpoint is that the dashboard header renders in a single round trip
 * instead of the browser deriving totals from a full table download.
 */
export const getAnalytics = asyncHandler(async (_req, res) => {
  const [
    totals,
    telecallerCount,
    flaggedCount,
    committedCount,
    stageGroups,
    actionGroups,
    timelineGroups,
    unitGroups,
    locationGroups,
    scores,
    // Promise.all rather than $transaction: see the note in the leaderboard
    // controller — transaction arrays lose Prisma's precise groupBy types.
  ] = await Promise.all([
    prisma.call.aggregate({
      _count: { _all: true },
      _avg: {
        overallScore: true,
        discoveryScore: true,
        pitchScore: true,
        objectionHandlingScore: true,
        nextStepScore: true,
      },
      _sum: { costUsd: true, promptTokens: true, completionTokens: true },
    }),
    prisma.telecaller.count(),
    prisma.call.count({ where: { validationStatus: VALIDATION_STATUS.REPAIRED } }),
    prisma.call.count({ where: { siteVisitOutcome: { in: [...COMMITTED_OUTCOMES] } } }),
    prisma.call.groupBy({
      by: ['lastStageReached'],
      orderBy: { lastStageReached: 'asc' },
      _count: { _all: true },
    }),
    prisma.call.groupBy({
      by: ['recommendedNextAction'],
      orderBy: { recommendedNextAction: 'asc' },
      _count: { _all: true },
    }),
    prisma.call.groupBy({ by: ['timeline'], orderBy: { timeline: 'asc' }, _count: { _all: true } }),
    prisma.call.groupBy({
      by: ['unitConfiguration'],
      orderBy: { unitConfiguration: 'asc' },
      _count: { _all: true },
    }),
    prisma.preferredLocation.groupBy({
      by: ['name'],
      _count: { _all: true },
      orderBy: { _count: { name: 'desc' } },
      take: 10,
    }),
    // Only the score column, for bucketing. 150 floats is cheaper to bucket in
    // JS than five COUNT queries, and stays portable across engines.
    prisma.call.findMany({ select: { overallScore: true } }),
  ]);

  const callCount = totals._count._all;

  const payload: Analytics = {
    totals: {
      calls: callCount,
      telecallers: telecallerCount,
      avgOverall: round(totals._avg.overallScore ?? 0),
      totalCostUsd: round(totals._sum.costUsd ?? 0, 6),
      totalTokens: (totals._sum.promptTokens ?? 0) + (totals._sum.completionTokens ?? 0),
      flaggedForReprocessing: flaggedCount,
      siteVisitCommitRate: callCount === 0 ? 0 : round((committedCount / callCount) * 100, 1),
    },
    dimensionAverages: [
      { dimension: 'discovery', avg: round(totals._avg.discoveryScore ?? 0) },
      { dimension: 'pitch', avg: round(totals._avg.pitchScore ?? 0) },
      { dimension: 'objection_handling', avg: round(totals._avg.objectionHandlingScore ?? 0) },
      { dimension: 'next_step', avg: round(totals._avg.nextStepScore ?? 0) },
    ].map((entry) => ({
      ...entry,
      label: DIMENSION_LABELS[entry.dimension as keyof typeof DIMENSION_LABELS],
    })),
    scoreDistribution: SCORE_BUCKETS.map((bucket) => ({
      bucket: bucket.bucket,
      count: scores.filter((row) => row.overallScore >= bucket.min && row.overallScore < bucket.max)
        .length,
    })),
    stageFunnel: toCounts(stageGroups, 'lastStageReached', STAGE_LABELS),
    actionMix: toCounts(actionGroups, 'recommendedNextAction', ACTION_LABELS),
    timelineMix: toCounts(timelineGroups, 'timeline', TIMELINE_LABELS),
    unitMix: toCounts(unitGroups, 'unitConfiguration', UNIT_LABELS),
    topLocations: locationGroups.map((group) => ({
      key: group.name,
      label: group.name,
      count: group._count._all,
    })),
  };

  res.status(200).json(new ApiResponse(200, payload, 'Analytics computed'));
});

function toCounts<K extends string, T extends Record<string, unknown>>(
  groups: T[],
  field: K,
  labels: Record<string, string>,
): CountByKey[] {
  return groups
    .map((group) => {
      const key = String(group[field]);
      const count = (group as { _count?: { _all?: number } })._count?._all ?? 0;
      return { key, label: labels[key] ?? key, count };
    })
    .sort((a, b) => b.count - a.count);
}
