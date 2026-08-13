import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { callListQuerySchema, type CallSummary, type Paginated } from '@call-intel/shared';
import { prisma } from '../db/index.js';
import { env } from '../env.js';
import { NotFoundError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { parseParams, parseQuery } from '../middlewares/validate.js';
import { callInclude } from '../models/call.model.js';
import { toCallDetail, toCallSummary } from '../utils/callMapper.js';
import { VALIDATION_STATUS } from '../constants.js';

/**
 * Call listing and detail.
 *
 * Filtering, sorting and pagination all happen in SQL. The original endpoint
 * returned every row — transcripts included — and let the browser filter, which
 * meant the client downloaded 378KB to display twenty rows and could not sort by
 * score at all.
 */

const idParamSchema = z.object({ id: z.string().min(1).max(64) });

export const listCalls = asyncHandler(async (req, res) => {
  const query = parseQuery(req, callListQuerySchema);
  const pageSize = Math.min(query.pageSize, env.MAX_PAGE_SIZE);
  const where = buildWhere(query);

  const [total, rows] = await prisma.$transaction([
    prisma.call.count({ where }),
    prisma.call.findMany({
      where,
      include: callInclude,
      omit: { transcript: true },
      orderBy: buildOrderBy(query.sort, query.order),
      skip: (query.page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const totalPages = Math.ceil(total / pageSize);
  const payload: Paginated<CallSummary> = {
    data: rows.map(toCallSummary),
    pagination: {
      page: query.page,
      pageSize,
      total,
      totalPages,
      hasNext: query.page < totalPages,
      hasPrev: query.page > 1,
    },
  };

  res.status(200).json(new ApiResponse(200, payload, 'Calls fetched'));
});

/**
 * Accepts either the business key (`CALL_0042`) or the database id, so links
 * built from the seed data keep working after a reseed.
 */
export const getCallById = asyncHandler(async (req, res) => {
  const { id } = parseParams(req, idParamSchema);

  const row = await prisma.call.findFirst({
    where: { OR: [{ callId: id }, { id }] },
    include: callInclude,
  });

  if (!row) throw new NotFoundError(`No call found with id "${id}"`);

  res.status(200).json(new ApiResponse(200, toCallDetail(row), 'Call fetched'));
});

function buildWhere(query: z.infer<typeof callListQuerySchema>): Prisma.CallWhereInput {
  const where: Prisma.CallWhereInput = {};

  if (query.q) where.searchText = { contains: query.q.toLowerCase() };
  if (query.stage) where.lastStageReached = query.stage;
  if (query.action) where.recommendedNextAction = query.action;
  if (query.outcome) where.siteVisitOutcome = query.outcome;
  if (query.telecaller) where.telecaller = { name: query.telecaller };
  if (query.location) where.locations = { some: { name: query.location } };
  if (query.flagged !== undefined) {
    where.validationStatus = query.flagged ? VALIDATION_STATUS.REPAIRED : VALIDATION_STATUS.VALID;
  }
  if (query.minScore !== undefined || query.maxScore !== undefined) {
    where.overallScore = {
      ...(query.minScore !== undefined ? { gte: query.minScore } : {}),
      ...(query.maxScore !== undefined ? { lte: query.maxScore } : {}),
    };
  }

  return where;
}

function buildOrderBy(
  sort: z.infer<typeof callListQuerySchema>['sort'],
  order: 'asc' | 'desc',
): Prisma.CallOrderByWithRelationInput[] {
  // `callId` is appended as a tiebreaker so pagination is stable when many rows
  // share a score — without it, rows can repeat or vanish between pages.
  return [{ [sort]: order }, { callId: 'asc' }];
}
