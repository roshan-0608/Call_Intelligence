import type { Call, PreferredLocation, Prisma, Telecaller } from '@prisma/client';
import { overallScore, type CallAnalysis, type RepairNoteDto } from '@call-intel/shared';
import { VALIDATION_STATUS } from '../constants.js';

/**
 * The shape of a call as this application handles it.
 *
 * With Prisma there is no hand-written model class: the table definition lives
 * in `prisma/schema.prisma` and the row types are generated from it. What still
 * needs a home is everything the generator cannot know — which relations a query
 * must include, which row shape each query returns, and how a validated analysis
 * becomes column values. That is this file.
 *
 * Keeping it separate from `utils/callMapper.ts` draws the line at direction:
 * this module describes rows going *into* the database, the mapper turns rows
 * coming *out* of it into API DTOs.
 */

/** Relations every call query needs to build a DTO. */
export const callInclude = {
  telecaller: true,
  locations: { orderBy: { name: 'asc' } },
} as const satisfies Prisma.CallInclude;

/**
 * List queries omit the transcript — returning all 150 transcripts was 378KB of
 * JSON per page load in the original API.
 */
export type CallSummaryRow = Omit<Call, 'transcript'> & {
  telecaller: Telecaller;
  locations: PreferredLocation[];
};

export type CallRow = CallSummaryRow & { transcript: string };

/** Analysis plus provenance, ready to be flattened into column values. */
export interface AnalysisColumnsInput {
  analysis: CallAnalysis;
  model: string;
  promptVersion: string;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  validationStatus?: (typeof VALIDATION_STATUS)[keyof typeof VALIDATION_STATUS];
  repairNotes?: RepairNoteDto[];
  warnings?: string[];
}

/**
 * Flattens a validated analysis into Prisma column values.
 *
 * Every write path goes through here, which is why the enum columns can safely
 * be plain strings: nothing can insert a value that did not first pass
 * `analysisSchema`.
 */
export function analysisToColumns(input: AnalysisColumnsInput) {
  const { analysis } = input;
  const budget = analysis.extraction.budget_range;
  const discussed = budget !== 'not_discussed';

  return {
    unitConfiguration: analysis.extraction.unit_configuration,
    budgetDiscussed: discussed,
    budgetMinLakhs: discussed ? budget.min_lakhs : null,
    budgetMaxLakhs: discussed ? budget.max_lakhs : null,
    timeline: analysis.extraction.timeline,
    siteVisitOutcome: analysis.extraction.site_visit_outcome,

    discoveryScore: analysis.quality_scores.discovery.score,
    discoveryReason: analysis.quality_scores.discovery.reason,
    pitchScore: analysis.quality_scores.pitch.score,
    pitchReason: analysis.quality_scores.pitch.reason,
    objectionHandlingScore: analysis.quality_scores.objection_handling.score,
    objectionHandlingReason: analysis.quality_scores.objection_handling.reason,
    nextStepScore: analysis.quality_scores.next_step.score,
    nextStepReason: analysis.quality_scores.next_step.reason,
    overallScore: overallScore(analysis.quality_scores),

    lastStageReached: analysis.last_stage_reached,
    recommendedNextAction: analysis.recommended_next_action,
    summary: analysis.summary,

    model: input.model,
    promptVersion: input.promptVersion,
    promptTokens: input.promptTokens ?? 0,
    completionTokens: input.completionTokens ?? 0,
    costUsd: input.costUsd ?? 0,
    latencyMs: input.latencyMs ?? 0,
    validationStatus: input.validationStatus ?? VALIDATION_STATUS.VALID,
    repairNotes: input.repairNotes?.length ? JSON.stringify(input.repairNotes) : null,
    warnings: input.warnings?.length ? JSON.stringify(input.warnings) : null,
  };
}

/**
 * Lowercased haystack for the portable search column.
 *
 * Prisma's `mode: 'insensitive'` is PostgreSQL-only and SQLite's LIKE is
 * case-insensitive only for ASCII, so searching a pre-lowercased column is what
 * keeps search behaving identically on both engines.
 */
export function buildSearchText(parts: {
  leadName: string;
  telecallerName: string;
  callId: string;
}): string {
  return `${parts.leadName} ${parts.telecallerName} ${parts.callId}`.toLowerCase();
}
