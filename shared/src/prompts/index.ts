import { promptV1 } from './v1.js';
import { promptV2 } from './v2.js';
import { promptV3 } from './v3.js';
import { promptV4 } from './v4.js';
import type { PromptTemplate, PromptVersion } from './types.js';

export type { PromptMessages, PromptTemplate, PromptVersion } from './types.js';
export { promptV1, promptV2, promptV3, promptV4 };

export const PROMPTS: Record<PromptVersion, PromptTemplate> = {
  v1: promptV1,
  v2: promptV2,
  v3: promptV3,
  v4: promptV4,
};

/** The version the pipeline runs unless overridden by PROMPT_VERSION. */
export const CURRENT_PROMPT_VERSION: PromptVersion = 'v4';

export function isPromptVersion(value: string): value is PromptVersion {
  return value in PROMPTS;
}

export function getPrompt(version: PromptVersion = CURRENT_PROMPT_VERSION): PromptTemplate {
  return PROMPTS[version];
}

/**
 * Follow-up message used when the model returns JSON that parses but fails
 * schema validation. Feeding the validator's own error paths back is far more
 * effective than a blind retry, which tends to reproduce the same defect.
 */
export function buildRepairMessage(rawResponse: string, issues: string[]): string {
  return `Your previous response failed schema validation.

Problems found:
${issues.map((issue) => `- ${issue}`).join('\n')}

Your previous response was:
${rawResponse.slice(0, 4000)}

Return the corrected JSON object only. Fix exactly the problems listed above and change nothing else. Remember: every enum field takes exactly one verbatim value from its allowed list.`;
}
