import type { z } from 'zod';
import { analysisSchema, type CallAnalysis } from '../schema.js';
import { countSentences } from '../analysis.js';
import {
  CURRENT_PROMPT_VERSION,
  buildRepairMessage,
  getPrompt,
  type PromptVersion,
} from '../prompts/index.js';
import { analysisCacheKey, transcriptHash } from './cache-key.js';
import type { ChatMessage, GroqClient } from './client.js';
import { LlmMalformedJsonError, LlmSchemaError } from './errors.js';
import { addUsage, emptyUsage, estimateCostUsd, type TokenUsage } from './cost.js';

/**
 * Transcript in, validated analysis out.
 *
 * Three properties the original pipeline lacked:
 *   1. Output is parsed *and* schema-validated before it can reach a database.
 *   2. A schema violation triggers one targeted repair attempt that shows the
 *      model its own validation errors, instead of a blind retry that tends to
 *      reproduce the same defect.
 *   3. Token usage, cost, latency and attempt counts come back with the result,
 *      so the eval harness and the API can report them.
 */

export interface AnalyzeOptions {
  client: GroqClient;
  promptVersion?: PromptVersion;
  model?: string;
  temperature?: number;
  timeoutMs?: number;
  /** Extra attempts allowed to fix schema violations. 0 disables repair. */
  repairAttempts?: number;
  signal?: AbortSignal;
  onEvent?: (event: PipelineEvent) => void;
}

export type PipelineEvent =
  | { type: 'request'; attempt: number; promptVersion: PromptVersion; model: string }
  | { type: 'repair'; attempt: number; issues: string[] }
  | { type: 'warning'; message: string };

export interface AnalysisMeta {
  model: string;
  promptVersion: PromptVersion;
  temperature: number;
  usage: TokenUsage;
  costUsd: number;
  latencyMs: number;
  /** LLM calls made, including repair attempts. */
  llmCalls: number;
  /** How many repair round-trips were needed (0 means valid first time). */
  repairsUsed: number;
  transcriptHash: string;
  cacheKey: string;
  /** Soft-rule violations that do not invalidate the analysis. */
  warnings: string[];
}

export interface AnalyzeResult {
  analysis: CallAnalysis;
  meta: AnalysisMeta;
}

export const DEFAULT_TEMPERATURE = 0.2;
export const DEFAULT_REPAIR_ATTEMPTS = 1;

export async function analyzeTranscript(
  transcript: string,
  options: AnalyzeOptions,
): Promise<AnalyzeResult> {
  const promptVersion = options.promptVersion ?? CURRENT_PROMPT_VERSION;
  const temperature = options.temperature ?? DEFAULT_TEMPERATURE;
  const repairBudget = options.repairAttempts ?? DEFAULT_REPAIR_ATTEMPTS;
  const prompt = getPrompt(promptVersion);
  const built = prompt.build(transcript);

  const messages: ChatMessage[] = [
    ...(built.system ? [{ role: 'system' as const, content: built.system }] : []),
    { role: 'user' as const, content: built.user },
  ];

  let usage = emptyUsage();
  let latencyMs = 0;
  let llmCalls = 0;
  let model = options.model ?? '';
  let lastError: LlmMalformedJsonError | LlmSchemaError | undefined;

  for (let repairsUsed = 0; repairsUsed <= repairBudget; repairsUsed += 1) {
    options.onEvent?.({
      type: 'request',
      attempt: repairsUsed + 1,
      promptVersion,
      model: options.model ?? 'default',
    });

    const response = await options.client.chat({
      messages,
      ...(options.model ? { model: options.model } : {}),
      temperature,
      jsonMode: prompt.jsonMode,
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    usage = addUsage(usage, response.usage);
    latencyMs += response.latencyMs;
    llmCalls += response.attempts;
    model = response.model;

    const parsed = parseAnalysis(response.text);

    if (parsed.ok) {
      const warnings = collectWarnings(parsed.analysis);
      warnings.forEach((message) => options.onEvent?.({ type: 'warning', message }));

      return {
        analysis: parsed.analysis,
        meta: {
          model,
          promptVersion,
          temperature,
          usage,
          costUsd: estimateCostUsd(model, usage),
          latencyMs,
          llmCalls,
          repairsUsed,
          transcriptHash: transcriptHash(transcript),
          cacheKey: analysisCacheKey({ transcript, model, promptVersion, temperature }),
          warnings,
        },
      };
    }

    lastError = parsed.error;

    if (repairsUsed === repairBudget) break;

    const issues =
      parsed.error instanceof LlmSchemaError
        ? parsed.error.issues
        : ['Response was not valid JSON.'];

    options.onEvent?.({ type: 'repair', attempt: repairsUsed + 1, issues });

    messages.push(
      { role: 'assistant', content: response.text },
      { role: 'user', content: buildRepairMessage(response.text, issues) },
    );
  }

  throw lastError ?? new LlmMalformedJsonError('');
}

/** Non-throwing wrapper for batch jobs that must keep going past failures. */
export type SafeAnalyzeResult =
  ({ ok: true } & AnalyzeResult) | { ok: false; error: unknown; transcriptHash: string };

export async function safeAnalyzeTranscript(
  transcript: string,
  options: AnalyzeOptions,
): Promise<SafeAnalyzeResult> {
  try {
    const result = await analyzeTranscript(transcript, options);
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error, transcriptHash: transcriptHash(transcript) };
  }
}

// --- Parsing ----------------------------------------------------------------

type ParseOutcome =
  | { ok: true; analysis: CallAnalysis }
  | { ok: false; error: LlmMalformedJsonError | LlmSchemaError };

export function parseAnalysis(raw: string): ParseOutcome {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonObject(raw));
  } catch (error) {
    return { ok: false, error: new LlmMalformedJsonError(raw, error) };
  }

  const validated = analysisSchema.safeParse(json);
  if (!validated.success) {
    return { ok: false, error: new LlmSchemaError(formatZodIssues(validated.error), raw) };
  }
  return { ok: true, analysis: validated.data };
}

/**
 * Defensive extraction. With `response_format: json_object` the body is already
 * bare JSON, so this is a fallback for models or prompt versions that ignore it
 * (v1 and v2 do) rather than the primary path the old regex-strip had to be.
 */
export function extractJsonObject(raw: string): string {
  const withoutFences = raw
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();

  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return withoutFences;
  return withoutFences.slice(start, end + 1);
}

export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.') || '(root)';
    return `${path}: ${issue.message}`;
  });
}

/**
 * Rules the schema cannot express as types. Violations are reported, not
 * rejected: a three-sentence summary is worth flagging but not worth spending
 * another API call on.
 */
export function collectWarnings(analysis: CallAnalysis): string[] {
  const warnings: string[] = [];

  const sentences = countSentences(analysis.summary);
  if (sentences !== 2) {
    warnings.push(`summary has ${sentences} sentence(s); the prompt requires exactly 2`);
  }

  if (
    analysis.extraction.site_visit_outcome === 'not_asked' &&
    analysis.recommended_next_action === 'confirm_site_visit'
  ) {
    warnings.push('recommends confirming a site visit that was never asked for');
  }

  if (
    analysis.last_stage_reached === 'next_step_confirmed' &&
    analysis.quality_scores.next_step.score <= 1
  ) {
    warnings.push('stage says a next step was confirmed but next_step scored <= 1');
  }

  return warnings;
}
