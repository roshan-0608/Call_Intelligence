import { describe, expect, it, vi } from 'vitest';
import { countSentences, overallScore, scoreBand } from '@call-intel/shared';
import {
  GroqClient,
  LlmHttpError,
  LlmSchemaError,
  analysisCacheKey,
  analyzeTranscript,
  collectWarnings,
  estimateCostUsd,
  extractJsonObject,
  normalizeTranscript,
  parseAnalysis,
  transcriptHash,
} from '@call-intel/shared/llm';

const VALID_ANALYSIS = {
  extraction: {
    unit_configuration: '2BHK',
    budget_range: { min_lakhs: 40, max_lakhs: 50 },
    timeline: 'immediate',
    preferred_locations: ['Velachery'],
    site_visit_outcome: 'committed_with_date',
  },
  quality_scores: {
    discovery: { score: 4, reason: 'Asked budget, timeline and location.' },
    pitch: { score: 3, reason: 'Covered price and location.' },
    objection_handling: { score: 2, reason: 'Deflected the price objection.' },
    next_step: { score: 5, reason: 'Visit fixed for Saturday.' },
  },
  last_stage_reached: 'next_step_confirmed',
  recommended_next_action: 'confirm_site_visit',
  summary: 'Discussed a 2BHK in Velachery at 40-50 lakhs. Visit confirmed for Saturday 10am.',
};

/** Minimal stand-in for the provider's chat-completions response. */
function completion(content: unknown, usage = { prompt: 900, completion: 200 }) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({
      model: 'llama-3.1-8b-instant',
      choices: [
        {
          message: { content: typeof content === 'string' ? content : JSON.stringify(content) },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: usage.prompt,
        completion_tokens: usage.completion,
        total_tokens: usage.prompt + usage.completion,
      },
    }),
    text: async () => '',
  } as unknown as Response;
}

function errorResponse(status: number, body = 'nope') {
  return {
    ok: false,
    status,
    headers: new Headers(),
    text: async () => body,
    json: async () => ({}),
  } as unknown as Response;
}

function clientWith(fetchImpl: typeof fetch) {
  return new GroqClient({ apiKey: 'gsk_test', fetchImpl, sleep: () => Promise.resolve() });
}

describe('extractJsonObject', () => {
  it('passes bare JSON through untouched', () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it('strips markdown fences, which v1 and v2 prompts still produce', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('discards prose around the object', () => {
    expect(extractJsonObject('Sure! Here you go:\n{"a":1}\nHope that helps.')).toBe('{"a":1}');
  });
});

describe('parseAnalysis', () => {
  it('accepts a valid analysis', () => {
    const result = parseAnalysis(JSON.stringify(VALID_ANALYSIS));
    expect(result.ok).toBe(true);
  });

  it('reports a schema error with field paths, not a generic failure', () => {
    const invalid = {
      ...VALID_ANALYSIS,
      extraction: { ...VALID_ANALYSIS.extraction, timeline: 'someday' },
    };
    const result = parseAnalysis(JSON.stringify(invalid));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(LlmSchemaError);
    expect((result.error as LlmSchemaError).issues.join(' ')).toContain('extraction.timeline');
  });

  it('reports malformed JSON separately from schema violations', () => {
    const result = parseAnalysis('not json at all');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('malformed_json');
  });
});

describe('analyzeTranscript', () => {
  const transcript = '[00:00-00:05] Agent: Vanakkam sir\n[00:05-00:10] Lead: sollunga';

  it('returns a validated analysis with usage and cost', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(completion(VALID_ANALYSIS));

    const result = await analyzeTranscript(transcript, { client: clientWith(fetchImpl as never) });

    expect(result.analysis.extraction.unit_configuration).toBe('2BHK');
    expect(result.meta.usage.totalTokens).toBe(1100);
    expect(result.meta.costUsd).toBeGreaterThan(0);
    expect(result.meta.repairsUsed).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('requests JSON mode for the v3 prompt', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(completion(VALID_ANALYSIS));
    await analyzeTranscript(transcript, { client: clientWith(fetchImpl as never) });

    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as { body: string }).body);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].role).toBe('system');
  });

  it('repairs a schema violation by feeding the errors back once', async () => {
    const broken = {
      ...VALID_ANALYSIS,
      extraction: { ...VALID_ANALYSIS.extraction, unit_configuration: '2BHK | 3BHK' },
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(completion(broken))
      .mockResolvedValueOnce(completion(VALID_ANALYSIS));

    const result = await analyzeTranscript(transcript, { client: clientWith(fetchImpl as never) });

    expect(result.meta.repairsUsed).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // The repair turn must show the model its own output plus the errors.
    const repairBody = JSON.parse((fetchImpl.mock.calls[1]?.[1] as { body: string }).body);
    expect(repairBody.messages).toHaveLength(4);
    expect(repairBody.messages[3].content).toContain('unit_configuration');
  });

  it('gives up after the repair budget and throws a schema error', async () => {
    const broken = {
      ...VALID_ANALYSIS,
      extraction: { ...VALID_ANALYSIS.extraction, unit_configuration: 'penthouse' },
    };
    const fetchImpl = vi.fn().mockResolvedValue(completion(broken));

    await expect(
      analyzeTranscript(transcript, { client: clientWith(fetchImpl as never) }),
    ).rejects.toBeInstanceOf(LlmSchemaError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 401', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(errorResponse(401, 'invalid api key'));

    await expect(
      analyzeTranscript(transcript, { client: clientWith(fetchImpl as never) }),
    ).rejects.toBeInstanceOf(LlmHttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 and reports the attempts it took', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429, 'rate limited'))
      .mockResolvedValueOnce(completion(VALID_ANALYSIS));

    const result = await analyzeTranscript(transcript, { client: clientWith(fetchImpl as never) });
    expect(result.meta.llmCalls).toBe(2);
  });
});

describe('collectWarnings', () => {
  it('flags a summary that is not exactly two sentences', () => {
    const analysis = { ...VALID_ANALYSIS, summary: 'One sentence only.' } as never;
    expect(collectWarnings(analysis).join(' ')).toContain('1 sentence');
  });

  it('flags recommending a visit that was never asked for', () => {
    const analysis = {
      ...VALID_ANALYSIS,
      extraction: { ...VALID_ANALYSIS.extraction, site_visit_outcome: 'not_asked' },
    } as never;
    expect(collectWarnings(analysis).join(' ')).toContain('never asked');
  });

  it('returns nothing for a consistent analysis', () => {
    expect(collectWarnings(VALID_ANALYSIS as never)).toHaveLength(0);
  });
});

describe('cache keys', () => {
  it('ignores cosmetic whitespace differences', () => {
    expect(transcriptHash('[00:00-00:05] Agent:  hello')).toBe(
      transcriptHash('[00:00-00:05] Agent: hello'),
    );
  });

  it('changes when the prompt version changes', () => {
    const base = { transcript: 'abc', model: 'llama-3.1-8b-instant', temperature: 0.2 } as const;
    expect(analysisCacheKey({ ...base, promptVersion: 'v2' })).not.toBe(
      analysisCacheKey({ ...base, promptVersion: 'v3' }),
    );
  });

  it('changes when the model changes', () => {
    const base = { transcript: 'abc', promptVersion: 'v3', temperature: 0.2 } as const;
    expect(analysisCacheKey({ ...base, model: 'a' })).not.toBe(
      analysisCacheKey({ ...base, model: 'b' }),
    );
  });

  it('normalizes CRLF line endings', () => {
    expect(normalizeTranscript('a\r\nb')).toBe('a\nb');
  });
});

describe('derived metrics', () => {
  it('averages the four dimension scores', () => {
    expect(overallScore(VALID_ANALYSIS.quality_scores as never)).toBe(3.5);
  });

  it('bands scores for colour coding', () => {
    expect(scoreBand(4.2)).toBe('strong');
    expect(scoreBand(3)).toBe('developing');
    expect(scoreBand(1.4)).toBe('weak');
  });

  it('counts sentences without splitting on decimals', () => {
    expect(countSentences('Discussed a 2BHK at 42.5 lakhs. Visit confirmed.')).toBe(2);
    expect(countSentences('One. Two. Three.')).toBe(3);
  });

  it('prices a completion from the usage block', () => {
    const cost = estimateCostUsd('llama-3.1-8b-instant', {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      totalTokens: 2_000_000,
    });
    expect(cost).toBeCloseTo(0.13, 5);
  });

  it('prices an unknown model as zero rather than throwing', () => {
    expect(
      estimateCostUsd('some-future-model', {
        promptTokens: 1000,
        completionTokens: 1000,
        totalTokens: 2000,
      }),
    ).toBe(0);
  });
});
