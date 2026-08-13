import { analysisJsonSpec } from '../schema.js';
import type { PromptTemplate } from './types.js';

/**
 * v2 — schema added, rubric still missing.
 *
 * Reconstructed from docs/ai-usage.md ("Added JSON schema → better but
 * inconsistent"). Field names and enums are now pinned, which fixes structural
 * drift, but with no scoring anchors the scores move between runs and the model
 * still occasionally answers an enum field with several options joined by `|` —
 * the exact defect that put 12 bad rows into the v1 dataset.
 */
export const promptV2: PromptTemplate = {
  version: 'v2',
  description: 'JSON schema pinned, no scoring rubric or edge-case rules',
  jsonMode: false,
  build(transcript) {
    return {
      user: `You are analyzing Tamil-English real estate sales calls. Extract structured data and score the agent's performance.

Return JSON in exactly this shape:
${analysisJsonSpec()}

Rules:
- Return only JSON, no explanation.
- Do not use null. Use "not_discussed", [] or "unclear" instead.

Transcript:
${transcript}`,
    };
  },
};
