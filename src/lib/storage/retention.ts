/**
 * Retention sweepers — pure, time-driven cleanup primitives.
 *
 * This module is the single source of truth for server-side data-retention
 * policy. Each sweeper accepts an explicit `nowMs` for deterministic tests,
 * avoids creating files during cleanup, and returns aggregate counts so the
 * cron handler never needs to inspect raw user content.
 *
 * ## Retention policy (single source of truth — keep in sync with plan.md)
 *
 * | Store                                            | TTL                       |
 * |--------------------------------------------------|---------------------------|
 * | `users/{userId}/threads.json` (per-thread)       | 7d since `updatedAt`      |
 * | `users/{userId}/evaluations.json` (per entry)    | 24h since terminal state  |
 * | `users/{userId}/jobs/{jobId}.json` (scratchpad)  | 1h since `lastUpdated`    |
 * | `BackgroundJob` records (terminal, no scratchpad)| existing 1h delete window |
 * | `BackgroundJob` records (running) considered stale | 6h with no progress     |
 * | Orphan `BackgroundJob` records (no `userId`)     | deleted on next sweep     |
 *
 * Anything that adds a new on-disk prompt/response store must add a sweeper
 * here or an explicit redaction step.
 *
 * @module storage/retention
 */

import 'server-only';
import { deleteFile, listDirs, listFiles, readFile, writeFile } from './utils';
import { SAFE_USER_ID } from './user-scope';
import { jobStorage } from '@/lib/jobs';
import { logger } from '@/lib/logger';

const log = logger.withTag('Retention');

/** Retention TTLs in milliseconds. Exported so tests can assert defaults. */
export const RETENTION_TTL = {
  /** 7 days of inactivity before a thread is swept. */
  threadMs: 7 * 24 * 60 * 60 * 1000,
  /** 24 hours after terminal state before an evaluation entry is swept. */
  evaluationMs: 24 * 60 * 60 * 1000,
  /** 1 hour after `lastUpdated` before a scratchpad is swept. */
  scratchpadMs: 60 * 60 * 1000,
  /** 6 hours of no progress before a `running`/`pending` job is failed. */
  staleRunningMs: 6 * 60 * 60 * 1000,
} as const;

export interface SweepResult {
  /** Number of items deleted from this store. */
  deleted: number;
  /**
   * Number of items inspected (including ones kept). Useful so callers
   * can sanity-check that the sweep actually touched the store, not
   * just for noisy logging.
   */
  inspected: number;
}

interface ThreadShape {
  id: string;
  updatedAt?: string;
}

interface EvaluationShape {
  status: 'pending' | 'streaming' | 'completed' | 'failed' | string;
  updatedAt?: string;
}

interface ScratchpadShape {
  status?: 'pending' | 'streaming' | 'completed' | 'failed' | string;
  lastUpdated?: string;
}

type UserSweepKey = 'threads' | 'evaluations' | 'scratchpads';

function parseTimestamp(input: unknown): number | null {
  if (typeof input !== 'string' || input.length === 0) return null;
  const ms = Date.parse(input);
  return Number.isFinite(ms) ? ms : null;
}

function isOlderThanTtl(timestamp: unknown, nowMs: number, ttlMs: number): boolean {
  const ts = parseTimestamp(timestamp);
  return ts !== null && nowMs - ts > ttlMs;
}

function isTerminalStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'failed';
}

function addSweepResult(target: SweepResult, source: SweepResult): void {
  target.deleted += source.deleted;
  target.inspected += source.inspected;
}

/**
 * Sweep individual threads for a single user whose `updatedAt` is older
 * than the threads TTL. If every thread in the file is stale, the file
 * itself is removed so the directory listing stays clean.
 *
 * Reads use {@link readFile} (returns null on ENOENT) — running this
 * over a `users/{userId}/` that has never held threads is a no-op.
 */
export async function sweepThreadsForUser(
  userId: string,
  nowMs: number,
  ttlMs: number = RETENTION_TTL.threadMs,
): Promise<SweepResult> {
  if (!SAFE_USER_ID.test(userId)) {
    return { deleted: 0, inspected: 0 };
  }
  const raw = await readFile(`users/${userId}`, 'threads.json');
  if (raw === null) return { deleted: 0, inspected: 0 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log.warn(`[retention] Could not parse threads.json for ${userId} — skipping`);
    return { deleted: 0, inspected: 0 };
  }

  const threads = Array.isArray((parsed as { threads?: unknown }).threads)
    ? ((parsed as { threads: ThreadShape[] }).threads)
    : [];
  const inspected = threads.length;

  const kept = threads.filter((t) => {
    return !isOlderThanTtl(t.updatedAt, nowMs, ttlMs);
  });

  const deleted = inspected - kept.length;
  if (deleted === 0) return { deleted: 0, inspected };

  if (kept.length === 0) {
    await deleteFile(`users/${userId}`, 'threads.json');
    log.info(`[retention] swept all ${inspected} threads for user ${userId}`);
  } else {
    await writeFile(
      `users/${userId}`,
      'threads.json',
      JSON.stringify({ threads: kept }, null, 2),
    );
    log.info(`[retention] swept ${deleted}/${inspected} threads for user ${userId}`);
  }
  return { deleted, inspected };
}

/**
 * Sweep evaluation entries whose terminal state is older than the
 * evaluation TTL. `pending` / `streaming` entries are never swept here
 * — they're handled by {@link sweepStaleRunningJobs} on the matching
 * job record.
 */
async function sweepEvaluationsForUser(
  userId: string,
  nowMs: number,
  ttlMs: number = RETENTION_TTL.evaluationMs,
): Promise<SweepResult> {
  if (!SAFE_USER_ID.test(userId)) {
    return { deleted: 0, inspected: 0 };
  }
  const raw = await readFile(`users/${userId}`, 'evaluations.json');
  if (raw === null) return { deleted: 0, inspected: 0 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log.warn(`[retention] Could not parse evaluations.json for ${userId} — skipping`);
    return { deleted: 0, inspected: 0 };
  }

  const root = parsed as { evaluations?: Record<string, EvaluationShape>; version?: number };
  const evaluations = root.evaluations && typeof root.evaluations === 'object'
    ? root.evaluations
    : {};
  const ids = Object.keys(evaluations);
  const inspected = ids.length;

  const kept: Record<string, EvaluationShape> = {};
  let deleted = 0;
  for (const id of ids) {
    const entry = evaluations[id];
    if (isTerminalStatus(entry.status) && isOlderThanTtl(entry.updatedAt, nowMs, ttlMs)) {
      deleted += 1;
      continue;
    }
    kept[id] = entry;
  }

  if (deleted === 0) return { deleted: 0, inspected };

  if (Object.keys(kept).length === 0) {
    await deleteFile(`users/${userId}`, 'evaluations.json');
  } else {
    await writeFile(
      `users/${userId}`,
      'evaluations.json',
      JSON.stringify({ evaluations: kept, version: root.version ?? 1 }, null, 2),
    );
  }
  log.info(`[retention] swept ${deleted}/${inspected} evaluations for user ${userId}`);
  return { deleted, inspected };
}

/**
 * Sweep streaming-scratchpad files (Phase D) at
 * `users/{userId}/jobs/{jobId}.json` whose `lastUpdated` is older than
 * the scratchpad TTL. Belt-and-braces in case the in-process
 * consolidation step on terminal state failed to delete the file.
 */
async function sweepJobScratchpadsForUser(
  userId: string,
  nowMs: number,
  ttlMs: number = RETENTION_TTL.scratchpadMs,
): Promise<SweepResult> {
  if (!SAFE_USER_ID.test(userId)) {
    return { deleted: 0, inspected: 0 };
  }
  const subdir = `users/${userId}/jobs`;
  const files = await listFiles(subdir);
  const inspected = files.length;
  if (inspected === 0) return { deleted: 0, inspected: 0 };

  let deleted = 0;
  for (const filename of files) {
    if (!filename.endsWith('.json')) continue;
    const raw = await readFile(subdir, filename);
    if (raw === null) continue;
    let parsed: ScratchpadShape;
    try {
      parsed = JSON.parse(raw) as ScratchpadShape;
    } catch {
      continue;
    }
    if (!isOlderThanTtl(parsed.lastUpdated, nowMs, ttlMs)) continue;
    await deleteFile(subdir, filename);
    deleted += 1;
  }
  if (deleted > 0) {
    log.info(`[retention] swept ${deleted}/${inspected} scratchpads for user ${userId}`);
  }
  return { deleted, inspected };
}

/**
 * Mark `pending` / `running` jobs that have not progressed in
 * `staleRunningMs` as failed. Covers the crashed-executor case where
 * an in-flight job leaves both a job record and a scratchpad in a
 * non-terminal state forever.
 *
 * Picks `startedAt` for `running` jobs (falls back to `createdAt`) and
 * `createdAt` for `pending` jobs.
 */
export async function sweepStaleRunningJobs(
  nowMs: number,
  ttlMs: number = RETENTION_TTL.staleRunningMs,
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
 * Remove orphan `BackgroundJob` records that lack a `userId`. These
 * can only exist from pre-Phase-A persisted state and are
 * unattributable, so users can never reach them via any GET endpoint.
 * Deleting them on the next sweep is safe and removes the stale rows.
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

/**
 * Overwrite raw prompt/result content on terminal jobs so the existing
 * 1h-until-delete window in `jobStorage.cleanup()` only ever holds
 * `[redacted]` placeholders. Runs every sweep so we don't depend on a
 * new job arriving to trigger {@link jobStorage}'s opportunistic
 * cleanup.
 *
 * Status / error / timing / errorCode are preserved so debugging and
 * client-side reconciliation still work.
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

// Indirection so test harness can stub if needed; production just uses Date.now.
function nowMsForUpdate(): number {
  return Date.now();
}

/**
 * Run every per-user sweeper for every user directory on disk.
 * Filters dirnames through {@link SAFE_USER_ID} as defense in depth
 * against unexpected names appearing under the storage root.
 */
export async function sweepAllUsers(
  nowMs: number,
): Promise<Record<UserSweepKey, SweepResult>> {
  const userDirs = await listDirs('users');
  const aggregate: Record<UserSweepKey, SweepResult> = {
    threads: { deleted: 0, inspected: 0 },
    evaluations: { deleted: 0, inspected: 0 },
    scratchpads: { deleted: 0, inspected: 0 },
  };
  for (const userId of userDirs) {
    if (!SAFE_USER_ID.test(userId)) {
      log.warn(`[retention] skipping unsafe user-dir name`);
      continue;
    }
    const t = await sweepThreadsForUser(userId, nowMs);
    addSweepResult(aggregate.threads, t);
    const e = await sweepEvaluationsForUser(userId, nowMs);
    addSweepResult(aggregate.evaluations, e);
    const s = await sweepJobScratchpadsForUser(userId, nowMs);
    addSweepResult(aggregate.scratchpads, s);
  }
  return aggregate;
}
