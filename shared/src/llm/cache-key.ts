import { createHash } from 'node:crypto';
import type { PromptVersion } from '../prompts/types.js';

/**
 * Deterministic cache identity for one analysis.
 *
 * The original cache keyed on the lowercased transcript alone, so changing the
 * prompt or the model kept serving results produced by the old one — a cache
 * that silently pins you to a previous version of your own product. Model and
 * prompt version are part of the key here, which makes a prompt bump a cache
 * miss by construction.
 */

export interface CacheKeyInput {
  transcript: string;
  model: string;
  promptVersion: PromptVersion;
  temperature: number;
}

/** Collapses whitespace so cosmetic edits do not force a re-analysis. */
export function normalizeTranscript(transcript: string): string {
  return transcript
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n');
}

/** SHA-256 of the normalized transcript. Also the DB's content-dedupe column. */
export function transcriptHash(transcript: string): string {
  return createHash('sha256').update(normalizeTranscript(transcript), 'utf8').digest('hex');
}

export function analysisCacheKey(input: CacheKeyInput): string {
  return createHash('sha256')
    .update(
      [
        transcriptHash(input.transcript),
        input.model,
        input.promptVersion,
        input.temperature.toFixed(2),
      ].join('|'),
      'utf8',
    )
    .digest('hex');
}
