import { randomBytes } from 'node:crypto';
import { uploadRequestSchema, type UploadResponse } from '@call-intel/shared';
import { transcriptHash } from '@call-intel/shared/llm';
import { prisma } from '../db/index.js';
import { env } from '../env.js';
import { BadRequestError, PayloadTooLargeError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { parseBody } from '../middlewares/validate.js';
import { analyzeWithCache, type AnalyzeOutcome } from '../utils/analysisService.js';
import { analysisToColumns, buildSearchText, callInclude } from '../models/call.model.js';
import { toCallDetail } from '../utils/callMapper.js';
import { CALL_SOURCE, TRANSCRIPT_LINE_PATTERN } from '../constants.js';

/**
 * Transcript upload.
 *
 * Ordered so the cheapest rejection happens first: shape, then size, then
 * format, then an exact-duplicate lookup, and only then the model. Every one of
 * those steps is a saved API call. The original endpoint went straight to the
 * model with whatever it was handed.
 *
 * Uploaded calls are written to the database. In the original build the result
 * lived in a `Map` and in React state, so the README's claim that an upload
 * "adds it to the dashboard" stopped being true on the next page refresh.
 */
export const uploadTranscript = asyncHandler(async (req, res) => {
  const body = parseBody(req, uploadRequestSchema);
  const transcript = body.transcript.trim();

  if (transcript.length > env.MAX_TRANSCRIPT_CHARS) {
    throw new PayloadTooLargeError(
      `Transcript is ${transcript.length} characters; the limit is ${env.MAX_TRANSCRIPT_CHARS}. Split long calls before uploading.`,
    );
  }

  if (!TRANSCRIPT_LINE_PATTERN.test(transcript)) {
    throw new BadRequestError(
      'This does not look like a call transcript. Expected timestamped lines, for example: [00:00-00:05] Agent: Vanakkam sir, Suresh here from Skyline Properties',
    );
  }

  // Exact duplicate: return the stored analysis and charge nothing.
  const hash = transcriptHash(transcript);
  const existing = await prisma.call.findFirst({
    where: { transcriptHash: hash },
    include: callInclude,
  });

  if (existing) {
    const duplicate: UploadResponse = {
      call: toCallDetail(existing),
      cached: true,
      duplicate: true,
    };
    res.status(200).json(new ApiResponse(200, duplicate, 'Transcript already analyzed'));
    return;
  }

  const outcome = await analyzeWithCache(transcript);

  if (!body.persist) {
    const preview = buildPreview(body, transcript, hash, outcome);
    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { call: preview, cached: outcome.cached, duplicate: false },
          'Transcript analyzed (not saved)',
        ),
      );
    return;
  }

  const telecallerName = body.telecallerName?.trim() || 'Unassigned';
  const leadName = body.leadName?.trim() || 'Unknown lead';
  const callId = `UPLOAD_${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;

  const telecaller = await prisma.telecaller.upsert({
    where: { name: telecallerName },
    create: { name: telecallerName },
    update: {},
  });

  const created = await prisma.call.create({
    data: {
      callId,
      telecallerId: telecaller.id,
      leadName,
      occurredAt: new Date(),
      durationSec: body.durationSec ?? estimateDurationSec(transcript),
      transcript,
      transcriptHash: hash,
      source: CALL_SOURCE.UPLOAD,
      searchText: buildSearchText({ leadName, telecallerName, callId }),
      ...analysisToColumns({
        analysis: outcome.analysis,
        model: outcome.meta.model,
        promptVersion: outcome.meta.promptVersion,
        promptTokens: outcome.meta.usage.promptTokens,
        completionTokens: outcome.meta.usage.completionTokens,
        costUsd: outcome.meta.costUsd,
        latencyMs: outcome.meta.latencyMs,
        warnings: outcome.meta.warnings,
      }),
      locations: {
        create: dedupe(outcome.analysis.extraction.preferred_locations).map((name) => ({ name })),
      },
    },
    include: callInclude,
  });

  const payload: UploadResponse = {
    call: toCallDetail(created),
    cached: outcome.cached,
    duplicate: false,
  };

  res.status(201).json(new ApiResponse(201, payload, 'Transcript analyzed and saved'));
});

/**
 * Last timestamp in the transcript, used when the caller does not supply a
 * duration. Falls back to 0 rather than guessing from character count.
 */
export function estimateDurationSec(transcript: string): number {
  const stamps = [...transcript.matchAll(/\[(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\]/g)];
  const last = stamps.at(-1);
  if (!last) return 0;
  const minutes = Number(last[3]);
  const seconds = Number(last[4]);
  return minutes * 60 + seconds;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/** Shape-compatible detail object for `persist: false` previews. */
function buildPreview(
  body: { telecallerName?: string; leadName?: string; durationSec?: number },
  transcript: string,
  hash: string,
  outcome: AnalyzeOutcome,
) {
  const now = new Date().toISOString();
  const analysis = outcome.analysis;

  return {
    id: `preview_${hash.slice(0, 12)}`,
    callId: 'PREVIEW',
    telecallerName: body.telecallerName?.trim() || 'Unassigned',
    leadName: body.leadName?.trim() || 'Unknown lead',
    occurredAt: now,
    durationSec: body.durationSec ?? estimateDurationSec(transcript),
    overallScore:
      (analysis.quality_scores.discovery.score +
        analysis.quality_scores.pitch.score +
        analysis.quality_scores.objection_handling.score +
        analysis.quality_scores.next_step.score) /
      4,
    unitConfiguration: analysis.extraction.unit_configuration,
    budget: analysis.extraction.budget_range,
    timeline: analysis.extraction.timeline,
    preferredLocations: analysis.extraction.preferred_locations,
    siteVisitOutcome: analysis.extraction.site_visit_outcome,
    lastStageReached: analysis.last_stage_reached,
    recommendedNextAction: analysis.recommended_next_action,
    summary: analysis.summary,
    validationStatus: 'valid' as const,
    source: CALL_SOURCE.UPLOAD,
    transcript,
    qualityScores: analysis.quality_scores,
    analysis: {
      model: outcome.meta.model,
      promptVersion: outcome.meta.promptVersion,
      promptTokens: outcome.meta.usage.promptTokens,
      completionTokens: outcome.meta.usage.completionTokens,
      costUsd: outcome.meta.costUsd,
      latencyMs: outcome.meta.latencyMs,
      analyzedAt: now,
      warnings: outcome.meta.warnings,
      repairNotes: [],
    },
  };
}
