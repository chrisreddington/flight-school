/**
 * Per-user retention sweepers — pure, time-driven cleanup primitives for
 * per-user data held in the envelope {@link DocumentStore}.
 *
 * This module is a no-`jobStorage` peer of `@/worker/jobs/retention`. Both
 * share the same `RETENTION_TTL` table, which is re-exported here as the
 * single source of truth.
 *
 * ## Retention policy
 *
 * | Store                                   | TTL                       |
 * |-----------------------------------------|---------------------------|
 * | threads (per-thread, `threads` container) | 7d since `updatedAt`    |
 * | evaluations (per entry, `evaluations`)    | 24h since terminal state|
 * | `BackgroundJob` records (terminal)        | existing 1h delete window |
 * | `BackgroundJob` records (running) stale   | 6h with no progress     |
 * | Orphan `BackgroundJob` records (no `userId`) | deleted on next sweep |
 *
 * Both per-user stores live in the envelope store now, so the sweep reads and
 * rewrites them through the same domain accessors the app uses
 * ({@link readThreadsStorage} / {@link readEvaluationStorage}) and enumerates
 * active users via the sharded user registry rather than a `users/` directory
 * listing — a user whose data lives only in the SQLite envelope has no such
 * directory.
 *
 * @module storage/user-retention
 */

import 'server-only';
import {
  readEvaluationStorage,
  writeEvaluationStorage,
  type EvaluationProgress,
} from '@/lib/jobs/storage/evaluation-storage';
import { readThreadsStorage, writeThreadsStorage } from '@/lib/jobs/storage/threads-storage';
import { getDocumentStore } from './document-store/factory';
import { collectRegisteredUsers } from './document-store/user-registry';
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

function parseTimestamp(input: unknown): number | null {
  if (typeof input !== 'string' || input.length === 0) return null;
  const ms = Date.parse(input);
  return Number.isFinite(ms) ? ms : null;
}

/** The per-user stores this module sweeps, keying the aggregate result. */
export type UserSweepKey = 'threads' | 'evaluations';

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
 * Sweep individual threads for a single user whose `updatedAt` is older than
 * the threads TTL, rewriting the survivors through the envelope accessor. A
 * user who has never held threads reads back an empty list — a no-op.
 */
async function sweepThreadsForUser(
  userId: string,
  nowMs: number,
  ttlMs: number = RETENTION_TTL.threadMs,
): Promise<SweepResult> {
  if (!SAFE_USER_ID.test(userId)) {
    return { deleted: 0, inspected: 0 };
  }
  const threads = await readThreadsStorage(userId);
  const inspected = threads.length;
  if (inspected === 0) return { deleted: 0, inspected: 0 };

  const kept = threads.filter((thread) => !isOlderThanTtl(thread.updatedAt, nowMs, ttlMs));
  const deleted = inspected - kept.length;
  if (deleted === 0) return { deleted: 0, inspected };

  await writeThreadsStorage(userId, kept);
  log.info(`[retention] swept ${deleted}/${inspected} threads for user ${userId}`);
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
  const storage = await readEvaluationStorage(userId);
  const ids = Object.keys(storage.evaluations);
  const inspected = ids.length;
  if (inspected === 0) return { deleted: 0, inspected: 0 };

  const kept: Record<string, EvaluationProgress> = {};
  let deleted = 0;
  for (const id of ids) {
    const entry = storage.evaluations[id];
    if (isTerminalStatus(entry.status) && isOlderThanTtl(entry.updatedAt, nowMs, ttlMs)) {
      deleted += 1;
      continue;
    }
    kept[id] = entry;
  }

  if (deleted === 0) return { deleted: 0, inspected };

  await writeEvaluationStorage(userId, { evaluations: kept, version: storage.version });
  log.info(`[retention] swept ${deleted}/${inspected} evaluations for user ${userId}`);
  return { deleted, inspected };
}

/**
 * Run every per-user sweeper for every registered user. Enumerates the sharded
 * user registry — the envelope store's active-user index — rather than a
 * `users/` directory listing, which no longer exists for SQLite-only users.
 * Filters userIds through {@link SAFE_USER_ID} as defense in depth.
 */
export async function sweepAllUsers(nowMs: number): Promise<Record<UserSweepKey, SweepResult>> {
  const store = await getDocumentStore();
  const userIds = await collectRegisteredUsers(store);
  const aggregate: Record<UserSweepKey, SweepResult> = {
    threads: { deleted: 0, inspected: 0 },
    evaluations: { deleted: 0, inspected: 0 },
  };
  for (const userId of userIds) {
    if (!SAFE_USER_ID.test(userId)) {
      log.warn(`[retention] skipping unsafe registered userId`);
      continue;
    }
    const threadSweep = await sweepThreadsForUser(userId, nowMs);
    addSweepResult(aggregate.threads, threadSweep);
    const evaluationSweep = await sweepEvaluationsForUser(userId, nowMs);
    addSweepResult(aggregate.evaluations, evaluationSweep);
  }
  return aggregate;
}
