import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import {
  apiResponseSchema,
  callDetailSchema,
  callSummarySchema,
  paginatedSchema,
} from '@call-intel/shared';

/**
 * HTTP-level tests for the API.
 *
 * The database is stubbed rather than provisioned: these tests are about the
 * request/response contract — validation, error shape, DTO mapping, pagination
 * arithmetic, ranking order — none of which needs a real SQLite file. The LLM is
 * never reachable here (the suite runs with no API key), which is itself one of
 * the cases under test.
 *
 * Every success response is parsed with the same Zod schema the web app uses, so
 * a drift between server output and the shared contract fails here.
 */

const now = new Date('2026-04-01T10:00:00.000Z');

function callRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ckl1',
    callId: 'CALL_0001',
    telecallerId: 't1',
    telecaller: { id: 't1', name: 'Suresh Kumar', createdAt: now },
    leadName: 'Meenakshi Sundaram',
    occurredAt: now,
    durationSec: 107,
    transcript: '[00:00-00:05] Agent: Vanakkam sir',
    transcriptHash: 'hash1',
    source: 'seed',
    searchText: 'meenakshi sundaram suresh kumar call_0001',
    unitConfiguration: '2BHK',
    budgetMinLakhs: 40,
    budgetMaxLakhs: 50,
    budgetDiscussed: true,
    timeline: 'immediate',
    siteVisitOutcome: 'committed_with_date',
    discoveryScore: 4,
    discoveryReason: 'Asked budget, timeline and location.',
    pitchScore: 3,
    pitchReason: 'Covered price and location.',
    objectionHandlingScore: 2,
    objectionHandlingReason: 'Deflected the price objection.',
    nextStepScore: 5,
    nextStepReason: 'Visit fixed for Saturday.',
    overallScore: 3.5,
    lastStageReached: 'next_step_confirmed',
    recommendedNextAction: 'confirm_site_visit',
    summary: 'Discussed a 2BHK in Velachery. Visit confirmed for Saturday.',
    model: 'llama-3.1-8b-instant',
    promptVersion: 'legacy',
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    latencyMs: 0,
    validationStatus: 'valid',
    repairNotes: null,
    warnings: null,
    analyzedAt: now,
    createdAt: now,
    updatedAt: now,
    locations: [{ id: 'l1', callId: 'ckl1', name: 'Velachery' }],
    ...overrides,
  };
}

const state = {
  count: 150,
  rows: [callRow()] as ReturnType<typeof callRow>[],
  detail: callRow() as ReturnType<typeof callRow> | null,
};

const prismaStub = {
  call: {
    count: vi.fn(async () => state.count),
    findMany: vi.fn(async () => state.rows),
    findFirst: vi.fn(async () => state.detail),
    groupBy: vi.fn(async () => []),
    aggregate: vi.fn(async () => ({
      _count: { _all: 0 },
      _avg: {},
      _sum: {},
    })),
    create: vi.fn(),
  },
  telecaller: { findMany: vi.fn(async () => []), count: vi.fn(async () => 12), upsert: vi.fn() },
  preferredLocation: { groupBy: vi.fn(async () => []) },
  analysisCache: {
    count: vi.fn(async () => 0),
    aggregate: vi.fn(async () => ({ _sum: { hitCount: 0 } })),
    findUnique: vi.fn(async () => null),
    upsert: vi.fn(),
  },
  // The routes batch reads with $transaction([...]); resolve the array as-is.
  $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  $queryRaw: vi.fn(async () => [{ 1: 1 }]),
  $on: vi.fn(),
  $disconnect: vi.fn(),
};

vi.mock('../src/db/index.js', () => ({
  prisma: prismaStub,
  checkDatabase: async () => true,
}));

const { createApp } = await import('../src/app.js');
const app = createApp();

beforeEach(() => {
  state.count = 150;
  state.rows = [callRow()];
  state.detail = callRow();
  vi.clearAllMocks();
  prismaStub.call.count.mockImplementation(async () => state.count);
  prismaStub.call.findMany.mockImplementation(async () => state.rows);
  prismaStub.call.findFirst.mockImplementation(async () => state.detail);
  prismaStub.$transaction.mockImplementation(async (operations: Promise<unknown>[]) =>
    Promise.all(operations),
  );
  prismaStub.$queryRaw.mockImplementation(async () => [{ 1: 1 }]);
});

describe('GET /calls', () => {
  it('returns a payload matching the shared contract', async () => {
    const response = await request(app).get('/calls').expect(200);

    const parsed = apiResponseSchema(paginatedSchema(callSummarySchema)).safeParse(response.body);
    expect(parsed.success).toBe(true);
  });

  it('omits the transcript from list rows', async () => {
    const response = await request(app).get('/calls').expect(200);
    expect(response.body.data.data[0]).not.toHaveProperty('transcript');
  });

  it('maps a discussed budget into the union shape', async () => {
    const response = await request(app).get('/calls').expect(200);
    expect(response.body.data.data[0].budget).toEqual({ min_lakhs: 40, max_lakhs: 50 });
  });

  it('maps an absent budget to the not_discussed sentinel', async () => {
    state.rows = [callRow({ budgetDiscussed: false, budgetMinLakhs: null, budgetMaxLakhs: null })];
    const response = await request(app).get('/calls').expect(200);
    expect(response.body.data.data[0].budget).toBe('not_discussed');
  });

  it('computes pagination arithmetic from the total', async () => {
    const response = await request(app).get('/calls?page=3&pageSize=20').expect(200);

    expect(response.body.data.pagination).toMatchObject({
      page: 3,
      pageSize: 20,
      total: 150,
      totalPages: 8,
      hasNext: true,
      hasPrev: true,
    });
  });

  it('reports no next page on the last one', async () => {
    state.count = 40;
    const response = await request(app).get('/calls?page=2&pageSize=20').expect(200);
    expect(response.body.data.pagination).toMatchObject({ hasNext: false, hasPrev: true });
  });

  it('lowercases the search term for the portable search column', async () => {
    await request(app).get('/calls?q=SURESH').expect(200);

    const args = prismaStub.call.findMany.mock.calls[0]?.[0] as {
      where: { searchText?: { contains: string } };
    };
    expect(args.where.searchText?.contains).toBe('suresh');
  });

  it('translates the flagged filter into a validation-status query', async () => {
    await request(app).get('/calls?flagged=true').expect(200);

    const args = prismaStub.call.findMany.mock.calls[0]?.[0] as {
      where: { validationStatus?: string };
    };
    expect(args.where.validationStatus).toBe('repaired');
  });

  it('orders by the requested field with a stable tiebreaker', async () => {
    await request(app).get('/calls?sort=overallScore&order=asc').expect(200);

    const args = prismaStub.call.findMany.mock.calls[0]?.[0] as {
      orderBy: Array<Record<string, string>>;
    };
    expect(args.orderBy[0]).toEqual({ overallScore: 'asc' });
    expect(args.orderBy[1]).toEqual({ callId: 'asc' });
  });

  it('rejects an unknown stage with field-level detail', async () => {
    const response = await request(app).get('/calls?stage=bogus').expect(400);

    expect(response.body.code).toBe('bad_request');
    expect(response.body.errors[0].path).toBe('stage');
    expect(response.body.requestId).toBeTruthy();
  });

  it('rejects a non-numeric page', async () => {
    await request(app).get('/calls?page=abc').expect(400);
  });

  it('caps the page size at the configured maximum', async () => {
    const response = await request(app).get('/calls?pageSize=100').expect(200);
    expect(response.body.data.pagination.pageSize).toBeLessThanOrEqual(100);
  });
});

describe('GET /calls/:id', () => {
  it('returns a detail payload matching the shared contract', async () => {
    const response = await request(app).get('/calls/CALL_0001').expect(200);

    const parsed = apiResponseSchema(callDetailSchema).safeParse(response.body);
    expect(parsed.success).toBe(true);
    expect(response.body.data.qualityScores.discovery).toEqual({
      score: 4,
      reason: 'Asked budget, timeline and location.',
    });
  });

  it('accepts either the business key or the database id', async () => {
    await request(app).get('/calls/ckl1').expect(200);

    const args = prismaStub.call.findFirst.mock.calls[0]?.[0] as {
      where: { OR: Array<Record<string, string>> };
    };
    expect(args.where.OR).toEqual([{ callId: 'ckl1' }, { id: 'ckl1' }]);
  });

  it('surfaces repair notes on a repaired row', async () => {
    state.detail = callRow({
      validationStatus: 'repaired',
      repairNotes: JSON.stringify([
        {
          field: 'extraction.unit_configuration',
          from: '2BHK | 3BHK',
          to: '2BHK',
          rule: 'kept first',
        },
      ]),
    });

    const response = await request(app).get('/calls/CALL_0001').expect(200);
    expect(response.body.data.analysis.repairNotes).toHaveLength(1);
    expect(response.body.data.validationStatus).toBe('repaired');
  });

  it('tolerates a corrupt provenance blob instead of failing the request', async () => {
    state.detail = callRow({ repairNotes: '{not json', warnings: 'nope' });

    const response = await request(app).get('/calls/CALL_0001').expect(200);
    expect(response.body.data.analysis.repairNotes).toEqual([]);
    expect(response.body.data.analysis.warnings).toEqual([]);
  });

  it('returns a structured 404 for a missing call', async () => {
    state.detail = null;
    const response = await request(app).get('/calls/NOPE').expect(404);

    expect(response.body.code).toBe('not_found');
    expect(response.body.message).toContain('NOPE');
  });
});

describe('GET /leaderboard', () => {
  it('ranks by average score, breaking ties on call count', async () => {
    prismaStub.call.groupBy
      .mockResolvedValueOnce([
        {
          telecallerId: 't1',
          _count: { _all: 10 },
          _avg: {
            overallScore: 3.2,
            discoveryScore: 4,
            pitchScore: 3,
            objectionHandlingScore: 2,
            nextStepScore: 3.5,
          },
        },
        {
          telecallerId: 't2',
          _count: { _all: 20 },
          _avg: {
            overallScore: 4.1,
            discoveryScore: 4.5,
            pitchScore: 4,
            objectionHandlingScore: 3.5,
            nextStepScore: 4.4,
          },
        },
      ] as never)
      .mockResolvedValueOnce([{ telecallerId: 't2', _count: { _all: 15 } }] as never);

    prismaStub.telecaller.findMany.mockResolvedValueOnce([
      { id: 't1', name: 'Alpha' },
      { id: 't2', name: 'Beta' },
    ] as never);

    const response = await request(app).get('/leaderboard').expect(200);

    expect(
      response.body.data.data.map((entry: { telecallerName: string }) => entry.telecallerName),
    ).toEqual(['Beta', 'Alpha']);
    expect(response.body.data.data[0]).toMatchObject({ rank: 1, commitRate: 75 });
    // Zero commits must be 0%, not NaN or a division error.
    expect(response.body.data.data[1].commitRate).toBe(0);
  });

  it('applies the minimum-calls filter', async () => {
    prismaStub.call.groupBy
      .mockResolvedValueOnce([
        {
          telecallerId: 't1',
          _count: { _all: 2 },
          _avg: {
            overallScore: 5,
            discoveryScore: 5,
            pitchScore: 5,
            objectionHandlingScore: 5,
            nextStepScore: 5,
          },
        },
      ] as never)
      .mockResolvedValueOnce([] as never);
    prismaStub.telecaller.findMany.mockResolvedValueOnce([{ id: 't1', name: 'Alpha' }] as never);

    const response = await request(app).get('/leaderboard?minCalls=5').expect(200);
    expect(response.body.data.data).toEqual([]);
  });
});

describe('POST /upload', () => {
  const validTranscript =
    '[00:00-00:05] Agent: Vanakkam sir, Suresh here from Skyline\n[00:05-00:12] Lead: haan sollunga, enna vishayam?';

  it('rejects a body with no transcript', async () => {
    const response = await request(app).post('/upload').send({}).expect(400);
    expect(response.body.errors[0].path).toBe('transcript');
  });

  it('rejects text that is not a timestamped transcript', async () => {
    const response = await request(app)
      .post('/upload')
      .send({
        transcript: 'just some prose that is definitely long enough to pass the length check',
      })
      .expect(400);

    expect(response.body.message).toContain('does not look like a call transcript');
  });

  it('returns 503 with an actionable message when no API key is configured', async () => {
    // No stored call with this hash, so the request reaches the analysis step.
    state.detail = null;

    const response = await request(app).post('/upload').send({ transcript: validTranscript });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('llm_not_configured');
    expect(response.body.message).toContain('GROQ_API_KEY');
  });

  it('returns the stored call for a duplicate transcript without calling the model', async () => {
    prismaStub.call.findFirst.mockResolvedValueOnce(callRow() as never);

    const response = await request(app)
      .post('/upload')
      .send({ transcript: validTranscript })
      .expect(200);

    expect(response.body.data.duplicate).toBe(true);
    expect(response.body.data.cached).toBe(true);
    expect(prismaStub.call.create).not.toHaveBeenCalled();
  });
});

describe('the response envelope', () => {
  it('wraps every success in { success, statusCode, message, data }', async () => {
    const response = await request(app).get('/calls').expect(200);

    expect(response.body).toMatchObject({ success: true, statusCode: 200 });
    expect(typeof response.body.message).toBe('string');
    expect(response.body.data).toBeDefined();
  });

  it('reports the same status in the body as in the HTTP response', async () => {
    state.detail = null;
    const response = await request(app).get('/calls/NOPE-DOES-NOT-EXIST');

    expect(response.body.statusCode).toBe(response.status);
    expect(response.body.success).toBe(false);
  });

  it('leaves health probes unwrapped, since platform probes expect a flat body', async () => {
    const response = await request(app).get('/health/live').expect(200);

    expect(response.body).toEqual({ status: 'ok', uptimeSec: expect.any(Number) });
    expect(response.body).not.toHaveProperty('data');
  });
});

describe('health and routing', () => {
  it('reports liveness without touching the database', async () => {
    const response = await request(app).get('/health/live').expect(200);
    expect(response.body.status).toBe('ok');
    expect(prismaStub.$queryRaw).not.toHaveBeenCalled();
  });

  it('reports readiness including LLM configuration state', async () => {
    const response = await request(app).get('/health/ready').expect(200);
    expect(response.body.checks).toEqual({ database: 'ok', llm: 'not_configured' });
  });

  it('returns a structured 404 for an unknown route', async () => {
    const response = await request(app).get('/nope').expect(404);
    expect(response.body.code).toBe('not_found');
    expect(response.body.message).toContain('GET /nope');
  });

  it('sets security headers and a request id', async () => {
    const response = await request(app).get('/health/live').expect(200);
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});
