/**
 * Isomorphic entry point: schema, derived helpers and display labels only.
 *
 * Node-only code (the LLM client, hashing) lives behind `@call-intel/shared/llm`
 * so the browser bundle never pulls in `node:crypto`.
 */
export * from './analysis.js';
export * from './api.js';
export * from './legacy.js';
export * from './schema.js';
export {
  CURRENT_PROMPT_VERSION,
  PROMPTS,
  getPrompt,
  isPromptVersion,
  type PromptTemplate,
  type PromptVersion,
} from './prompts/index.js';
