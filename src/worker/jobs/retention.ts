/**
 * Worker-side job-record retention sweepers.
 *
 * These three sweepers operate exclusively on `BackgroundJob` records
 * via `jobStorage`. They are kept in the worker tree (and away from
 * `@/lib/storage/user-retention`) because once the dispatch flip in
 * Phase 2B.2 lands, the worker becomes the sole writer of the jobs
 * store and these sweeps must run inside the worker process.
 *
 * Each function accepts an explicit `nowMs` where applicable and
 * returns aggregate counts so the cron handler never inspects raw
 * user content.
 *
 * @module worker/jobs/retention
 */

import 'server-only';
import { jobStorage } from '@/lib/jobs';
import { logger } from '@/lib/logger';

const log = logger.withTag('RetentionJobs');

/** Default TTL for stale running/pending jobs (6 hours). */
const staleRunningMs = 6 * 60 * 60 * 1000;

export interface SweepResult {
  deleted: number;
  inspected: number;
}

function parseTimestamp(input: unknown): number | null {
  if (typeof input !== 'string' || input.length === 0) return null;
  const ms = Date.parse(input);
  return Number.isFinite(ms) ? ms : null;
}

function isTerminalStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'failed';
}

/**
 * Mark `pending` / `running` jobs that have not progressed in
 * `staleRunningMs` as failed.
 */
export async function sweepStaleRunningJobs(
  nowMs: number,
  ttlMs: number = staleRunningMs,
): Promise<SweepResult> {
  const all = await jobStorage.getAll();
  let deleted = 0;
  let inspected = 0;
  for (const job of all) {
    if (job.status !== 'pending' && job.status !== 'running') continue;
    inspected += 1;
    const reference =
      job.status === 'running' ? job.startedAt ?? job.createdAt : job.createdAt;
    const ts = parseTimestamp(reference);
    if (ts === null) continue;
    if (nowMs - ts <= ttlMs) continue;
    await jobStorage.markFailed(
      job.id,
      `Job exceeded stale-running TTL (${Math.round(ttlMs / 60000)} min) — assumed dead.`,
      'unknown',
    );
    deleted += 1;
  }
  if (deleted > 0) {
    log.info(`[retention] marked ${deleted} stale running jobs as failed`);
  }
  return { deleted, inspected };
}

/**
 * Remove orphan `BackgroundJob` records that lack a `userId`.
 */
export async function sweepOrphanJobs(): Promise<SweepResult> {
  const all = await jobStorage.getAll();
  let deleted = 0;
  for (const job of all) {
    if (job.userId) continue;
    await jobStorage.delete(job.id);
    deleted += 1;
  }
  if (deleted > 0) {
    log.info(`[retention] deleted ${deleted} orphan jobs (no userId)`);
  }
  return { deleted, inspected: all.length };
}

function needsInputRedaction(input: Record<string, unknown> | undefined): boolean {
  return typeof input?.prompt === 'string' && input.prompt !== '[redacted]';
}

function isRedactedResult(result: unknown): boolean {
  return typeof result === 'object' && result !== null && '__redacted' in result;
}

function needsResultRedaction(result: unknown): boolean {
  return Boolean(result && !isRedactedResult(result));
}

function redactJobInput(input: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!input) return input;
  return {
    ...input,
    prompt: '[redacted]',
  };
}

function redactJobResult<T>(result: T, nowMs: number): T {
  return result
    ? ({ __redacted: true, redactedAt: new Date(nowMs).toISOString() } as T)
    : result;
}

// Indirection so test harness can stub if needed; production just uses Date.now.
function nowMsForUpdate(): number {
  return Date.now();
}

/**
 * Overwrite raw prompt/result content on terminal jobs so the existing
 * 1h-until-delete window in `jobStorage.cleanup()` only ever holds
 * `[redacted]` placeholders.
 */
export async function redactTerminalJobs(): Promise<SweepResult> {
  const all = await jobStorage.getAll();
  let redacted = 0;
  for (const job of all) {
    if (!isTerminalStatus(job.status)) continue;
    const input = job.input as Record<string, unknown> | undefined;
    const result = job.result as unknown;
    if (!needsInputRedaction(input) && !needsResultRedaction(result)) continue;
    await jobStorage.update(job.id, {
      input: redactJobInput(input),
      result: redactJobResult(result, nowMsForUpdate()),
    });
    redacted += 1;
  }
  if (redacted > 0) {
    log.info(`[retention] redacted ${redacted} terminal jobs`);
  }
  return { deleted: redacted, inspected: all.length };
}
