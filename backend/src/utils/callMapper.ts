import {
  type CallDetail,
  type CallSource,
  type CallStage,
  type CallSummary,
  type NextAction,
  type RepairNoteDto,
  type SiteVisitOutcome,
  type Timeline,
  type UnitConfiguration,
  type ValidationStatus,
} from '@call-intel/shared';
import type { CallRow, CallSummaryRow } from '../models/call.model.js';

/**
 * Database row → API DTO.
 *
 * Enum columns are plain strings in SQLite and Postgres, so they are cast on the
 * way out. That is safe because every write path validates through
 * `analysisSchema` first — no route can put an arbitrary string in these columns.
 */

export function toCallSummary(row: CallSummaryRow): CallSummary {
  return {
    id: row.id,
    callId: row.callId,
    telecallerName: row.telecaller.name,
    leadName: row.leadName,
    occurredAt: row.occurredAt.toISOString(),
    durationSec: row.durationSec,
    overallScore: row.overallScore,
    unitConfiguration: row.unitConfiguration as UnitConfiguration,
    budget:
      row.budgetDiscussed && row.budgetMinLakhs !== null && row.budgetMaxLakhs !== null
        ? { min_lakhs: row.budgetMinLakhs, max_lakhs: row.budgetMaxLakhs }
        : 'not_discussed',
    timeline: row.timeline as Timeline,
    preferredLocations: row.locations.map((location) => location.name),
    siteVisitOutcome: row.siteVisitOutcome as SiteVisitOutcome,
    lastStageReached: row.lastStageReached as CallStage,
    recommendedNextAction: row.recommendedNextAction as NextAction,
    summary: row.summary,
    validationStatus: row.validationStatus as ValidationStatus,
    source: row.source as CallSource,
  };
}

export function toCallDetail(row: CallRow): CallDetail {
  return {
    ...toCallSummary(row),
    transcript: row.transcript,
    qualityScores: {
      discovery: { score: row.discoveryScore, reason: row.discoveryReason },
      pitch: { score: row.pitchScore, reason: row.pitchReason },
      objection_handling: {
        score: row.objectionHandlingScore,
        reason: row.objectionHandlingReason,
      },
      next_step: { score: row.nextStepScore, reason: row.nextStepReason },
    },
    analysis: {
      model: row.model,
      promptVersion: row.promptVersion,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      costUsd: row.costUsd,
      latencyMs: row.latencyMs,
      analyzedAt: row.analyzedAt.toISOString(),
      warnings: parseJsonArray<string>(row.warnings),
      repairNotes: parseJsonArray<RepairNoteDto>(row.repairNotes),
    },
  };
}

/** Tolerant parse: a malformed provenance blob must not break a call detail. */
function parseJsonArray<T>(value: string | null): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
