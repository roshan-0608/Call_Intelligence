import {
  CALL_STAGES,
  MAX_SCORE,
  SCORE_DIMENSIONS,
  type BudgetRange,
  type CallStage,
  type NextAction,
  type QualityScores,
  type SiteVisitOutcome,
  type Timeline,
  type UnitConfiguration,
} from './schema.js';

/**
 * Presentation-neutral derivations over an analysis. Kept here rather than in
 * the web app so the API, the eval harness, and the UI cannot disagree about
 * what "overall score" means — the original build computed it in the browser
 * only, which made server-side sorting by score impossible.
 */

/** Unweighted mean of the four dimension scores, 0-5, rounded to 2 decimals. */
export function overallScore(scores: QualityScores): number {
  const total = SCORE_DIMENSIONS.reduce((sum, dimension) => sum + scores[dimension].score, 0);
  return round(total / SCORE_DIMENSIONS.length, 2);
}

export type ScoreBand = 'strong' | 'developing' | 'weak';

/** Coaching band used for colour coding. Thresholds are documented in docs/decisions.md. */
export function scoreBand(score: number): ScoreBand {
  if (score >= 4) return 'strong';
  if (score >= 2.5) return 'developing';
  return 'weak';
}

export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Percentage of the maximum, for progress bars. */
export function scoreAsPercent(score: number): number {
  return round((score / MAX_SCORE) * 100, 1);
}

/** Stage funnel position; `-1` for unknown stages. */
export function stageIndex(stage: CallStage): number {
  return CALL_STAGES.indexOf(stage);
}

/**
 * Sentence count used to check the "exactly two sentences" summary rule.
 * Splits on terminal punctuation followed by whitespace, so decimals and
 * abbreviations inside a sentence do not inflate the count.
 */
export function countSentences(text: string): number {
  return text
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z"'À-ɏ])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0).length;
}

// --- Display formatting -----------------------------------------------------

export function formatBudget(budget: BudgetRange): string {
  if (budget === 'not_discussed') return 'Not discussed';
  if (budget.min_lakhs === budget.max_lakhs) return `₹${budget.min_lakhs}L`;
  return `₹${budget.min_lakhs}L – ₹${budget.max_lakhs}L`;
}

export const UNIT_LABELS: Record<UnitConfiguration, string> = {
  '2BHK': '2 BHK',
  '3BHK': '3 BHK',
  '4BHK': '4 BHK',
  villa: 'Villa',
  plot: 'Plot',
  not_discussed: 'Not discussed',
};

export const TIMELINE_LABELS: Record<Timeline, string> = {
  immediate: 'Immediate',
  '3_to_6_months': '3–6 months',
  '6_to_12_months': '6–12 months',
  exploring: 'Exploring',
  unclear: 'Unclear',
};

export const SITE_VISIT_LABELS: Record<SiteVisitOutcome, string> = {
  committed_with_date: 'Committed (date set)',
  committed_no_date: 'Committed (no date)',
  declined: 'Declined',
  not_asked: 'Not asked',
  call_cut: 'Call cut',
};

export const STAGE_LABELS: Record<CallStage, string> = {
  greeting: 'Greeting',
  discovery: 'Discovery',
  pitch: 'Pitch',
  objection_handling: 'Objection handling',
  close_attempt: 'Close attempt',
  next_step_confirmed: 'Next step confirmed',
};

export const ACTION_LABELS: Record<NextAction, string> = {
  schedule_callback_3_days: 'Schedule callback (3 days)',
  confirm_site_visit: 'Confirm site visit',
  escalate_to_manager: 'Escalate to manager',
  send_brochure_whatsapp: 'Send brochure on WhatsApp',
  mark_cold: 'Mark cold',
  no_action: 'No action',
};

export const DIMENSION_LABELS: Record<(typeof SCORE_DIMENSIONS)[number], string> = {
  discovery: 'Discovery',
  pitch: 'Pitch',
  objection_handling: 'Objection handling',
  next_step: 'Next step',
};

/** Fallback for any snake_case enum value rendered without an explicit label. */
export function humanizeEnum(value: string): string {
  return value
    .split('_')
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/** Seconds to `m:ss`. */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}
