/**
 * Per-user retention sweepers — pure, time-driven cleanup primitives for
 * data stored under `users/{userId}/…`.
 *
 * This module is a no-`jobStorage` peer of `@/worker/jobs/retention`. Both
 * share the same `RETENTION_TTL` table, which is re-exported here as the
 * single source of truth.
 *
 * ## Retention policy
 *
 * | Store                                            | TTL                       |
 * |--------------------------------------------------|---------------------------|
 * | `users/{userId}/threads.json` (per-thread)       | 7d since `updatedAt`      |
 * | `users/{userId}/evaluations.json` (per entry)    | 24h since terminal state  |
 * | `BackgroundJob` records (terminal)               | existing 1h delete window |
 * | `BackgroundJob` records (running) considered stale | 6h with no progress     |
 * | Orphan `BackgroundJob` records (no `userId`)     | deleted on next sweep     |
 *
 * @module storage/user-retention
 */

import 'server-only';
import { deleteFile, listDirs, readFile, writeFile } from './utils';
import { SAFE_USER_ID } from './user-scope';
import { logger } from '@/lib/logger';

const log = logger.withTag('RetentionUser');

/** Retention TTLs in milliseconds. Exported so tests can assert defaults. */
const RETENTION_TTL = {
  /** 7 days of inactivity before a thread is swept. */
  threadMs: 7 * 24 * 60 * 60 * 1000,
  /** 24 hours after terminal state before an evaluation entry is swept. */
  evaluationMs: 24 * 60 * 60 * 1000,
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

export type UserSweepKey = 'threads' | 'evaluations';

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
async function sweepThreadsForUser(
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
    ? (parsed as { threads: ThreadShape[] }).threads
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
    await writeFile(`users/${userId}`, 'threads.json', JSON.stringify({ threads: kept }, null, 2));
    log.info(`[retention] swept ${deleted}/${inspected} threads for user ${userId}`);
  }
  return { deleted, inspected };
}

/**
 * Sweep evaluation entries whose terminal state is older than the
 * evaluation TTL. `pending` / `streaming` entries are never swept here.
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
  const evaluations = root.evaluations && typeof root.evaluations === 'object' ? root.evaluations : {};
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
 * Run every per-user sweeper for every user directory on disk.
 * Filters dirnames through {@link SAFE_USER_ID} as defense in depth
 * against unexpected names appearing under the storage root.
 */
export async function sweepAllUsers(nowMs: number): Promise<Record<UserSweepKey, SweepResult>> {
  const userDirs = await listDirs('users');
  const aggregate: Record<UserSweepKey, SweepResult> = {
    threads: { deleted: 0, inspected: 0 },
    evaluations: { deleted: 0, inspected: 0 },
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
  }
  return aggregate;
}
