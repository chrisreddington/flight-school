/**
 * Worker startup warmup.
 *
 * Triggers a Copilot client warmup so the first user-facing job doesn't
 * pay full SDK init cost on its critical path. Non-fatal — first request
 * will reinitialise if this fails.
 */

import { logger } from '@/lib/logger';

const log = logger.withTag('WorkerWarmup');

export async function warmCopilotClientForWorker(): Promise<void> {
  if (process.env.COPILOT_WARMUP_ON_START === 'false') {
    log.info('Warmup disabled via COPILOT_WARMUP_ON_START=false');
    return;
  }
  try {
    const { warmCopilotClient } = await import('@/lib/copilot/sessions');
    await warmCopilotClient();
    log.info('Copilot client warmed');
  } catch (err) {
    log.warn('Copilot client warmup failed (will init on first request)', { err });
  }
}
