/**
 * Evaluation harness.
 *
 *   npm run eval -- --offline          score the committed dataset, no API calls
 *   npm run eval                       run the current prompt live, then score
 *   npm run eval -- --prompt v1,v2,v3,v4  compare prompt versions
 *   npm run eval -- --consistency 3    re-run each call N times, report spread
 *   npm run eval -- --write            update docs/eval-results.md
 *
 * Measures what can be measured honestly:
 *   - extraction and routing fields against hand labels in backend/src/eval/
 *   - schema-validity and soft-rule compliance over the whole run
 *   - score *stability* across repeated runs, not score "accuracy"
 *   - tokens, cost and latency per call
 *
 * See backend/src/eval/README.md for why the 0-5 scores are not label-scored.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PATHS } from '../constants.js';
import { z } from 'zod';
import {
  MAX_SCORE,
  SCORE_DIMENSIONS,
  analysisSchema,
  budgetRangeSchema,
  callMetadataSchema,
  countSentences,
  isPromptVersion,
  repairLegacyAnalysis,
  round,
  CALL_STAGES,
  NEXT_ACTIONS,
  SITE_VISIT_OUTCOMES,
  TIMELINES,
  UNIT_CONFIGURATIONS,
  type BudgetRange,
  type CallAnalysis,
  type PromptVersion,
  type ScoreDimension,
} from '@call-intel/shared';
import {
  GroqClient,
  collectWarnings,
  formatUsd,
  safeAnalyzeTranscript,
  type TokenUsage,
} from '@call-intel/shared/llm';

// --- Golden set -------------------------------------------------------------

const goldenLabelSchema = z.object({
  call_id: z.string(),
  unit_configuration: z.enum(UNIT_CONFIGURATIONS),
  budget_range: budgetRangeSchema,
  timeline: z.enum(TIMELINES),
  preferred_locations: z.array(z.string()),
  site_visit_outcome: z.enum(SITE_VISIT_OUTCOMES),
  last_stage_reached: z.enum(CALL_STAGES),
  recommended_next_action: z.enum(NEXT_ACTIONS),
  note: z.string().optional(),
});

type GoldenLabel = z.infer<typeof goldenLabelSchema>;

const SCORED_FIELDS = [
  'unit_configuration',
  'budget_range',
  'timeline',
  'preferred_locations',
  'site_visit_outcome',
  'last_stage_reached',
  'recommended_next_action',
] as const;

type ScoredField = (typeof SCORED_FIELDS)[number];

// --- CLI --------------------------------------------------------------------

interface Options {
  offline: boolean;
  write: boolean;
  promptVersions: PromptVersion[];
  consistency: number;
  limit: number | undefined;
}

function parseArgs(argv: string[]): Options {
  const has = (flag: string) => argv.includes(flag);
  const valueOf = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };

  const promptArg = valueOf('--prompt');
  const versions = (promptArg ? promptArg.split(',') : ['v3'])
    .map((value) => value.trim())
    .filter(isPromptVersion);

  const limitArg = valueOf('--limit');

  return {
    offline: has('--offline'),
    write: has('--write'),
    promptVersions: versions.length > 0 ? versions : ['v3'],
    consistency: Number(valueOf('--consistency') ?? 1),
    limit: limitArg ? Number(limitArg) : undefined,
  };
}

// --- Field comparison -------------------------------------------------------

function budgetsMatch(expected: BudgetRange, actual: BudgetRange): boolean {
  if (expected === 'not_discussed' || actual === 'not_discussed') return expected === actual;
  return expected.min_lakhs === actual.min_lakhs && expected.max_lakhs === actual.max_lakhs;
}

/** Case- and order-insensitive set comparison for locations. */
function locationsMatch(expected: string[], actual: string[]): boolean {
  const normalize = (values: string[]) =>
    [...new Set(values.map((value) => value.trim().toLowerCase()))].sort().join('|');
  return normalize(expected) === normalize(actual);
}

function fieldMatches(field: ScoredField, label: GoldenLabel, analysis: CallAnalysis): boolean {
  switch (field) {
    case 'unit_configuration':
      return analysis.extraction.unit_configuration === label.unit_configuration;
    case 'budget_range':
      return budgetsMatch(label.budget_range, analysis.extraction.budget_range);
    case 'timeline':
      return analysis.extraction.timeline === label.timeline;
    case 'preferred_locations':
      return locationsMatch(label.preferred_locations, analysis.extraction.preferred_locations);
    case 'site_visit_outcome':
      return analysis.extraction.site_visit_outcome === label.site_visit_outcome;
    case 'last_stage_reached':
      return analysis.last_stage_reached === label.last_stage_reached;
    case 'recommended_next_action':
      return analysis.recommended_next_action === label.recommended_next_action;
  }
}

function actualValue(field: ScoredField, analysis: CallAnalysis): string {
  switch (field) {
    case 'unit_configuration':
      return analysis.extraction.unit_configuration;
    case 'budget_range':
      return JSON.stringify(analysis.extraction.budget_range);
    case 'timeline':
      return analysis.extraction.timeline;
    case 'preferred_locations':
      return JSON.stringify(analysis.extraction.preferred_locations);
    case 'site_visit_outcome':
      return analysis.extraction.site_visit_outcome;
    case 'last_stage_reached':
      return analysis.last_stage_reached;
    case 'recommended_next_action':
      return analysis.recommended_next_action;
  }
}

function expectedValue(field: ScoredField, label: GoldenLabel): string {
  const value = label[field];
  return typeof value === 'string' ? value : JSON.stringify(value);
}

// --- Result shapes ----------------------------------------------------------

interface CallOutcome {
  callId: string;
  ok: boolean;
  error?: string;
  analysis?: CallAnalysis;
  usage?: TokenUsage;
  costUsd?: number;
  latencyMs?: number;
  repairsUsed?: number;
  warnings: string[];
  /** Overall score per repetition, for the consistency metric. */
  overallScores: number[];
  dimensionScores: Record<ScoreDimension, number[]>;
}

interface RunReport {
  label: string;
  calls: number;
  failures: number;
  schemaValidFirstTry: number;
  repairsUsed: number;
  fieldMatches: Record<ScoredField, { matched: number; total: number }>;
  mismatches: Array<{ callId: string; field: ScoredField; expected: string; actual: string }>;
  warnings: number;
  summaryTwoSentences: { ok: number; total: number };
  usage: TokenUsage;
  costUsd: number;
  latencies: number[];
  consistency: { maxSpread: number; meanSpread: number; samples: number } | null;
}

function emptyFieldMatches(): Record<ScoredField, { matched: number; total: number }> {
  return Object.fromEntries(
    SCORED_FIELDS.map((field) => [field, { matched: 0, total: 0 }]),
  ) as Record<ScoredField, { matched: number; total: number }>;
}

function score(label: string, labels: GoldenLabel[], outcomes: CallOutcome[]): RunReport {
  const report: RunReport = {
    label,
    calls: outcomes.length,
    failures: outcomes.filter((outcome) => !outcome.ok).length,
    schemaValidFirstTry: outcomes.filter((o) => o.ok && (o.repairsUsed ?? 0) === 0).length,
    repairsUsed: outcomes.reduce((sum, o) => sum + (o.repairsUsed ?? 0), 0),
    fieldMatches: emptyFieldMatches(),
    mismatches: [],
    warnings: outcomes.reduce((sum, o) => sum + o.warnings.length, 0),
    summaryTwoSentences: { ok: 0, total: 0 },
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    costUsd: 0,
    latencies: [],
    consistency: null,
  };

  const labelById = new Map(labels.map((entry) => [entry.call_id, entry]));

  for (const outcome of outcomes) {
    if (outcome.usage) {
      report.usage.promptTokens += outcome.usage.promptTokens;
      report.usage.completionTokens += outcome.usage.completionTokens;
      report.usage.totalTokens += outcome.usage.totalTokens;
    }
    report.costUsd += outcome.costUsd ?? 0;
    if (outcome.latencyMs) report.latencies.push(outcome.latencyMs);

    if (!outcome.ok || !outcome.analysis) continue;

    report.summaryTwoSentences.total += 1;
    if (countSentences(outcome.analysis.summary) === 2) report.summaryTwoSentences.ok += 1;

    const goldenLabel = labelById.get(outcome.callId);
    if (!goldenLabel) continue;

    for (const field of SCORED_FIELDS) {
      report.fieldMatches[field].total += 1;
      if (fieldMatches(field, goldenLabel, outcome.analysis)) {
        report.fieldMatches[field].matched += 1;
      } else {
        report.mismatches.push({
          callId: outcome.callId,
          field,
          expected: expectedValue(field, goldenLabel),
          actual: actualValue(field, outcome.analysis),
        });
      }
    }
  }

  // Consistency: spread of the overall score across repetitions of the same call.
  const spreads = outcomes
    .filter((outcome) => outcome.overallScores.length > 1)
    .map((outcome) => Math.max(...outcome.overallScores) - Math.min(...outcome.overallScores));

  if (spreads.length > 0) {
    report.consistency = {
      maxSpread: round(Math.max(...spreads), 2),
      meanSpread: round(spreads.reduce((a, b) => a + b, 0) / spreads.length, 2),
      samples: spreads.length,
    };
  }

  return report;
}

// --- Runners ----------------------------------------------------------------

interface SeedRow {
  call_id: string;
  transcript: string;
  [key: string]: unknown;
}

function loadSeed(): SeedRow[] {
  const rows = JSON.parse(readFileSync(resolve(PATHS.seedDataset), 'utf8')) as unknown[];
  return rows.map((row) => {
    const parsed = callMetadataSchema.parse(row);
    return { ...(row as Record<string, unknown>), ...parsed } as SeedRow;
  });
}

function loadLabels(): GoldenLabel[] {
  const raw = JSON.parse(readFileSync(resolve(PATHS.goldenLabels), 'utf8')) as unknown[];
  return raw.map((entry) => goldenLabelSchema.parse(entry));
}

function emptyDimensionScores(): Record<ScoreDimension, number[]> {
  // Written out rather than built with Object.fromEntries, which widens to
  // Record<string, never[]> and needs an unsafe cast to satisfy the return type.
  return { discovery: [], pitch: [], objection_handling: [], next_step: [] };
}

function overall(analysis: CallAnalysis): number {
  return (
    SCORE_DIMENSIONS.reduce((sum, d) => sum + analysis.quality_scores[d].score, 0) /
    SCORE_DIMENSIONS.length
  );
}

/**
 * Offline run: score the analyses already committed in the dataset. This is the
 * *legacy* pipeline's result — the one produced with no output validation — so it
 * is the baseline every later prompt version is compared against.
 */
function runOffline(labels: GoldenLabel[], seed: SeedRow[]): CallOutcome[] {
  return labels.map((label): CallOutcome => {
    const row = seed.find((entry) => entry.call_id === label.call_id);
    if (!row) {
      return {
        callId: label.call_id,
        ok: false,
        error: `not present in ${PATHS.seedDataset}`,
        warnings: [],
        overallScores: [],
        dimensionScores: emptyDimensionScores(),
      };
    }

    const candidate = {
      extraction: row.extraction,
      quality_scores: row.quality_scores,
      last_stage_reached: row.last_stage_reached,
      recommended_next_action: row.recommended_next_action,
      summary: row.summary,
    };

    const strict = analysisSchema.safeParse(candidate);
    // A row that fails validation is counted as needing a repair, exactly as the
    // importer treats it — that is the cost of shipping without validation.
    const analysis = strict.success ? strict.data : repairLegacyAnalysis(row);
    const resolved = strict.success
      ? strict.data
      : 'ok' in analysis && analysis.ok
        ? analysis.analysis
        : undefined;

    if (!resolved) {
      return {
        callId: label.call_id,
        ok: false,
        error: 'unsalvageable analysis in seed data',
        warnings: [],
        overallScores: [],
        dimensionScores: emptyDimensionScores(),
      };
    }

    const dimensionScores = emptyDimensionScores();
    SCORE_DIMENSIONS.forEach((d) => dimensionScores[d].push(resolved.quality_scores[d].score));

    return {
      callId: label.call_id,
      ok: true,
      analysis: resolved,
      warnings: collectWarnings(resolved),
      repairsUsed: strict.success ? 0 : 1,
      overallScores: [overall(resolved)],
      dimensionScores,
    };
  });
}

/** Live run: call the model for each golden transcript, `repeats` times each. */
async function runLive(
  labels: GoldenLabel[],
  seed: SeedRow[],
  promptVersion: PromptVersion,
  repeats: number,
): Promise<CallOutcome[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'gsk_your_key_here') {
    throw new Error(
      'GROQ_API_KEY is not set. Add it to .env, or run `npm run eval -- --offline` to score the committed dataset without any API calls.',
    );
  }

  const client = new GroqClient({
    apiKey,
    model: process.env.LLM_MODEL ?? 'llama-3.1-8b-instant',
  });

  const outcomes: CallOutcome[] = [];

  for (const [index, label] of labels.entries()) {
    const row = seed.find((entry) => entry.call_id === label.call_id);
    if (!row) continue;

    const outcome: CallOutcome = {
      callId: label.call_id,
      ok: false,
      warnings: [],
      overallScores: [],
      dimensionScores: emptyDimensionScores(),
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      costUsd: 0,
      latencyMs: 0,
      repairsUsed: 0,
    };

    for (let repeat = 0; repeat < repeats; repeat += 1) {
      process.stdout.write(
        `\r${promptVersion}: call ${index + 1}/${labels.length} (run ${repeat + 1}/${repeats})   `,
      );

      const result = await safeAnalyzeTranscript(row.transcript, {
        client,
        promptVersion,
      });

      if (!result.ok) {
        outcome.error = result.error instanceof Error ? result.error.message : String(result.error);
        continue;
      }

      // The first successful run supplies the analysis that gets label-scored;
      // later runs only feed the consistency metric.
      if (!outcome.analysis) {
        outcome.ok = true;
        outcome.analysis = result.analysis;
        outcome.warnings = result.meta.warnings;
      }

      outcome.usage!.promptTokens += result.meta.usage.promptTokens;
      outcome.usage!.completionTokens += result.meta.usage.completionTokens;
      outcome.usage!.totalTokens += result.meta.usage.totalTokens;
      outcome.costUsd! += result.meta.costUsd;
      outcome.latencyMs! += result.meta.latencyMs;
      outcome.repairsUsed! += result.meta.repairsUsed;
      outcome.overallScores.push(overall(result.analysis));
      SCORE_DIMENSIONS.forEach((d) =>
        outcome.dimensionScores[d].push(result.analysis.quality_scores[d].score),
      );
    }

    outcomes.push(outcome);
  }

  process.stdout.write('\r'.padEnd(60) + '\r');
  return outcomes;
}

// --- Reporting --------------------------------------------------------------

function percent(part: number, whole: number): string {
  return whole === 0 ? 'n/a' : `${((part / whole) * 100).toFixed(1)}%`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function aggregateFieldAccuracy(report: RunReport): { matched: number; total: number } {
  return SCORED_FIELDS.reduce(
    (acc, field) => ({
      matched: acc.matched + report.fieldMatches[field].matched,
      total: acc.total + report.fieldMatches[field].total,
    }),
    { matched: 0, total: 0 },
  );
}

function printReport(report: RunReport): void {
  const aggregate = aggregateFieldAccuracy(report);

  console.log(`\n${report.label}`);
  console.log('='.repeat(64));
  console.log(`calls evaluated            ${report.calls}`);
  console.log(`pipeline failures          ${report.failures}`);
  console.log(
    `schema-valid first try     ${report.schemaValidFirstTry}/${report.calls}  (${percent(report.schemaValidFirstTry, report.calls)})`,
  );
  console.log(`repair round-trips used    ${report.repairsUsed}`);
  console.log(
    `summary exactly 2 sentences ${report.summaryTwoSentences.ok}/${report.summaryTwoSentences.total}  (${percent(report.summaryTwoSentences.ok, report.summaryTwoSentences.total)})`,
  );
  console.log(`soft-rule warnings         ${report.warnings}`);

  console.log('\nfield agreement with golden labels');
  for (const field of SCORED_FIELDS) {
    const { matched, total } = report.fieldMatches[field];
    const bar = '█'.repeat(Math.round((total === 0 ? 0 : matched / total) * 20)).padEnd(20, '·');
    console.log(
      `  ${field.padEnd(24)} ${bar} ${String(matched).padStart(2)}/${total}  ${percent(matched, total)}`,
    );
  }
  console.log(
    `  ${'AGGREGATE'.padEnd(24)} ${''.padEnd(20)} ${aggregate.matched}/${aggregate.total}  ${percent(aggregate.matched, aggregate.total)}`,
  );

  if (report.consistency) {
    console.log('\nscore stability across repeats');
    console.log(`  mean spread              ${report.consistency.meanSpread} / ${MAX_SCORE}`);
    console.log(`  worst spread             ${report.consistency.maxSpread} / ${MAX_SCORE}`);
  }

  if (report.usage.totalTokens > 0) {
    console.log('\ncost & latency');
    console.log(`  tokens                   ${report.usage.totalTokens.toLocaleString()}`);
    console.log(`  cost                     ${formatUsd(report.costUsd)}`);
    console.log(`  median latency           ${Math.round(median(report.latencies))} ms`);
  }

  if (report.mismatches.length > 0) {
    console.log(`\nmismatches (${report.mismatches.length})`);
    for (const miss of report.mismatches) {
      console.log(`  ${miss.callId} ${miss.field}`);
      console.log(`      expected ${miss.expected}`);
      console.log(`      actual   ${miss.actual}`);
    }
  }
  console.log('');
}

function toMarkdown(reports: RunReport[]): string {
  const header = `# Evaluation results

Generated by \`npm run eval\`. Golden set: ${reports[0]?.calls ?? 0} hand-labelled calls
(see [the golden-set notes](../backend/src/eval/README.md) for what is labelled and why
the 0-5 scores are not).

## Field agreement

| Field | ${reports.map((r) => r.label).join(' | ')} |
| --- | ${reports.map(() => '---').join(' | ')} |
${SCORED_FIELDS.map(
  (field) =>
    `| \`${field}\` | ${reports
      .map((r) => {
        const { matched, total } = r.fieldMatches[field];
        return `${percent(matched, total)} (${matched}/${total})`;
      })
      .join(' | ')} |`,
).join('\n')}
| **Aggregate** | ${reports
    .map((r) => {
      const aggregate = aggregateFieldAccuracy(r);
      return `**${percent(aggregate.matched, aggregate.total)}** (${aggregate.matched}/${aggregate.total})`;
    })
    .join(' | ')} |

## Pipeline health

| Metric | ${reports.map((r) => r.label).join(' | ')} |
| --- | ${reports.map(() => '---').join(' | ')} |
| Schema-valid first try | ${reports.map((r) => percent(r.schemaValidFirstTry, r.calls)).join(' | ')} |
| Repair round-trips | ${reports.map((r) => String(r.repairsUsed)).join(' | ')} |
| Summary exactly 2 sentences | ${reports.map((r) => percent(r.summaryTwoSentences.ok, r.summaryTwoSentences.total)).join(' | ')} |
| Soft-rule warnings | ${reports.map((r) => String(r.warnings)).join(' | ')} |
| Pipeline failures | ${reports.map((r) => String(r.failures)).join(' | ')} |
| Tokens | ${reports.map((r) => (r.usage.totalTokens === 0 ? 'not recorded' : r.usage.totalTokens.toLocaleString())).join(' | ')} |
| Cost | ${reports.map((r) => (r.costUsd === 0 ? 'n/a' : formatUsd(r.costUsd))).join(' | ')} |
| Median latency | ${reports.map((r) => (r.latencies.length === 0 ? 'n/a' : `${Math.round(median(r.latencies))} ms`)).join(' | ')} |
| Mean score spread on repeat | ${reports.map((r) => (r.consistency ? `${r.consistency.meanSpread} / ${MAX_SCORE}` : 'not measured')).join(' | ')} |

## Mismatches

${
  reports
    .map(
      (r) =>
        `### ${r.label}\n\n${
          r.mismatches.length === 0
            ? 'None.'
            : r.mismatches
                .map(
                  (m) =>
                    `- \`${m.callId}\` **${m.field}** — expected \`${m.expected}\`, got \`${m.actual}\``,
                )
                .join('\n')
        }`,
    )
    .join('\n\n') || 'None.'
}

## Reproducing

\`\`\`bash
npm run eval -- --offline --write        # score the committed dataset, no API calls
npm run eval -- --write                  # run the current prompt live (needs GROQ_API_KEY)
npm run eval -- --prompt v1,v2,v3,v4 --write   # compare prompt versions side by side
npm run eval -- --consistency 3          # re-run each call 3x, report score spread
\`\`\`

Columns appear only for runs that were actually executed. A live column requires
\`GROQ_API_KEY\`; the offline column needs nothing and is reproducible from the
committed data alone.
`;
  return header;
}

// --- Entry point ------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const seed = loadSeed();
  let labels = loadLabels();
  if (options.limit) labels = labels.slice(0, options.limit);

  const reports: RunReport[] = [];

  // The legacy baseline is always included: it costs nothing (it scores analyses
  // already committed to the dataset) and it is the only thing a live run is
  // meaningfully compared against. Without it, `--write` would replace the
  // results table with a single column and lose the comparison.
  reports.push(score('legacy dataset (no output validation)', labels, runOffline(labels, seed)));

  if (!options.offline) {
    for (const version of options.promptVersions) {
      const outcomes = await runLive(labels, seed, version, Math.max(1, options.consistency));
      reports.push(score(`prompt ${version} (live)`, labels, outcomes));
    }
  }

  reports.forEach(printReport);

  if (options.write) {
    mkdirSync(resolve('docs'), { recursive: true });
    const path = resolve(PATHS.evalResults);
    writeFileSync(path, toMarkdown(reports), 'utf8');
    console.log(`Wrote ${path}\n`);
  }
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
