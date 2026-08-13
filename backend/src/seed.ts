import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  analysisSchema,
  callMetadataSchema,
  repairLegacyAnalysis,
  type CallAnalysis,
  type RepairNoteDto,
  type ValidationStatus,
} from '@call-intel/shared';
import { transcriptHash } from '@call-intel/shared/llm';
import { prisma } from './db/index.js';
import { LEGACY_MODEL, LEGACY_PROMPT_VERSION, PATHS, VALIDATION_STATUS } from './constants.js';
import { analysisToColumns, buildSearchText } from './models/call.model.js';

/**
 * Loads the committed seed dataset into the database.
 *
 * Every row is validated on the way in. Rows that fail — 19 of 150, produced
 * before the pipeline validated anything — are repaired deterministically by
 * `repairLegacyAnalysis`, stored with `validationStatus: 'repaired'`, and keep
 * the list of repairs applied so the dashboard can show what was changed and
 * `npm run process-calls -- --repair` can re-analyze them properly.
 *
 * The analyses in this file predate prompt versioning, so their provenance is
 * recorded as `legacy` rather than claiming a version that did not exist. Token
 * counts are zero because the original pipeline discarded the usage block.
 */

const SEED_PATH = resolve(process.cwd(), PATHS.seedDataset);

interface SeedStats {
  telecallers: number;
  inserted: number;
  repaired: number;
  skipped: Array<{ callId: string; reason: string }>;
  locations: number;
}

function analysisPartOf(row: Record<string, unknown>): unknown {
  return {
    extraction: row.extraction,
    quality_scores: row.quality_scores,
    last_stage_reached: row.last_stage_reached,
    recommended_next_action: row.recommended_next_action,
    summary: row.summary,
  };
}

async function seed(): Promise<SeedStats> {
  const raw = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as unknown[];
  if (!Array.isArray(raw)) throw new Error(`${SEED_PATH} must contain a JSON array`);

  const stats: SeedStats = {
    telecallers: 0,
    inserted: 0,
    repaired: 0,
    skipped: [],
    locations: 0,
  };

  // Idempotent: a re-seed replaces the dataset instead of duplicating it.
  // Cascades clear PreferredLocation rows.
  await prisma.call.deleteMany({});
  await prisma.telecaller.deleteMany({});

  const telecallerIds = new Map<string, string>();

  for (const [index, entry] of raw.entries()) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const metadata = callMetadataSchema.safeParse(row);

    if (!metadata.success) {
      stats.skipped.push({
        callId: String(row.call_id ?? `row_${index}`),
        reason: metadata.error.issues.map((issue) => issue.path.join('.')).join(', '),
      });
      continue;
    }

    let analysis: CallAnalysis;
    let repairNotes: RepairNoteDto[] = [];
    let validationStatus: ValidationStatus = VALIDATION_STATUS.VALID;

    const strict = analysisSchema.safeParse(analysisPartOf(row));
    if (strict.success) {
      analysis = strict.data;
    } else {
      const repaired = repairLegacyAnalysis(row);
      if (!repaired.ok) {
        stats.skipped.push({
          callId: metadata.data.call_id,
          reason: repaired.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
        });
        continue;
      }
      analysis = repaired.analysis;
      repairNotes = repaired.repairs;
      validationStatus = VALIDATION_STATUS.REPAIRED;
      stats.repaired += 1;
    }

    const telecallerName = metadata.data.telecaller_name;
    let telecallerId = telecallerIds.get(telecallerName);
    if (!telecallerId) {
      const telecaller = await prisma.telecaller.upsert({
        where: { name: telecallerName },
        create: { name: telecallerName },
        update: {},
      });
      telecallerId = telecaller.id;
      telecallerIds.set(telecallerName, telecallerId);
      stats.telecallers += 1;
    }

    const locations = [
      ...new Set(
        analysis.extraction.preferred_locations.map((name) => name.trim()).filter(Boolean),
      ),
    ];

    await prisma.call.create({
      data: {
        callId: metadata.data.call_id,
        telecallerId,
        leadName: metadata.data.lead_name,
        occurredAt: new Date(metadata.data.timestamp),
        durationSec: metadata.data.duration_sec,
        transcript: metadata.data.transcript,
        transcriptHash: transcriptHash(metadata.data.transcript),
        source: 'seed',
        searchText: buildSearchText({
          leadName: metadata.data.lead_name,
          telecallerName,
          callId: metadata.data.call_id,
        }),
        ...analysisToColumns({
          analysis,
          model: LEGACY_MODEL,
          promptVersion: LEGACY_PROMPT_VERSION,
          validationStatus,
          repairNotes,
        }),
        analyzedAt: new Date(metadata.data.timestamp),
        locations: { create: locations.map((name) => ({ name })) },
      },
    });

    stats.inserted += 1;
    stats.locations += locations.length;
  }

  return stats;
}

seed()
  .then((stats) => {
    console.log('\nSeed complete');
    console.log('='.repeat(48));
    console.log(`telecallers        ${stats.telecallers}`);
    console.log(`calls inserted     ${stats.inserted}`);
    console.log(`  flagged repaired ${stats.repaired}`);
    console.log(`locations linked   ${stats.locations}`);
    if (stats.skipped.length > 0) {
      console.log(`skipped            ${stats.skipped.length}`);
      stats.skipped.forEach((skip) => console.log(`  ${skip.callId}: ${skip.reason}`));
    }
    console.log('');
  })
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
