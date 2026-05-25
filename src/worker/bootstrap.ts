/**
 * Worker entrypoint.
 *
 * Top-level imports are LIMITED to Node builtins so that importing this
 * file from a smoke runner is side-effect free. All real work — OTel
 * start, handler-graph load, server listen — happens inside `main()`,
 * which only runs when this module is the process entrypoint
 * (`isMainEntry()`).
 *
 * Why the dance: Node ESM evaluates static imports before any code
 * runs. If we statically imported `./server-main`, the handler graph
 * would load `@opentelemetry/api`, `undici`, and `http` BEFORE OTel
 * SDK patches register, producing missing or partial HTTP spans.
 * Dynamic imports inside `main()` order the OTel start ahead of those
 * loads.
 */

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function isMainEntry(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(resolve(fileURLToPath(import.meta.url))) === realpathSync(resolve(argv1));
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const { startWorkerOtel } = await import('./lifecycle/otel');
  await startWorkerOtel();
  const { runWorker } = await import('./server-main');
  await runWorker();
}

if (isMainEntry()) {
  await main();
}

export { main, isMainEntry };
