import { z } from 'zod';

/**
 * The analysis contract.
 *
 * This file is the single source of truth for the shape of an LLM analysis.
 * The pipeline validates against it, the API validates request/response bodies
 * with it, the seeder refuses to import rows that violate it, and the web app
 * derives its TypeScript types from it. Changing an enum here is a deliberate,
 * one-place decision rather than a search-and-replace across three codebases.
 */

export const UNIT_CONFIGURATIONS = [
  '2BHK',
  '3BHK',
  '4BHK',
  'villa',
  'plot',
  'not_discussed',
] as const;

export const TIMELINES = [
  'immediate',
  '3_to_6_months',
  '6_to_12_months',
  'exploring',
  'unclear',
] as const;

export const SITE_VISIT_OUTCOMES = [
  'committed_with_date',
  'committed_no_date',
  'declined',
  'not_asked',
  'call_cut',
] as const;

export const CALL_STAGES = [
  'greeting',
  'discovery',
  'pitch',
  'objection_handling',
  'close_attempt',
  'next_step_confirmed',
] as const;

export const NEXT_ACTIONS = [
  'schedule_callback_3_days',
  'confirm_site_visit',
  'escalate_to_manager',
  'send_brochure_whatsapp',
  'mark_cold',
  'no_action',
] as const;

/** The four coaching dimensions, in the order they are displayed. */
export const SCORE_DIMENSIONS = ['discovery', 'pitch', 'objection_handling', 'next_step'] as const;

export const MAX_SCORE = 5;

// --- Extraction -------------------------------------------------------------

/**
 * Budget is either a range in lakhs or the explicit string `not_discussed`.
 *
 * `min_lakhs` is `.positive()`, not `.min(0)`, on purpose. Told "never return
 * null", the model started encoding "not discussed" as `{min_lakhs: 0,
 * max_lakhs: 0}` — 9 of 150 rows in the v1 dataset. A zero-rupee budget is not
 * a fact, so the schema rejects it and forces the honest sentinel value.
 */
export const budgetRangeSchema = z.union([
  z
    .object({
      min_lakhs: z.number().positive().max(100_000),
      max_lakhs: z.number().positive().max(100_000),
    })
    .strict()
    .refine((b) => b.max_lakhs >= b.min_lakhs, {
      message: 'max_lakhs must be greater than or equal to min_lakhs',
    }),
  z.literal('not_discussed'),
]);

export const extractionSchema = z
  .object({
    unit_configuration: z.enum(UNIT_CONFIGURATIONS),
    budget_range: budgetRangeSchema,
    timeline: z.enum(TIMELINES),
    /** Buying-preference locations only. Empty array means none were stated. */
    preferred_locations: z.array(z.string().min(1).max(120)).max(10),
    site_visit_outcome: z.enum(SITE_VISIT_OUTCOMES),
  })
  .strict();

// --- Quality scores ---------------------------------------------------------

export const dimensionScoreSchema = z
  .object({
    score: z.number().int().min(0).max(MAX_SCORE),
    /** One sentence citing the transcript. Required: a score with no rationale is not reviewable. */
    reason: z.string().min(3).max(600),
  })
  .strict();

export const qualityScoresSchema = z
  .object({
    discovery: dimensionScoreSchema,
    pitch: dimensionScoreSchema,
    objection_handling: dimensionScoreSchema,
    next_step: dimensionScoreSchema,
  })
  .strict();

// --- Full analysis ----------------------------------------------------------

export const analysisSchema = z
  .object({
    extraction: extractionSchema,
    quality_scores: qualityScoresSchema,
    last_stage_reached: z.enum(CALL_STAGES),
    recommended_next_action: z.enum(NEXT_ACTIONS),
    summary: z.string().min(10).max(1000),
  })
  .strict();

// --- Call records -----------------------------------------------------------

export const callMetadataSchema = z.object({
  call_id: z.string().min(1).max(64),
  telecaller_name: z.string().min(1).max(120),
  lead_name: z.string().min(1).max(120),
  /** ISO-8601 with offset, e.g. 2026-04-01T10:00:00+05:30 */
  timestamp: z.string().datetime({ offset: true }),
  duration_sec: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60),
  transcript: z.string().min(1),
});

/**
 * A fully analyzed call: source metadata plus its analysis.
 *
 * `.strip()` rather than strict: `analysisSchema` is strict because an extra key
 * there means the model invented a field, but a record read back from the
 * database legitimately carries extra columns (ids, timestamps, flags).
 */
export const callRecordSchema = callMetadataSchema.merge(analysisSchema.strip());

/** Raw input row as produced by the upstream call system (pre-analysis). */
export const rawCallSchema = callMetadataSchema;

// --- Inferred types ---------------------------------------------------------

export type UnitConfiguration = (typeof UNIT_CONFIGURATIONS)[number];
export type Timeline = (typeof TIMELINES)[number];
export type SiteVisitOutcome = (typeof SITE_VISIT_OUTCOMES)[number];
export type CallStage = (typeof CALL_STAGES)[number];
export type NextAction = (typeof NEXT_ACTIONS)[number];
export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

export type BudgetRange = z.infer<typeof budgetRangeSchema>;
export type Extraction = z.infer<typeof extractionSchema>;
export type DimensionScore = z.infer<typeof dimensionScoreSchema>;
export type QualityScores = z.infer<typeof qualityScoresSchema>;
export type CallAnalysis = z.infer<typeof analysisSchema>;
export type CallMetadata = z.infer<typeof callMetadataSchema>;
export type CallRecord = z.infer<typeof callRecordSchema>;
export type RawCall = z.infer<typeof rawCallSchema>;

/**
 * The JSON Schema handed to the model in the prompt. Generated from the Zod
 * enums above so the prompt can never drift from what validation accepts —
 * the drift that let `"2BHK | 3BHK"` into the v1 dataset.
 */
export function analysisJsonSpec(): string {
  const list = (values: readonly string[]) => values.join(' | ');
  return `{
  "extraction": {
    "unit_configuration": one of [${list(UNIT_CONFIGURATIONS)}],
    "budget_range": {"min_lakhs": <number>, "max_lakhs": <number>} OR the string "not_discussed",
    "timeline": one of [${list(TIMELINES)}],
    "preferred_locations": array of strings (may be empty),
    "site_visit_outcome": one of [${list(SITE_VISIT_OUTCOMES)}]
  },
  "quality_scores": {
    "discovery": {"score": <integer 0-${MAX_SCORE}>, "reason": "<one sentence>"},
    "pitch": {"score": <integer 0-${MAX_SCORE}>, "reason": "<one sentence>"},
    "objection_handling": {"score": <integer 0-${MAX_SCORE}>, "reason": "<one sentence>"},
    "next_step": {"score": <integer 0-${MAX_SCORE}>, "reason": "<one sentence>"}
  },
  "last_stage_reached": one of [${list(CALL_STAGES)}],
  "recommended_next_action": one of [${list(NEXT_ACTIONS)}],
  "summary": "<exactly two sentences>"
}`;
}
