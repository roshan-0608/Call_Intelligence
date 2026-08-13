/**
 * Token and cost accounting.
 *
 * The provider returns a `usage` block on every completion; the original
 * pipeline discarded it, so the project could describe itself as "within the
 * free tier" without being able to show a number. Rates are USD per million
 * tokens and are configuration, not truth — verify against
 * https://console.groq.com and update `MODEL_PRICING` when they change.
 */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputPerMillion: number;
  /** USD per 1M output tokens. */
  outputPerMillion: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'llama-3.1-8b-instant': { inputPerMillion: 0.05, outputPerMillion: 0.08 },
  'llama-3.3-70b-versatile': { inputPerMillion: 0.59, outputPerMillion: 0.79 },
  'openai/gpt-oss-20b': { inputPerMillion: 0.1, outputPerMillion: 0.5 },
  'openai/gpt-oss-120b': { inputPerMillion: 0.15, outputPerMillion: 0.75 },
};

/** Used when a model has no pricing entry, so totals stay defined. */
export const UNKNOWN_MODEL_PRICING: ModelPricing = {
  inputPerMillion: 0,
  outputPerMillion: 0,
};

export function pricingFor(model: string): ModelPricing {
  return MODEL_PRICING[model] ?? UNKNOWN_MODEL_PRICING;
}

export function hasPricing(model: string): boolean {
  return model in MODEL_PRICING;
}

/** Cost in USD for one completion. */
export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const pricing = pricingFor(model);
  const input = (usage.promptTokens / 1_000_000) * pricing.inputPerMillion;
  const output = (usage.completionTokens / 1_000_000) * pricing.outputPerMillion;
  return input + output;
}

export function emptyUsage(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

export function sumUsage(usages: readonly TokenUsage[]): TokenUsage {
  return usages.reduce(addUsage, emptyUsage());
}

/** Formats small dollar amounts without collapsing to `$0.00`. */
export function formatUsd(amount: number): string {
  if (amount === 0) return '$0';
  if (amount < 0.01) return `$${amount.toFixed(6)}`;
  return `$${amount.toFixed(4)}`;
}
