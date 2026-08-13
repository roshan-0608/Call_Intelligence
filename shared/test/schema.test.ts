import { describe, expect, it } from 'vitest';
import {
  analysisSchema,
  budgetRangeSchema,
  callMetadataSchema,
  extractionSchema,
} from '@call-intel/shared';

/**
 * The schema is the project's central contract, so these tests pin the
 * decisions that were made deliberately — each one corresponds to a real defect
 * found in the v1 dataset.
 */

function validAnalysis() {
  return {
    extraction: {
      unit_configuration: '2BHK' as const,
      budget_range: { min_lakhs: 40, max_lakhs: 50 },
      timeline: 'immediate' as const,
      preferred_locations: ['Velachery'],
      site_visit_outcome: 'committed_with_date' as const,
    },
    quality_scores: {
      discovery: { score: 4, reason: 'Asked budget, timeline and location.' },
      pitch: { score: 3, reason: 'Covered price and location only.' },
      objection_handling: { score: 2, reason: 'Deflected the price objection.' },
      next_step: { score: 5, reason: 'Visit fixed for Saturday 10am.' },
    },
    last_stage_reached: 'next_step_confirmed' as const,
    recommended_next_action: 'confirm_site_visit' as const,
    summary: 'Discussed a 2BHK in Velachery at 40-50 lakhs. Visit confirmed for Saturday.',
  };
}

describe('analysisSchema', () => {
  it('accepts a well-formed analysis', () => {
    expect(analysisSchema.safeParse(validAnalysis()).success).toBe(true);
  });

  it('rejects a `|`-joined enum answer', () => {
    // Six rows of the v1 dataset answered "2BHK | 3BHK".
    const analysis = validAnalysis();
    analysis.extraction.unit_configuration = '2BHK | 3BHK' as never;
    expect(analysisSchema.safeParse(analysis).success).toBe(false);
  });

  it('rejects the enum spec echoed back as an answer', () => {
    const analysis = validAnalysis();
    analysis.extraction.unit_configuration =
      '2BHK | 3BHK | 4BHK | villa | plot | not_discussed' as never;
    expect(analysisSchema.safeParse(analysis).success).toBe(false);
  });

  it('rejects a call stage in the site-visit field', () => {
    const analysis = validAnalysis();
    analysis.extraction.site_visit_outcome = 'next_step_confirmed' as never;
    expect(analysisSchema.safeParse(analysis).success).toBe(false);
  });

  it('rejects unknown keys, which mean the model invented a field', () => {
    const analysis = { ...validAnalysis(), lead_temperature: 'hot' };
    expect(analysisSchema.safeParse(analysis).success).toBe(false);
  });

  it('rejects a non-integer or out-of-range score', () => {
    const fractional = validAnalysis();
    fractional.quality_scores.discovery.score = 3.5;
    expect(analysisSchema.safeParse(fractional).success).toBe(false);

    const tooHigh = validAnalysis();
    tooHigh.quality_scores.pitch.score = 6;
    expect(analysisSchema.safeParse(tooHigh).success).toBe(false);
  });

  it('requires a reason for every score', () => {
    const analysis = validAnalysis();
    analysis.quality_scores.next_step.reason = '';
    expect(analysisSchema.safeParse(analysis).success).toBe(false);
  });
});

describe('budgetRangeSchema', () => {
  it('accepts a range and the not_discussed sentinel', () => {
    expect(budgetRangeSchema.safeParse({ min_lakhs: 40, max_lakhs: 50 }).success).toBe(true);
    expect(budgetRangeSchema.safeParse({ min_lakhs: 40, max_lakhs: 40 }).success).toBe(true);
    expect(budgetRangeSchema.safeParse('not_discussed').success).toBe(true);
  });

  it('rejects a zero budget, the workaround for "never return null"', () => {
    // Nine rows of the v1 dataset used {0, 0} to mean "not discussed".
    expect(budgetRangeSchema.safeParse({ min_lakhs: 0, max_lakhs: 0 }).success).toBe(false);
  });

  it('rejects an inverted range', () => {
    expect(budgetRangeSchema.safeParse({ min_lakhs: 60, max_lakhs: 40 }).success).toBe(false);
  });

  it('rejects null', () => {
    expect(budgetRangeSchema.safeParse(null).success).toBe(false);
  });
});

describe('extractionSchema', () => {
  it('accepts an empty location list', () => {
    const result = extractionSchema.safeParse({
      unit_configuration: 'not_discussed',
      budget_range: 'not_discussed',
      timeline: 'unclear',
      preferred_locations: [],
      site_visit_outcome: 'not_asked',
    });
    expect(result.success).toBe(true);
  });
});

describe('callMetadataSchema', () => {
  it('accepts an ISO timestamp with an offset', () => {
    const result = callMetadataSchema.safeParse({
      call_id: 'CALL_0001',
      telecaller_name: 'Suresh Kumar',
      lead_name: 'Meenakshi',
      timestamp: '2026-04-01T10:00:00+05:30',
      duration_sec: 107,
      transcript: '[00:00-00:05] Agent: Vanakkam',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a timestamp with no offset', () => {
    const result = callMetadataSchema.safeParse({
      call_id: 'CALL_0001',
      telecaller_name: 'Suresh Kumar',
      lead_name: 'Meenakshi',
      timestamp: '2026-04-01 10:00:00',
      duration_sec: 107,
      transcript: '[00:00-00:05] Agent: Vanakkam',
    });
    expect(result.success).toBe(false);
  });
});
