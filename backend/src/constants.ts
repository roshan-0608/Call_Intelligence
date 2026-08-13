/**
 * Fixed values shared across the backend.
 *
 * These were previously duplicated — `COMMITTED_OUTCOMES` existed separately in
 * both the leaderboard and analytics controllers, so a change to what "the lead
 * committed" means would have silently applied to one and not the other.
 */

/** Site-visit outcomes that count as the lead agreeing to visit. */
export const COMMITTED_OUTCOMES = ['committed_with_date', 'committed_no_date'] as const;

/** Score bands used by the distribution chart. Upper bound is exclusive. */
export const SCORE_BUCKETS: ReadonlyArray<{ bucket: string; min: number; max: number }> = [
  { bucket: '0–1', min: 0, max: 1 },
  { bucket: '1–2', min: 1, max: 2 },
  { bucket: '2–3', min: 2, max: 3 },
  { bucket: '3–4', min: 3, max: 4 },
  // Slightly over 5 so a perfect score falls inside the top bucket.
  { bucket: '4–5', min: 4, max: 5.01 },
];

/** Row sources. `seed` is the committed dataset; `upload` came through the API. */
export const CALL_SOURCE = { SEED: 'seed', UPLOAD: 'upload' } as const;

/** Validation states stored on a call row. */
export const VALIDATION_STATUS = { VALID: 'valid', REPAIRED: 'repaired' } as const;

/**
 * Provenance recorded for the committed dataset.
 *
 * Those analyses predate prompt versioning, so they are labelled `legacy` rather
 * than claiming a version that did not exist when they were produced.
 */
export const LEGACY_MODEL = 'llama-3.1-8b-instant';
export const LEGACY_PROMPT_VERSION = 'legacy';

/**
 * Paths on disk, relative to the repository root.
 *
 * The CLI entries (seed, eval, processCalls, validateDataset) are all launched
 * from the root through npm scripts, so resolving from `process.cwd()` keeps
 * them identical whether they run through tsx or compiled JavaScript.
 */
export const PATHS = {
  seedDataset: 'backend/src/data/calls.seed.json',
  rawTranscripts: 'backend/src/data/calls.jsonl',
  failures: 'backend/src/data/calls.failures.json',
  goldenLabels: 'backend/src/eval/labels.json',
  evalResults: 'docs/eval-results.md',
} as const;

/** At least one `[mm:ss-mm:ss] Speaker:` line, which is what the prompt expects. */
export const TRANSCRIPT_LINE_PATTERN = /\[\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\]\s*[^:]{1,40}:/;
