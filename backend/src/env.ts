import { z } from 'zod';
import { CURRENT_PROMPT_VERSION, isPromptVersion, type PromptVersion } from '@call-intel/shared';

/**
 * Validated configuration.
 *
 * The server refuses to start on bad config rather than failing later on the
 * first request — the original build read `process.env.GROQ_API_KEY` at module
 * load and, when it was missing, produced a 500 from the provider on every
 * upload with no hint as to why.
 *
 * `GROQ_API_KEY` is deliberately optional: the dashboard is fully usable
 * read-only without a key, and the upload route returns a clear 503 instead of
 * the whole app refusing to boot.
 */

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(5000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /**
   * Required, with no default: the app runs on PostgreSQL, and silently falling
   * back to a local SQLite file would let a misconfigured deploy come up
   * "healthy" while serving an empty database.
   */
  DATABASE_URL: z.string().min(1),

  /**
   * Treated as unset when empty or when it still holds the placeholder from
   * .env.example. Without the placeholder check the server reports uploads as
   * "configured" and every attempt fails with a 401 that looks like a provider
   * outage; without the empty check, a deploy platform that exports unset
   * variables as `""` would fail startup validation outright.
   */
  GROQ_API_KEY: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value.trim() === '' || value === 'gsk_your_key_here'
        ? undefined
        : value,
    ),
  LLM_MODEL: z.string().min(1).default('llama-3.1-8b-instant'),
  PROMPT_VERSION: z
    .string()
    .default(CURRENT_PROMPT_VERSION)
    .refine(isPromptVersion, { message: 'must be one of v1, v2, v3, v4' })
    .transform((value) => value as PromptVersion),

  /** Comma-separated allowlist. `*` disables the origin check (dev only). */
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  UPLOAD_RATE_LIMIT_PER_HOUR: z.coerce.number().int().min(1).default(10),
  MAX_TRANSCRIPT_CHARS: z.coerce.number().int().min(100).max(200_000).default(20_000),

  /** Max page size the API will serve, to bound response cost. */
  MAX_PAGE_SIZE: z.coerce.number().int().min(1).max(500).default(100),

  /**
   * Whether this process also serves the built dashboard.
   *
   * `auto` (the default) serves it in production when `frontend/dist` exists —
   * true for a single-service deploy, false in development where Vite serves it
   * and proxies `/api` to the root. `on` forces it, `off` forces the API-only
   * shape used by the split Render + Vercel deploy.
   *
   * This is not cosmetic: when the dashboard is served from the same origin, the
   * API moves under `/api` so that the SPA owns `/calls/:id`. Otherwise a browser
   * deep link to a call renders raw JSON.
   */
  SERVE_WEB: z.enum(['auto', 'on', 'off']).default('auto'),
});

export type Env = z.infer<typeof envSchema> & {
  isProduction: boolean;
  isTest: boolean;
  corsOrigins: string[] | '*';
};

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration:\n${formatIssues(parsed.error)}\n\n` +
        'Copy .env.example to .env and fill in the values.',
    );
  }

  const value = parsed.data;
  const trimmed = value.CORS_ORIGINS.trim();

  return {
    ...value,
    isProduction: value.NODE_ENV === 'production',
    isTest: value.NODE_ENV === 'test',
    corsOrigins:
      trimmed === '*'
        ? '*'
        : trimmed
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean),
  };
}

export const env = loadEnv();
