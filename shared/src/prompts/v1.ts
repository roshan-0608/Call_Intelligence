import type { PromptTemplate } from './types.js';

/**
 * v1 — the first prompt: a plain instruction with no schema and no rubric.
 *
 * Reconstructed from docs/ai-usage.md ("Initial → wrong output format") so the
 * eval harness can measure the improvement rather than assert it. Kept
 * deliberately naive: no output contract, no enum list, no scoring anchors.
 * Its failure modes are prose wrappers, markdown fences, invented field names,
 * and free-text values where an enum is expected.
 */
export const promptV1: PromptTemplate = {
  version: 'v1',
  description: 'Naive instruction, no schema, no rubric (baseline)',
  jsonMode: false,
  build(transcript) {
    return {
      user: `You are analyzing a real estate sales call between a telecaller (Agent) and a customer (Lead). The call is in a mix of Tamil and English.

Read the transcript and tell me:
- what unit configuration the lead wants
- their budget
- their timeline to buy
- which locations they prefer
- whether a site visit was agreed
- how well the agent did on discovery, pitch, objection handling, and setting up a next step (score each out of 5, with a reason)
- how far the call progressed
- what the agent should do next
- a short summary

Return the result as JSON.

Transcript:
${transcript}`,
    };
  },
};
