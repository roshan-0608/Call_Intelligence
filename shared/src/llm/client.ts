import {
  LlmConfigError,
  LlmEmptyResponseError,
  LlmHttpError,
  LlmNetworkError,
  LlmTimeoutError,
} from './errors.js';
import { DEFAULT_RETRY, withRetry } from './retry.js';
import { estimateCostUsd, type TokenUsage } from './cost.js';

/**
 * Minimal client for Groq's OpenAI-compatible chat completions endpoint.
 *
 * Uses `fetch` rather than axios (one less dependency, and native abort
 * support), asks for `response_format: json_object` so responses never arrive
 * wrapped in markdown fences, and surfaces the `usage` block to the caller.
 */

export const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
export const DEFAULT_MODEL = 'llama-3.1-8b-instant';
export const DEFAULT_TIMEOUT_MS = 45_000;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Request a JSON object response. Requires a model that supports it. */
  jsonMode?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Overrides the client's retry policy for this call. */
  attempts?: number;
}

export interface ChatResponse {
  text: string;
  model: string;
  usage: TokenUsage;
  costUsd: number;
  finishReason: string | null;
  latencyMs: number;
  /** Number of HTTP attempts made, including the successful one. */
  attempts: number;
}

export interface RetryLogEvent {
  attempt: number;
  delayMs: number;
  error: unknown;
}

export interface GroqClientOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (event: RetryLogEvent) => void;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface CompletionPayload {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  model?: string;
}

export class GroqClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;
  private readonly attempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly onRetry: ((event: RetryLogEvent) => void) | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: ((ms: number) => Promise<void>) | undefined;
  private readonly now: () => number;

  constructor(options: GroqClientOptions) {
    if (!options.apiKey) {
      throw new LlmConfigError(
        'GROQ_API_KEY is not set. Copy .env.example to .env and add your key from https://console.groq.com/keys',
      );
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.defaultModel = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.attempts = options.attempts ?? DEFAULT_RETRY.attempts;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs;
    this.onRetry = options.onRetry;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.sleep = options.sleep;
    this.now = options.now ?? (() => Date.now());
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const model = request.model ?? this.defaultModel;
    const timeoutMs = request.timeoutMs ?? this.timeoutMs;
    const startedAt = this.now();
    let attemptsMade = 0;

    const payload = await withRetry(
      async (attempt) => {
        attemptsMade = attempt;
        return this.postCompletion({ ...request, model }, timeoutMs);
      },
      {
        attempts: request.attempts ?? this.attempts,
        baseDelayMs: this.baseDelayMs,
        maxDelayMs: this.maxDelayMs,
        ...(this.onRetry ? { onRetry: this.onRetry } : {}),
        ...(this.sleep ? { sleep: this.sleep } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
      },
    );

    const choice = payload.choices?.[0];
    const text = choice?.message?.content?.trim();
    if (!text) throw new LlmEmptyResponseError();

    const usage: TokenUsage = {
      promptTokens: payload.usage?.prompt_tokens ?? 0,
      completionTokens: payload.usage?.completion_tokens ?? 0,
      totalTokens: payload.usage?.total_tokens ?? 0,
    };

    return {
      text,
      model: payload.model ?? model,
      usage,
      costUsd: estimateCostUsd(model, usage),
      finishReason: choice?.finish_reason ?? null,
      latencyMs: this.now() - startedAt,
      attempts: attemptsMade,
    };
  }

  private async postCompletion(
    request: ChatRequest & { model: string },
    timeoutMs: number,
  ): Promise<CompletionPayload> {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = request.signal
      ? AbortSignal.any([timeoutSignal, request.signal])
      : timeoutSignal;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature ?? 0.2,
          ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
          ...(request.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal,
      });
    } catch (error) {
      if (timeoutSignal.aborted) throw new LlmTimeoutError(timeoutMs);
      if (request.signal?.aborted) throw error;
      throw new LlmNetworkError(error);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new LlmHttpError(response.status, body, parseRetryAfter(response.headers));
    }

    try {
      return (await response.json()) as CompletionPayload;
    } catch (error) {
      throw new LlmNetworkError(error);
    }
  }
}

/** `Retry-After` may be seconds or an HTTP date; both are accepted. */
export function parseRetryAfter(headers: Headers): number | undefined {
  const header = headers.get('retry-after');
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());

  return undefined;
}
