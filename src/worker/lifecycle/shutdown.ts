/**
 * Graceful worker shutdown.
 *
 * On SIGINT / SIGTERM: stop accepting new connections, drain the
 * Copilot session pools, then flush + shut down OTel exporters before
 * exiting. Order matters — if OTel shuts down first the in-flight
 * shutdown spans/metrics never make it to the dashboard.
 */

import type { Server } from 'node:http';

import { logger } from '@/lib/logger';

import { shutdownWorkerOtel } from './otel';

const log = logger.withTag('WorkerShutdown');

export function registerShutdownHandlers(server: Server): void {
  let shuttingDown = false;
  const handle = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${signal}, shutting down...`);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      const { shutdownAllPools } = await import('@/lib/copilot/sessions');
      await shutdownAllPools();
    } catch (err) {
      log.warn('shutdownAllPools failed', { err });
    }
    await shutdownWorkerOtel();
    process.exit(0);
  };
  process.once('SIGINT', () => void handle('SIGINT'));
  process.once('SIGTERM', () => void handle('SIGTERM'));
}
