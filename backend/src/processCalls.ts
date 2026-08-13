/**
 * Batch analysis.
 *
 *   npm run process-calls                    analyze the raw JSONL into the seed dataset
 *   npm run process-calls -- --repair        re-analyze only the rows that fail validation
 *   npm run process-calls -- --limit 10      first N rows only (a cheap smoke test)
 *   npm run process-calls -- --concurrency 2 parallel requests (default 1)
 *
 * Differences from the original runner:
 *   - retries live in one place (the client), not in two nested loops
 *   - progress is written incrementally, so an interrupted run is resumable
 *   - a row that fails is recorded in a failures file instead of vanishing
 *   - tokens, cost and latency are recorded per call
 *   - `--repair` re-analyzes only rows the schema rejects, which is 19 calls
 *     rather than 150
 */
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import {
  analysisSchema,
  callMetadataSchema,
  isPromptVersion,
  type CallAnalysis,
  type CallRecord,
  type PromptVersion,
} from '@call-intel/shared';
import {
  GroqClient,
  formatUsd,
  safeAnalyzeTranscript,
  type TokenUsage,
} from '@call-intel/shared/llm';
import { PATHS } from './constants.js';

const INPUT_PATH = resolve(PATHS.rawTranscripts);
const OUTPUT_PATH = resolve(PATHS.seedDataset);
const FAILURES_PATH = resolve(PATHS.failures);

interface Options {
  repair: boolean;
  limit: number | undefined;
  concurrency: number;
  promptVersion: PromptVersion | undefined;
}

function parseArgs(argv: string[]): Options {
  const valueOf = (flag: string) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const promptArg = valueOf('--prompt');
  const limitArg = valueOf('--limit');

  return {
    repair: argv.includes('--repair'),
    limit: limitArg ? Number(limitArg) : undefined,
    concurrency: Math.max(1, Number(valueOf('--concurrency') ?? 1)),
    promptVersion: promptArg && isPromptVersion(promptArg) ? promptArg : undefined,
  };
}

function buildClient(): GroqClient {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'gsk_your_key_here') {
    throw new Error(
      'GROQ_API_KEY is not set. Copy .env.example to .env and add your key from https://console.groq.com/keys',
    );
  }
  return new GroqClient({
    apiKey,
    ...(process.env.LLM_MODEL ? { model: process.env.LLM_MODEL } : {}),
    onRetry: ({ attempt, delayMs }) =>
      console.log(`   retrying (attempt ${attempt}) in ${Math.round(delayMs / 1000)}s`),
  });
}

/** One transcript plus whatever metadata came with it. */
interface Job {
  metadata: ReturnType<typeof callMetadataSchema.parse>;
}

async function readJsonl(): Promise<Job[]> {
  if (!existsSync(INPUT_PATH)) {
    throw new Error(
      `${INPUT_PATH} not found. It holds the raw transcripts and is gitignored (not redistributable). ` +
        'To re-analyze the committed dataset instead, run: npm run process-calls -- --repair',
    );
  }

  const jobs: Job[] = [];
  const reader = createInterface({
    input: createReadStream(INPUT_PATH),
    crlfDelay: Infinity,
  });

  let lineNumber = 0;
  for await (const line of reader) {
    lineNumber += 1;
    if (!line.trim()) continue;
    try {
      jobs.push({ metadata: callMetadataSchema.parse(JSON.parse(line)) });
    } catch (error) {
      console.warn(
        `  line ${lineNumber}: skipped (${error instanceof Error ? error.message.split('\n')[0] : 'unparseable'})`,
      );
    }
  }
  return jobs;
}

/** Repair mode: rows in the committed dataset that the schema rejects. */
function readInvalidFromSeed(): Job[] {
  const rows = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8')) as Array<Record<string, unknown>>;

  return rows
    .filter(
      (row) =>
        !analysisSchema.safeParse({
          extraction: row.extraction,
          quality_scores: row.quality_scores,
          last_stage_reached: row.last_stage_reached,
          recommended_next_action: row.recommended_next_action,
          summary: row.summary,
        }).success,
    )
    .map((row) => ({ metadata: callMetadataSchema.parse(row) }));
}

interface Totals {
  usage: TokenUsage;
  costUsd: number;
  llmCalls: number;
  repairsUsed: number;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const client = buildClient();

  let jobs = options.repair ? readInvalidFromSeed() : await readJsonl();
  if (options.limit) jobs = jobs.slice(0, options.limit);

  if (jobs.length === 0) {
    console.log(
      options.repair
        ? '\nNothing to repair: every row in the dataset already validates.\n'
        : '\nNo transcripts found to process.\n',
    );
    return;
  }

  console.log(
    `\n${options.repair ? 'Repairing' : 'Processing'} ${jobs.length} call(s) with concurrency ${options.concurrency}\n`,
  );

  // Existing rows are kept and overwritten by call_id, so a repair run updates
  // in place and an interrupted full run can be resumed.
  const existing: Map<string, CallRecord> = existsSync(OUTPUT_PATH)
    ? new Map(
        (JSON.parse(readFileSync(OUTPUT_PATH, 'utf8')) as CallRecord[]).map((row) => [
          row.call_id,
          row,
        ]),
      )
    : new Map();

  const failures: Array<{ call_id: string; error: string }> = [];
  const totals: Totals = {
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    costUsd: 0,
    llmCalls: 0,
    repairsUsed: 0,
  };

  let completed = 0;
  const queue = [...jobs];

  async function worker(): Promise<void> {
    for (;;) {
      const job = queue.shift();
      if (!job) return;

      const { metadata } = job;
      const result = await safeAnalyzeTranscript(metadata.transcript, {
        client,
        ...(options.promptVersion ? { promptVersion: options.promptVersion } : {}),
      });

      completed += 1;
      const progress = `[${completed}/${jobs.length}] ${metadata.call_id}`;

      if (!result.ok) {
        const message = result.error instanceof Error ? result.error.message : String(result.error);
        failures.push({ call_id: metadata.call_id, error: message });
        console.log(`${progress}  FAILED — ${message.split('\n')[0]}`);
        continue;
      }

      totals.usage.promptTokens += result.meta.usage.promptTokens;
      totals.usage.completionTokens += result.meta.usage.completionTokens;
      totals.usage.totalTokens += result.meta.usage.totalTokens;
      totals.costUsd += result.meta.costUsd;
      totals.llmCalls += result.meta.llmCalls;
      totals.repairsUsed += result.meta.repairsUsed;

      existing.set(metadata.call_id, buildRecord(metadata, result.analysis));

      const flags = [
        result.meta.repairsUsed > 0 ? `repaired x${result.meta.repairsUsed}` : '',
        ...result.meta.warnings,
      ].filter(Boolean);

      console.log(
        `${progress}  ok  ${result.meta.usage.totalTokens} tok  ${result.meta.latencyMs}ms${
          flags.length > 0 ? `  (${flags.join('; ')})` : ''
        }`,
      );

      // Written after every call: an interrupted run keeps its work.
      writeFileSync(OUTPUT_PATH, `${JSON.stringify([...existing.values()], null, 2)}\n`, 'utf8');
    }
  }

  await Promise.all(Array.from({ length: options.concurrency }, () => worker()));

  if (failures.length > 0) {
    writeFileSync(FAILURES_PATH, `${JSON.stringify(failures, null, 2)}\n`, 'utf8');
  }

  console.log('\nDone');
  console.log('='.repeat(52));
  console.log(`analyzed          ${jobs.length - failures.length}/${jobs.length}`);
  console.log(
    `failed            ${failures.length}${failures.length > 0 ? ` (see ${FAILURES_PATH})` : ''}`,
  );
  console.log(`llm calls         ${totals.llmCalls}`);
  console.log(`repair round-trips${' '.repeat(1)}${totals.repairsUsed}`);
  console.log(`tokens            ${totals.usage.totalTokens.toLocaleString()}`);
  console.log(`cost              ${formatUsd(totals.costUsd)}`);
  console.log(`output            ${OUTPUT_PATH}`);
  console.log('\nNext: npm run validate:dataset && npm run db:seed\n');
}

function buildRecord(
  metadata: ReturnType<typeof callMetadataSchema.parse>,
  analysis: CallAnalysis,
): CallRecord {
  return {
    call_id: metadata.call_id,
    telecaller_name: metadata.telecaller_name,
    lead_name: metadata.lead_name,
    timestamp: metadata.timestamp,
    duration_sec: metadata.duration_sec,
    transcript: metadata.transcript,
    ...analysis,
  };
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
