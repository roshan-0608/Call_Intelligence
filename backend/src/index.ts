import { createApp } from './app.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { prisma } from './db/index.js';

/**
 * Process entry point: bind the port, then shut down cleanly.
 *
 * Graceful shutdown matters on the platforms this deploys to — both Render and
 * Fly send SIGTERM before replacing a container, and exiting without draining
 * in-flight requests turns every deploy into a handful of 502s.
 */
const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(
    {
      port: env.PORT,
      env: env.NODE_ENV,
      model: env.LLM_MODEL,
      promptVersion: env.PROMPT_VERSION,
      uploadsEnabled: Boolean(env.GROQ_API_KEY),
      corsOrigins: env.corsOrigins,
    },
    'API listening',
  );

  if (!env.GROQ_API_KEY) {
    logger.warn('GROQ_API_KEY is not set: /upload will return 503. Reads are unaffected.');
  }
});

/** Stop accepting connections, finish what is in flight, then close the pool. */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');

  const forceExit = setTimeout(() => {
    logger.error('shutdown timed out after 10s; exiting');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async (error) => {
    if (error) logger.error({ err: error }, 'error closing server');
    await prisma.$disconnect().catch((disconnectError) => {
      logger.error({ err: disconnectError }, 'error disconnecting prisma');
    });
    clearTimeout(forceExit);
    process.exit(error ? 1 : 0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// An unhandled rejection leaves the process in an unknown state; log loudly and
// let the platform restart it rather than limping on.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled rejection');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaught exception');
  process.exit(1);
});
