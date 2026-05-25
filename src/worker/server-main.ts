/**
 * Worker server bootstrap.
 *
 * Owns the boot sequence:
 *   1. assert `COPILOT_WORKER_SECRET` is configured (exit non-zero if not)
 *   2. run restart-sweep (mark stranded jobs as failed)
 *   3. start HTTP listener
 *   4. fire-and-forget Copilot warmup
 *   5. register graceful-shutdown handlers
 *
 * Imported dynamically from `bootstrap.ts` AFTER OTel SDK start so HTTP
 * instrumentations patch their targets before `@hono/node-server` and
 * the handler graph load `http` / `undici`.
 */

import { serve } from '@hono/node-server';

import { logger } from '@/lib/logger';

import { assertWorkerSecretConfigured } from './http/auth';
import { createWorkerApp } from './http/app';
import { runRestartSweep } from './lifecycle/restart-sweep';
import { registerShutdownHandlers } from './lifecycle/shutdown';
import { warmCopilotClientForWorker } from './lifecycle/warmup';

const log = logger.withTag('Worker');

export async function runWorker(): Promise<void> {
  assertWorkerSecretConfigured();

  await runRestartSweep();

  // Prefer `PORT` (the ACA/Container-Apps convention) over the worker-specific
  // override; default to 3001 to match `Dockerfile.worker` EXPOSE and the
  // Aspire AppHost endpoint. Honouring `PORT` keeps the worker container
  // hosting-agnostic — ACA passes `PORT` to every container without knowing
  // the app's internal naming.
  const port = Number.parseInt(
    process.env.PORT ?? process.env.COPILOT_WORKER_PORT ?? '3001',
    10,
  );
  const app = createWorkerApp();

  const server = serve({ fetch: app.fetch, port }) as unknown as import('node:http').Server;

  // SSE budget: each stream may live up to ~5 minutes; keep the socket
  // open longer than the longest expected stream. `requestTimeout = 0`
  // disables Node's per-request timeout — SSE heartbeats keep the
  // connection liveness in check.
  server.keepAliveTimeout = 310_000;
  server.headersTimeout = 320_000;
  server.requestTimeout = 0;

  log.info(`Worker listening on :${port}`);

  void warmCopilotClientForWorker();

  registerShutdownHandlers(server);
}
