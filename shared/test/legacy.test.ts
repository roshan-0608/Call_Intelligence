import { describe, expect, it } from 'vitest';
import { repairLegacyAnalysis } from '@call-intel/shared';

/**
 * The repair layer is what lets the 19 invalid rows of the v1 dataset be
 * imported without hand-editing the data or hiding the defect. Each case here is
 * an actual malformed row from that file.
 */

function baseRow(extractionOverrides: Record<string, unknown>) {
  return {
    extraction: {
      unit_configuration: '2BHK',
      budget_range: { min_lakhs: 40, max_lakhs: 50 },
      timeline: 'immediate',
      preferred_locations: ['Velachery'],
      site_visit_outcome: 'committed_with_date',
      ...extractionOverrides,
    },
    quality_scores: {
      discovery: { score: 4, reason: 'Asked budget and timeline.' },
      pitch: { score: 3, reason: 'Covered price only.' },
      objection_handling: { score: 2, reason: 'Deflected.' },
      next_step: { score: 4, reason: 'Visit agreed.' },
    },
    last_stage_reached: 'close_attempt',
    recommended_next_action: 'confirm_site_visit',
    summary: 'Discussed a 2BHK in Velachery. Visit agreed with no date.',
  };
}

describe('repairLegacyAnalysis', () => {
  it('keeps the first value when several legal options were joined', () => {
    const result = repairLegacyAnalysis(baseRow({ unit_configuration: '2BHK | 3BHK' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.analysis.extraction.unit_configuration).toBe('2BHK');
    expect(result.repairs[0]?.rule).toContain('kept first');
  });

  it('collapses a duplicated value to the single real answer', () => {
    const result = repairLegacyAnalysis(baseRow({ unit_configuration: '2BHK | 2BHK' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.analysis.extraction.unit_configuration).toBe('2BHK');
  });

  it('treats an echoed enum spec as no answer at all', () => {
    const result = repairLegacyAnalysis(
      baseRow({ unit_configuration: '2BHK | 3BHK | 4BHK | villa | plot | not_discussed' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.analysis.extraction.unit_configuration).toBe('not_discussed');
    expect(result.repairs[0]?.rule).toContain('echoed');
  });

  it('rewrites a zero-valued budget as not_discussed', () => {
    const result = repairLegacyAnalysis(baseRow({ budget_range: { min_lakhs: 0, max_lakhs: 0 } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.analysis.extraction.budget_range).toBe('not_discussed');
  });

  it('collapses a half-zero range to the single stated figure', () => {
    const result = repairLegacyAnalysis(baseRow({ budget_range: { min_lakhs: 45, max_lakhs: 0 } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.analysis.extraction.budget_range).toEqual({ min_lakhs: 45, max_lakhs: 45 });
  });

  it('swaps an inverted range rather than discarding both numbers', () => {
    const result = repairLegacyAnalysis(
      baseRow({ budget_range: { min_lakhs: 60, max_lakhs: 40 } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.analysis.extraction.budget_range).toEqual({ min_lakhs: 40, max_lakhs: 60 });
  });

  it('clears a call stage that leaked into the site-visit field', () => {
    const result = repairLegacyAnalysis(baseRow({ site_visit_outcome: 'next_step_confirmed' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.analysis.extraction.site_visit_outcome).toBe('not_asked');
  });

  it('leaves an already-valid row untouched and reports no repairs', () => {
    const result = repairLegacyAnalysis(baseRow({}));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.repairs).toHaveLength(0);
  });

  it('reports failure, without throwing, when a row cannot be salvaged', () => {
    const row = baseRow({});
    row.quality_scores.discovery.score = 99;

    const result = repairLegacyAnalysis(row);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.length).toBeGreaterThan(0);
  });

  it('does not throw on structurally absent input', () => {
    expect(() => repairLegacyAnalysis(undefined)).not.toThrow();
    expect(repairLegacyAnalysis({}).ok).toBe(false);
  });
});
