import {
  analyticsSchema,
  apiEnvelopeSchema,
  apiErrorSchema,
  callDetailSchema,
  callSummarySchema,
  leaderboardEntrySchema,
  paginatedSchema,
  uploadResponseSchema,
  type Analytics,
  type CallDetail,
  type CallListQuery,
  type CallSummary,
  type LeaderboardEntry,
  type Paginated,
  type UploadRequest,
  type UploadResponse,
} from '@call-intel/shared';
import { z } from 'zod';

/**
 * All backend API calls.
 *
 * Every response is parsed with the same Zod schemas the server validates
 * against, wrapped in `apiResponseSchema` — so the `{ success, statusCode,
 * message, data }` envelope is unwrapped in exactly one place, and a contract
 * drift surfaces here as a clear error instead of `undefined` rendered into the
 * page. The original app read `res.data` untyped and guarded every field access
 * with `?.` to survive the consequences.
 */

const BASE_URL = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '');

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors: Array<{ path: string; message: string }>;
  readonly requestId: string | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    errors: Array<{ path: string; message: string }> = [],
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.errors = errors;
    this.requestId = requestId;
  }

  /** True when retrying could plausibly succeed (cold start, rate limit, 5xx). */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500 || this.status === 0;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
  /** Free-tier hosts sleep; the first request can take most of a minute. */
  timeoutMs?: number;
}

/**
 * Performs the request, validates the envelope, and returns the unwrapped
 * payload. `dataSchema` describes what sits under `data`.
 */
async function request<T extends z.ZodTypeAny>(
  path: string,
  dataSchema: T,
  options: RequestOptions = {},
): Promise<z.infer<T>> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal,
    });
  } catch (error) {
    if (timeoutSignal.aborted) {
      throw new ApiRequestError(
        0,
        'timeout',
        `The API did not respond within ${Math.round(timeoutMs / 1000)}s. If it is hosted on a free tier it may be waking up — try again.`,
      );
    }
    if (options.signal?.aborted) throw error;
    throw new ApiRequestError(0, 'network_error', 'Could not reach the API.');
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    if (parsed.success) {
      throw new ApiRequestError(
        parsed.data.statusCode,
        parsed.data.code,
        parsed.data.message,
        parsed.data.errors ?? [],
        parsed.data.requestId,
      );
    }
    throw new ApiRequestError(response.status, 'http_error', `Request failed (${response.status})`);
  }

  // Two steps, both fully typed: check the envelope, then parse the payload with
  // the endpoint's own schema. Parsing through the generic `apiResponseSchema`
  // would yield a mapped type whose `.data` TypeScript cannot see.
  const envelope = apiEnvelopeSchema.parse(payload);
  return dataSchema.parse(envelope.data);
}

/** Serializes only the parameters that are set, so URLs stay readable. */
export function buildCallQuery(query: Partial<CallListQuery>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === '' || value === null) return;
    params.set(key, String(value));
  });
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

const paginatedCallSummary = paginatedSchema(callSummarySchema);
const leaderboardPayload = z.object({
  data: z.array(leaderboardEntrySchema),
  dimensions: z.array(z.object({ key: z.string(), label: z.string() })),
});

/** Readiness is a flat probe response, deliberately outside the envelope. */
const readinessSchema = z.object({
  status: z.string(),
  checks: z.object({ database: z.string(), llm: z.string() }),
});

export const api = {
  listCalls(query: Partial<CallListQuery>, signal?: AbortSignal): Promise<Paginated<CallSummary>> {
    return request(
      `/calls${buildCallQuery(query)}`,
      paginatedCallSummary,
      signal ? { signal } : {},
    );
  },

  getCall(id: string, signal?: AbortSignal): Promise<CallDetail> {
    return request(`/calls/${encodeURIComponent(id)}`, callDetailSchema, signal ? { signal } : {});
  },

  async getLeaderboard(signal?: AbortSignal): Promise<LeaderboardEntry[]> {
    const payload = await request('/leaderboard', leaderboardPayload, signal ? { signal } : {});
    return payload.data;
  },

  getAnalytics(signal?: AbortSignal): Promise<Analytics> {
    return request('/analytics', analyticsSchema, signal ? { signal } : {});
  },

  /**
   * Wakes a sleeping free-tier host and reports whether uploads are enabled.
   *
   * Health endpoints are not wrapped in the envelope — platform probes expect a
   * flat body — so this one bypasses `request()` and parses directly.
   */
  async getReadiness(signal?: AbortSignal): Promise<z.infer<typeof readinessSchema>> {
    const response = await fetch(`${BASE_URL}/health/ready`, {
      signal: signal ?? AbortSignal.timeout(90_000),
    });
    if (!response.ok && response.status !== 503) {
      throw new ApiRequestError(response.status, 'http_error', 'Readiness check failed');
    }
    return readinessSchema.parse(await response.json());
  },

  uploadTranscript(body: UploadRequest, signal?: AbortSignal): Promise<UploadResponse> {
    return request('/upload', uploadResponseSchema, {
      method: 'POST',
      body,
      // An uncached analysis is a live model call plus a possible repair round.
      timeoutMs: 120_000,
      ...(signal ? { signal } : {}),
    });
  },
};
