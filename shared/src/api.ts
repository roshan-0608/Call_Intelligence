import { z } from 'zod';
import {
  CALL_STAGES,
  NEXT_ACTIONS,
  SITE_VISIT_OUTCOMES,
  TIMELINES,
  UNIT_CONFIGURATIONS,
  budgetRangeSchema,
  qualityScoresSchema,
} from './schema.js';

/**
 * The HTTP contract, defined once.
 *
 * The API validates its own responses against these schemas in tests and the
 * web app imports the inferred types, so a renamed field is a compile error in
 * the browser rather than an `undefined` rendered into the DOM.
 */

// --- The response envelope --------------------------------------------------

/**
 * Every 2xx body has the same outer shape, produced by the backend's
 * `ApiResponse`:
 *
 * ```json
 * { "success": true, "statusCode": 200, "message": "Calls fetched", "data": { … } }
 * ```
 *
 * `apiResponseSchema(payload)` validates the envelope and the payload together,
 * so the client unwraps `.data` in exactly one place and a drift in either layer
 * fails loudly instead of rendering `undefined`.
 */
export function apiResponseSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    success: z.literal(true),
    statusCode: z.number().int().min(100).max(599),
    message: z.string(),
    data,
  });
}

/**
 * The envelope with an unvalidated payload.
 *
 * Non-generic on purpose: a client can check the envelope with this and then
 * parse `data` with the endpoint's own schema, which keeps both steps fully
 * typed. Parsing through the generic `apiResponseSchema` instead yields a mapped
 * type whose `.data` TypeScript cannot see, forcing an unsafe cast.
 */
export const apiEnvelopeSchema = z.object({
  success: z.literal(true),
  statusCode: z.number().int().min(100).max(599),
  message: z.string(),
  data: z.unknown(),
});

export interface ApiEnvelope<T> {
  success: true;
  statusCode: number;
  message: string;
  data: T;
}

/**
 * Every non-2xx body, produced by the backend's `ApiError`.
 *
 * `code` is the stable identifier to branch on; `message` is for humans;
 * `errors` carries field-level detail for validation failures; `requestId` ties
 * a user-reported failure to a line in the server log.
 */
export const apiErrorSchema = z.object({
  success: z.literal(false),
  statusCode: z.number().int().min(100).max(599),
  code: z.string(),
  message: z.string(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  requestId: z.string().optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

// --- Shared building blocks -------------------------------------------------

export const paginationMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
  hasNext: z.boolean(),
  hasPrev: z.boolean(),
});

export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item), pagination: paginationMetaSchema });
}

export interface Paginated<T> {
  data: T[];
  pagination: PaginationMeta;
}

/** `valid` analyses passed validation on arrival; `repaired` rows were coerced. */
export const VALIDATION_STATUSES = ['valid', 'repaired'] as const;
export const CALL_SOURCES = ['seed', 'upload'] as const;

export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];
export type CallSource = (typeof CALL_SOURCES)[number];

// --- Calls ------------------------------------------------------------------

/** List-view shape. Excludes the transcript: 150 transcripts is 378KB of JSON. */
export const callSummarySchema = z.object({
  id: z.string(),
  callId: z.string(),
  telecallerName: z.string(),
  leadName: z.string(),
  occurredAt: z.string(),
  durationSec: z.number().int().min(0),
  overallScore: z.number(),
  unitConfiguration: z.enum(UNIT_CONFIGURATIONS),
  budget: budgetRangeSchema,
  timeline: z.enum(TIMELINES),
  preferredLocations: z.array(z.string()),
  siteVisitOutcome: z.enum(SITE_VISIT_OUTCOMES),
  lastStageReached: z.enum(CALL_STAGES),
  recommendedNextAction: z.enum(NEXT_ACTIONS),
  summary: z.string(),
  validationStatus: z.enum(VALIDATION_STATUSES),
  source: z.enum(CALL_SOURCES),
});

export const repairNoteSchema = z.object({
  field: z.string(),
  from: z.string(),
  to: z.string(),
  rule: z.string(),
});

/** Provenance: which model and prompt produced this analysis, at what cost. */
export const analysisMetaSchema = z.object({
  model: z.string(),
  promptVersion: z.string(),
  promptTokens: z.number().int().min(0),
  completionTokens: z.number().int().min(0),
  costUsd: z.number().min(0),
  latencyMs: z.number().int().min(0),
  analyzedAt: z.string(),
  warnings: z.array(z.string()),
  repairNotes: z.array(repairNoteSchema),
});

export const callDetailSchema = callSummarySchema.extend({
  transcript: z.string(),
  qualityScores: qualityScoresSchema,
  analysis: analysisMetaSchema,
});

export type CallSummary = z.infer<typeof callSummarySchema>;
export type CallDetail = z.infer<typeof callDetailSchema>;
export type AnalysisMeta = z.infer<typeof analysisMetaSchema>;
export type RepairNoteDto = z.infer<typeof repairNoteSchema>;

// --- Query parameters -------------------------------------------------------

export const CALL_SORT_FIELDS = ['occurredAt', 'overallScore', 'durationSec', 'leadName'] as const;
export type CallSortField = (typeof CALL_SORT_FIELDS)[number];

export const callListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  /** Free-text match on lead name, telecaller name or call id. */
  q: z.string().trim().max(120).optional(),
  stage: z.enum(CALL_STAGES).optional(),
  action: z.enum(NEXT_ACTIONS).optional(),
  outcome: z.enum(SITE_VISIT_OUTCOMES).optional(),
  telecaller: z.string().trim().max(120).optional(),
  location: z.string().trim().max(120).optional(),
  minScore: z.coerce.number().min(0).max(5).optional(),
  maxScore: z.coerce.number().min(0).max(5).optional(),
  flagged: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  sort: z.enum(CALL_SORT_FIELDS).default('occurredAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type CallListQuery = z.infer<typeof callListQuerySchema>;

// --- Leaderboard ------------------------------------------------------------

/**
 * Dimension averages are spelled out rather than `z.record(enum, number)`:
 * a Zod record infers `Partial<Record<…>>`, which would force an
 * `undefined` check on every dimension at every call site.
 */
export const dimensionAveragesSchema = z.object({
  discovery: z.number(),
  pitch: z.number(),
  objection_handling: z.number(),
  next_step: z.number(),
});

export const leaderboardEntrySchema = z.object({
  rank: z.number().int().min(1),
  telecallerName: z.string(),
  callCount: z.number().int().min(0),
  avgOverall: z.number(),
  dimensionAverages: dimensionAveragesSchema,
  /** Calls where the lead committed to a visit, with or without a date. */
  siteVisitsCommitted: z.number().int().min(0),
  /** siteVisitsCommitted / callCount, as a percentage. */
  commitRate: z.number().min(0).max(100),
});

export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

export const leaderboardQuerySchema = z.object({
  /** Hide telecallers with too few calls to rank meaningfully. */
  minCalls: z.coerce.number().int().min(1).default(1),
});

// --- Analytics --------------------------------------------------------------

export const countByKeySchema = z.object({ key: z.string(), label: z.string(), count: z.number() });

export const analyticsSchema = z.object({
  totals: z.object({
    calls: z.number().int().min(0),
    telecallers: z.number().int().min(0),
    avgOverall: z.number(),
    totalCostUsd: z.number().min(0),
    totalTokens: z.number().int().min(0),
    flaggedForReprocessing: z.number().int().min(0),
    siteVisitCommitRate: z.number().min(0).max(100),
  }),
  dimensionAverages: z.array(
    z.object({ dimension: z.string(), label: z.string(), avg: z.number() }),
  ),
  scoreDistribution: z.array(z.object({ bucket: z.string(), count: z.number() })),
  stageFunnel: z.array(countByKeySchema),
  actionMix: z.array(countByKeySchema),
  timelineMix: z.array(countByKeySchema),
  unitMix: z.array(countByKeySchema),
  topLocations: z.array(countByKeySchema),
});

export type Analytics = z.infer<typeof analyticsSchema>;
export type CountByKey = z.infer<typeof countByKeySchema>;

// --- Upload -----------------------------------------------------------------

export const uploadRequestSchema = z.object({
  transcript: z.string().min(20, 'A transcript needs at least 20 characters'),
  telecallerName: z.string().trim().min(1).max(120).optional(),
  leadName: z.string().trim().min(1).max(120).optional(),
  durationSec: z.coerce
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60)
    .optional(),
  /** Set false to analyze without writing the call to the database. */
  persist: z.boolean().default(true),
});

export type UploadRequest = z.infer<typeof uploadRequestSchema>;

export const uploadResponseSchema = z.object({
  call: callDetailSchema,
  /** True when the analysis was served from the persistent cache. */
  cached: z.boolean(),
  /** True when an existing call with the same transcript hash was returned. */
  duplicate: z.boolean(),
});

export type UploadResponse = z.infer<typeof uploadResponseSchema>;

// --- Errors -----------------------------------------------------------------
