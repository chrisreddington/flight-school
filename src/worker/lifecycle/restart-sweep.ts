/**
 * Worker restart-sweep.
 *
 * On boot, every job in `pending`/`running` state must have been left
 * stranded by the previous worker process — single-replica invariant.
 * Mark each as failed and clear any `isStreaming: true` chat threads
 * (which would otherwise render a stuck cursor in the UI indefinitely).
 *
 * `WORKER_SKIP_RESTART_SWEEP=1` is a tiny escape hatch for parallel-
 * validation harnesses that boot a second worker; in normal single-
 * replica deploys the sweep is always required for stuck-job recovery.
 */

import { logger } from '@/lib/logger';

const log = logger.withTag('WorkerRestartSweep');

export async function runRestartSweep(): Promise<void> {
  if (process.env.WORKER_SKIP_RESTART_SWEEP === '1') {
    log.info('Restart-sweep skipped via WORKER_SKIP_RESTART_SWEEP=1');
    return;
  }

  try {
    const { jobStorage } = await import('@/lib/jobs');
    const jobs = await jobStorage.getAll();
    const staleJobs = jobs.filter((job) => job.status === 'pending' || job.status === 'running');

    await Promise.all(staleJobs.map((job) => jobStorage.markFailed(job.id, 'Server process restarted')));

    const staleChatJobs = staleJobs.filter((job) => job.type === 'chat-response');
    if (staleChatJobs.length > 0) {
      const [{ getThreadById, updateThread }, { stripLegacyCursorFromThread }] = await Promise.all([
        import('@/lib/jobs/storage/threads-storage'),
        import('@/lib/threads/legacy-cursor'),
      ]);
      await Promise.all(
        staleChatJobs.map(async (job) => {
          const input = (job.input ?? {}) as {
            threadId?: string;
            assistantMessageId?: string;
          };
          if (!input.threadId || !job.userId) return;
          try {
            const thread = await getThreadById(job.userId, input.threadId);
            if (!thread) return;
            const stripped = stripLegacyCursorFromThread(thread);
            const needsUpdate = stripped !== thread || thread.isStreaming === true;
            if (needsUpdate) {
              await updateThread(job.userId, {
                ...stripped,
                isStreaming: false,
                updatedAt: new Date().toISOString(),
              });
            }
          } catch (err) {
            log.warn('Failed to clear stale chat thread state', {
              err,
              jobId: job.id,
              threadId: input.threadId,
            });
          }
        }),
      );
    }

    if (staleJobs.length > 0) {
      log.info(
        `Marked ${staleJobs.length} stale jobs as failed on startup (` +
          `${staleChatJobs.length} chat threads cleared)`,
      );
    }
  } catch (err) {
    log.warn('Failed to mark stale jobs on startup', { err });
  }
}
