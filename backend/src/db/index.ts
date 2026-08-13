import { PrismaClient } from '@prisma/client';
import { env } from '../env.js';
import { logger } from '../logger.js';

/**
 * Single Prisma client for the process.
 *
 * Cached on `globalThis` so `tsx watch` reloads do not open a new connection
 * pool on every file save — the standard fix for the "too many connections"
 * failure that shows up first in development and later, painfully, in
 * serverless deploys.
 */
/**
 * Built through a factory so the client keeps its log-event generic. Assigning
 * `globalForPrisma.prisma ?? new PrismaClient({...})` widens the type to the
 * default `PrismaClient`, and `$on('warn')` then fails to typecheck because the
 * default client declares no log events.
 */
function createPrismaClient() {
  return new PrismaClient({
    // Emitted as events rather than printed by Prisma itself, so database
    // warnings land in the same structured log as everything else.
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });
}

type AppPrismaClient = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as { prisma?: AppPrismaClient };

export const prisma: AppPrismaClient = globalForPrisma.prisma ?? createPrismaClient();

prisma.$on('warn', (event) => logger.warn({ prisma: event }, 'prisma warning'));
prisma.$on('error', (event) => logger.error({ prisma: event }, 'prisma error'));

if (!env.isProduction) globalForPrisma.prisma = prisma;

/** Used by the readiness probe: cheap round-trip that proves the DB answers. */
export async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error({ err: error }, 'database health check failed');
    return false;
  }
}
