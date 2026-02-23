/**
 * Next.js Instrumentation
 *
 * This file runs on server startup and shutdown.
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

import { logger } from '@/lib/logger';

const log = logger.withTag('Instrumentation');

export async function register(): Promise<void> {
  // Only run on server
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    log.info('Server starting...');
    const shouldWarm = process.env.COPILOT_WARMUP_ON_START !== 'false';
    if (shouldWarm) {
      const { warmCopilotClient, shutdownAllPools } = await import('@/lib/copilot/sessions');
      try {
        await warmCopilotClient();
        log.info('Copilot client warmed');
      } catch (err) {
        // Non-fatal: app works without pre-warmed client; first request will init it
        log.warn('Copilot client warmup failed (will init on first request)', { err });
      }
      
      // Register shutdown handler (once, for SIGINT/SIGTERM)
      const shutdown = async (signal: string) => {
        log.info(`Received ${signal}, shutting down...`);
        await shutdownAllPools();
        process.exit(0);
      };
      
      process.once('SIGINT', () => shutdown('SIGINT'));
      process.once('SIGTERM', () => shutdown('SIGTERM'));
    }
  }
}
