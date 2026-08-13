/**
 * Dataset audit: validates every row in a processed-calls JSON file against the
 * analysis schema and reports what the legacy repair layer would change.
 *
 * This is the command that produced the "8% of the v1 dataset is invalid"
 * figure quoted in docs/eval-results.md. Run it after any pipeline change:
 *
 *   npm run validate:dataset
 *   npm run validate:dataset -- path/to/other.json
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PATHS } from './constants.js';
import {
  analysisSchema,
  callMetadataSchema,
  countSentences,
  repairLegacyAnalysis,
  type RepairNote,
} from '@call-intel/shared';

const inputPath = resolve(process.argv[2] ?? PATHS.seedDataset);

interface Report {
  total: number;
  metadataInvalid: string[];
  strictValid: number;
  repairedIds: string[];
  unsalvageable: Array<{ id: string; issues: string[] }>;
  repairsByRule: Map<string, number>;
  softWarnings: { summarySentenceCount: string[] };
}

function analysisOf(row: Record<string, unknown>) {
  return {
    extraction: row.extraction,
    quality_scores: row.quality_scores,
    last_stage_reached: row.last_stage_reached,
    recommended_next_action: row.recommended_next_action,
    summary: row.summary,
  };
}

function audit(rows: unknown[]): Report {
  const report: Report = {
    total: rows.length,
    metadataInvalid: [],
    strictValid: 0,
    repairedIds: [],
    unsalvageable: [],
    repairsByRule: new Map(),
    softWarnings: { summarySentenceCount: [] },
  };

  rows.forEach((raw, index) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const id = typeof row.call_id === 'string' ? row.call_id : `row_${index}`;

    // Metadata is checked separately: a bad timestamp is an ingestion bug,
    // not a model failure, and conflating the two hides both.
    if (!callMetadataSchema.safeParse(row).success) {
      report.metadataInvalid.push(id);
    }

    if (typeof row.summary === 'string' && countSentences(row.summary) !== 2) {
      report.softWarnings.summarySentenceCount.push(id);
    }

    if (analysisSchema.safeParse(analysisOf(row)).success) {
      report.strictValid += 1;
      return;
    }

    const repair = repairLegacyAnalysis(row);
    countRepairs(report, repair.repairs);

    if (repair.ok) {
      report.repairedIds.push(id);
    } else {
      report.unsalvageable.push({
        id,
        issues: repair.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      });
    }
  });

  return report;
}

function countRepairs(report: Report, repairs: RepairNote[]): void {
  for (const note of repairs) {
    report.repairsByRule.set(note.rule, (report.repairsByRule.get(note.rule) ?? 0) + 1);
  }
}

function percent(part: number, whole: number): string {
  return whole === 0 ? '0.0%' : `${((part / whole) * 100).toFixed(1)}%`;
}

function main(): void {
  const rows = JSON.parse(readFileSync(inputPath, 'utf8')) as unknown[];
  if (!Array.isArray(rows)) {
    console.error(`${inputPath} does not contain a JSON array.`);
    process.exit(1);
  }

  const report = audit(rows);
  const invalid = report.repairedIds.length + report.unsalvageable.length;

  console.log(`\nDataset audit — ${inputPath}`);
  console.log('='.repeat(60));
  console.log(`records                    ${report.total}`);
  console.log(
    `schema-valid as-is         ${report.strictValid}  (${percent(report.strictValid, report.total)})`,
  );
  console.log(`schema-invalid             ${invalid}  (${percent(invalid, report.total)})`);
  console.log(`  repairable               ${report.repairedIds.length}`);
  console.log(`  unsalvageable            ${report.unsalvageable.length}`);
  console.log(`metadata invalid           ${report.metadataInvalid.length}`);
  console.log(
    `summary != 2 sentences     ${report.softWarnings.summarySentenceCount.length}  (${percent(
      report.softWarnings.summarySentenceCount.length,
      report.total,
    )})`,
  );

  if (report.repairsByRule.size > 0) {
    console.log('\nRepairs by rule');
    for (const [rule, count] of [...report.repairsByRule].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(3)}  ${rule}`);
    }
  }

  if (report.repairedIds.length > 0) {
    console.log(`\nFlagged for reprocessing (${report.repairedIds.length})`);
    console.log(`  ${report.repairedIds.join(', ')}`);
    console.log('  Re-analyze with: npm run process-calls -- --repair');
  }

  for (const bad of report.unsalvageable) {
    console.log(`\nUNSALVAGEABLE ${bad.id}`);
    bad.issues.forEach((issue) => console.log(`  - ${issue}`));
  }

  console.log('');
  // Non-zero exit only for rows no deterministic repair can fix, so CI can gate
  // on hard corruption without failing on the known, flagged legacy rows.
  process.exit(report.unsalvageable.length > 0 ? 1 : 0);
}

main();
