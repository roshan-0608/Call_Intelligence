import {
  analysisSchema,
  type CallAnalysis,
  type PromptVersion,
  type RepairNoteDto,
} from '@call-intel/shared';
import {
  GroqClient,
  analysisCacheKey,
  analyzeTranscript,
  transcriptHash,
  type AnalysisMeta,
} from '@call-intel/shared/llm';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { prisma } from '../db/index.js';
import { ServiceUnavailableError, UpstreamError } from '../utils/ApiError.js';

/**
 * The analysis service: one place that turns a transcript into a validated
 * analysis, with a cache that survives restarts.
 *
 * The original cache was a `Map` keyed on the lowercased transcript. On a
 * free-tier host that sleeps between visits, that cache was almost always
 * empty, and because the key ignored the model and prompt version it would have
 * served stale analyses after any prompt change. This one is a database table
 * keyed on transcript hash + model + prompt version.
 */

export interface AnalyzeOutcome {
  analysis: CallAnalysis;
  meta: Pick<
    AnalysisMeta,
    'model' | 'promptVersion' | 'usage' | 'costUsd' | 'latencyMs' | 'warnings'
  >;
  cached: boolean;
  repairNotes: RepairNoteDto[];
}

let client: GroqClient | undefined;

/** Lazily constructed so the API boots and serves reads without a key. */
export function getLlmClient(): GroqClient {
  if (!env.GROQ_API_KEY) {
    throw new ServiceUnavailableError(
      'Transcript analysis is disabled because GROQ_API_KEY is not configured on the server. Browsing existing calls still works.',
      'llm_not_configured',
    );
  }

  client ??= new GroqClient({
    apiKey: env.GROQ_API_KEY,
    model: env.LLM_MODEL,
    onRetry: ({ attempt, delayMs, error }) =>
      logger.warn(
        { attempt, delayMs, err: error instanceof Error ? error.message : error },
        'retrying provider call',
      ),
  });

  return client;
}

/** Test seam: lets integration tests inject a stub client. */
export function setLlmClient(next: GroqClient | undefined): void {
  client = next;
}

export async function analyzeWithCache(transcript: string): Promise<AnalyzeOutcome> {
  const promptVersion = env.PROMPT_VERSION as PromptVersion;
  const model = env.LLM_MODEL;
  const temperature = 0.2;
  const key = analysisCacheKey({ transcript, model, promptVersion, temperature });

  const cached = await prisma.analysisCache.findUnique({ where: { key } });
  if (cached) {
    const parsed = analysisSchema.safeParse(safeJsonParse(cached.analysisJson));

    if (parsed.success) {
      await prisma.analysisCache.update({
        where: { key },
        data: { hitCount: { increment: 1 }, lastHitAt: new Date() },
      });
      logger.info({ key, hitCount: cached.hitCount + 1 }, 'analysis cache hit');

      return {
        analysis: parsed.data,
        meta: {
          model: cached.model,
          promptVersion: cached.promptVersion as PromptVersion,
          usage: {
            promptTokens: cached.promptTokens,
            completionTokens: cached.completionTokens,
            totalTokens: cached.promptTokens + cached.completionTokens,
          },
          // A cache hit costs nothing; the original spend is recorded on the row
          // that first paid for it.
          costUsd: 0,
          latencyMs: 0,
          warnings: [],
        },
        cached: true,
        repairNotes: [],
      };
    }

    // A cached row that no longer satisfies the schema means the contract moved
    // under us. Drop it and re-analyze rather than serve invalid data.
    logger.warn({ key }, 'cached analysis failed validation; evicting');
    await prisma.analysisCache.delete({ where: { key } });
  }

  const started = Date.now();
  try {
    const result = await analyzeTranscript(transcript, {
      client: getLlmClient(),
      promptVersion,
      model,
      temperature,
      onEvent: (event) => logger.debug({ event }, 'pipeline event'),
    });

    await prisma.analysisCache.upsert({
      where: { key },
      create: {
        key,
        transcriptHash: transcriptHash(transcript),
        model: result.meta.model,
        promptVersion: result.meta.promptVersion,
        analysisJson: JSON.stringify(result.analysis),
        promptTokens: result.meta.usage.promptTokens,
        completionTokens: result.meta.usage.completionTokens,
        costUsd: result.meta.costUsd,
      },
      update: { analysisJson: JSON.stringify(result.analysis) },
    });

    logger.info(
      {
        model: result.meta.model,
        promptVersion: result.meta.promptVersion,
        tokens: result.meta.usage.totalTokens,
        costUsd: result.meta.costUsd,
        latencyMs: result.meta.latencyMs,
        repairsUsed: result.meta.repairsUsed,
        warnings: result.meta.warnings,
      },
      'analysis complete',
    );

    return {
      analysis: result.analysis,
      meta: {
        model: result.meta.model,
        promptVersion: result.meta.promptVersion,
        usage: result.meta.usage,
        costUsd: result.meta.costUsd,
        latencyMs: result.meta.latencyMs,
        warnings: result.meta.warnings,
      },
      cached: false,
      repairNotes: [],
    };
  } catch (error) {
    if (error instanceof ServiceUnavailableError) throw error;
    logger.error({ err: error, elapsedMs: Date.now() - started }, 'analysis failed');
    throw new UpstreamError(describeFailure(error), error);
  }
}

/** Turns pipeline failures into messages a dashboard user can act on. */
function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'Analysis failed for an unknown reason';

  const code = (error as { code?: string }).code;
  switch (code) {
    case 'schema_validation':
      return 'The model returned data that did not match the required schema, even after a repair attempt. Try again, or check the transcript formatting.';
    case 'malformed_json':
      return 'The model did not return valid JSON. Try again.';
    case 'timeout':
      return 'The analysis provider timed out. Long transcripts take longer — try again.';
    case 'network':
      return 'Could not reach the analysis provider. Check the server network connection.';
    // HTTP failures are split by status: telling an operator with a bad key to
    // "try again shortly" sends them chasing a rate limit that does not exist.
    case 'http':
      return describeHttpFailure((error as { status?: number }).status);
    default:
      return 'Analysis failed. Try again shortly.';
  }
}

function describeHttpFailure(status: number | undefined): string {
  switch (status) {
    case 401:
    case 403:
      return 'The analysis provider rejected the API key. Check GROQ_API_KEY on the server.';
    case 404:
      return `The configured model "${env.LLM_MODEL}" was not found. Providers retire models; set LLM_MODEL to a current one.`;
    case 413:
      return 'The transcript was too large for the model context. Split the call and try again.';
    case 429:
      return 'Rate limit or quota reached on the analysis provider. Try again shortly.';
    default:
      return status && status >= 500
        ? 'The analysis provider is having problems. Try again shortly.'
        : 'The analysis provider rejected the request.';
  }
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
