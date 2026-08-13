import type { z } from 'zod';
import {
  UNIT_CONFIGURATIONS,
  analysisSchema,
  type CallAnalysis,
  type UnitConfiguration,
} from './schema.js';

/**
 * Repairs for the v1 dataset (`data/calls.seed.json`).
 *
 * That file was produced before the pipeline validated model output, so 19 of
 * its 150 rows carry values the schema rejects. Rather than hand-edit the JSON —
 * which would hide the failure mode the project exists to demonstrate — the
 * seeder runs these deterministic repairs, records what it changed, and stores
 * the row with `validationStatus: 'repaired'` so the dashboard can surface it
 * and `npm run process-calls -- --repair` can re-analyze just those rows.
 *
 * Observed violations (19 rows; some rows carry two):
 *   - unit_configuration: `"2BHK | 3BHK"` (x6), `"3BHK | villa"`, `"2BHK | 2BHK"`,
 *     and one row that echoed the entire enum spec line back as its answer.
 *   - budget_range: `{min_lakhs: 0, max_lakhs: 0}` (x9) — the model's workaround
 *     for "never return null", which produces a fact that is simply false.
 *   - site_visit_outcome: `"next_step_confirmed"`, `"close_attempt"` — call-stage
 *     values leaking into the site-visit field.
 */

export type RepairNote = {
  field: string;
  from: string;
  to: string;
  rule: string;
};

export type LegacyRepairResult =
  | { ok: true; analysis: CallAnalysis; repairs: RepairNote[] }
  | { ok: false; repairs: RepairNote[]; error: z.ZodError };

const UNIT_SET = new Set<string>(UNIT_CONFIGURATIONS);

/** Legal values for the field the leaked values actually belong to. */
const LEAKED_STAGE_VALUES = new Set(['next_step_confirmed', 'close_attempt', 'objection_handling']);

function repairUnitConfiguration(value: unknown, repairs: RepairNote[]): unknown {
  if (typeof value !== 'string' || UNIT_SET.has(value)) return value;
  if (!value.includes('|')) return value;

  const tokens = value
    .split('|')
    .map((token) => token.trim())
    .filter((token) => UNIT_SET.has(token)) as UnitConfiguration[];
  const distinct = [...new Set(tokens)];

  // The model echoed the whole enum spec instead of choosing: no signal at all.
  if (distinct.length === UNIT_CONFIGURATIONS.length) {
    repairs.push({
      field: 'extraction.unit_configuration',
      from: value,
      to: 'not_discussed',
      rule: 'enum spec echoed verbatim; treated as no answer',
    });
    return 'not_discussed';
  }

  // `"2BHK | 2BHK"` — one real answer, duplicated.
  if (distinct.length === 1 && distinct[0]) {
    repairs.push({
      field: 'extraction.unit_configuration',
      from: value,
      to: distinct[0],
      rule: 'single distinct legal value after splitting on "|"',
    });
    return distinct[0];
  }

  // `"2BHK | 3BHK"` — the lead genuinely discussed several. The schema holds one,
  // so keep the first and flag the row; the repair run recovers the real answer.
  if (distinct.length > 1 && distinct[0]) {
    repairs.push({
      field: 'extraction.unit_configuration',
      from: value,
      to: distinct[0],
      rule: 'multiple legal values; kept first, row flagged for reprocessing',
    });
    return distinct[0];
  }

  return value;
}

function repairBudgetRange(value: unknown, repairs: RepairNote[]): unknown {
  if (value === null || value === undefined) {
    repairs.push({
      field: 'extraction.budget_range',
      from: String(value),
      to: 'not_discussed',
      rule: 'null budget replaced with explicit sentinel',
    });
    return 'not_discussed';
  }

  if (typeof value !== 'object') return value;

  const range = value as { min_lakhs?: unknown; max_lakhs?: unknown };
  const min = typeof range.min_lakhs === 'number' ? range.min_lakhs : NaN;
  const max = typeof range.max_lakhs === 'number' ? range.max_lakhs : NaN;

  // {0, 0} is "not discussed" wearing a number's clothes.
  if (min <= 0 && max <= 0) {
    repairs.push({
      field: 'extraction.budget_range',
      from: JSON.stringify(value),
      to: 'not_discussed',
      rule: 'zero-valued budget range treated as not discussed',
    });
    return 'not_discussed';
  }

  // One bound present, the other zeroed: a single quoted figure.
  if (min > 0 && max <= 0) {
    repairs.push({
      field: 'extraction.budget_range',
      from: JSON.stringify(value),
      to: JSON.stringify({ min_lakhs: min, max_lakhs: min }),
      rule: 'zero upper bound collapsed to the single stated figure',
    });
    return { min_lakhs: min, max_lakhs: min };
  }
  if (max > 0 && min <= 0) {
    repairs.push({
      field: 'extraction.budget_range',
      from: JSON.stringify(value),
      to: JSON.stringify({ min_lakhs: max, max_lakhs: max }),
      rule: 'zero lower bound collapsed to the single stated figure',
    });
    return { min_lakhs: max, max_lakhs: max };
  }

  // Inverted range: the numbers are right, the labels are swapped.
  if (min > 0 && max > 0 && max < min) {
    repairs.push({
      field: 'extraction.budget_range',
      from: JSON.stringify(value),
      to: JSON.stringify({ min_lakhs: max, max_lakhs: min }),
      rule: 'inverted budget range swapped',
    });
    return { min_lakhs: max, max_lakhs: min };
  }

  return value;
}

function repairSiteVisitOutcome(value: unknown, repairs: RepairNote[]): unknown {
  if (typeof value !== 'string' || !LEAKED_STAGE_VALUES.has(value)) return value;
  repairs.push({
    field: 'extraction.site_visit_outcome',
    from: value,
    to: 'not_asked',
    rule: 'call-stage value leaked into site-visit field; no visit evidence retained',
  });
  return 'not_asked';
}

/**
 * Best-effort coercion of one legacy record into a schema-valid analysis.
 * Never throws; returns the Zod error when the row cannot be salvaged.
 */
export function repairLegacyAnalysis(input: unknown): LegacyRepairResult {
  const repairs: RepairNote[] = [];

  const source = (input ?? {}) as Record<string, unknown>;
  const extraction = { ...((source.extraction ?? {}) as Record<string, unknown>) };

  extraction.unit_configuration = repairUnitConfiguration(extraction.unit_configuration, repairs);
  extraction.budget_range = repairBudgetRange(extraction.budget_range, repairs);
  extraction.site_visit_outcome = repairSiteVisitOutcome(extraction.site_visit_outcome, repairs);

  const candidate = {
    extraction,
    quality_scores: source.quality_scores,
    last_stage_reached: source.last_stage_reached,
    recommended_next_action: source.recommended_next_action,
    summary: source.summary,
  };

  const parsed = analysisSchema.safeParse(candidate);
  if (parsed.success) {
    return { ok: true, analysis: parsed.data, repairs };
  }
  return { ok: false, repairs, error: parsed.error };
}
