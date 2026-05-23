/**
 * Per-job streaming scratchpad.
 *
 * Phase D follow-up: while a chat-response executor is mid-stream it
 * gets a `delta` event every ~50ms and used to do a full
 * read-modify-write of `users/{userId}/threads.json` every 400ms.
 * That's correct under sequential writes but inefficient: the whole
 * threads file (potentially many KB) gets rewritten constantly even
 * though only one in-flight message is changing.
 *
 * The scratchpad decouples the two stores:
 *
 *   - `users/{userId}/jobs/{jobId}.json` holds the live streaming
 *     state for ONE in-flight assistant message. The executor rewrites
 *     this small file every 400ms.
 *   - `users/{userId}/threads.json` is only touched on terminal state
 *     (`saveProgressToThread(true)`) when the executor consolidates
 *     the scratchpad into the canonical messages array and deletes
 *     the scratchpad.
 *
 * For UI streaming continuity, the threads GET handler hydrates
 * in-flight messages from the matching scratchpad before returning,
 * so the browser polling `/api/threads/storage` sees the live deltas
 * exactly as it did before. See `hydrateThreadsWithScratchpads`.
 *
 * Tombstone-protected: writes are no-ops when
 * {@link isUserDeleted} is set, matching the same guard
 * `writeThreadsStorage` uses.
 *
 * Retention: stale scratchpad files (>1h since `lastUpdated`) are
 * swept by {@link sweepJobScratchpadsForUser} as a belt-and-braces
 * cleanup when consolidation failed to delete the file.
 *
 * @module storage/scratchpad
 */

import 'server-only';
import {
  deleteFile,
  ensureDir,
  listFiles,
  readFile,
  writeFile,
} from './utils';
import { SAFE_USER_ID } from './user-scope';
import { isUserDeleted } from './tombstone';
import type { Thread, ToolCallEvent } from '@/lib/threads';
import { logger } from '@/lib/logger';

const log = logger.withTag('Scratchpad');

const SAFE_JOB_ID = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * On-disk shape of a per-job scratchpad. Schema is intentionally small —
 * it represents ONE assistant message's in-flight state, not a thread.
 */
export interface JobScratchpad {
  jobId: string;
  threadId: string;
  /** Stable UUID v4 of the assistant message this scratchpad is producing. */
  assistantMessageId: string;
  /** Accumulated `delta.content` so far. May end with the `▊` cursor. */
  content: string;
  /** Captured tool-call events (running + complete), preserved as-is. */
  toolEvents?: ToolCallEvent[];
  /** Cached `detectActionableContent(content)` outcome. */
  hasActionableItem?: boolean;
  status: 'streaming' | 'completed' | 'failed';
  /** ISO timestamp of the most recent write. */
  lastUpdated: string;
}

function subdir(userId: string): string {
  return `users/${userId}/jobs`;
}

function filename(jobId: string): string {
  return `${jobId}.json`;
}

function assertIds(userId: string, jobId: string): void {
  if (!SAFE_USER_ID.test(userId)) {
    throw new Error('scratchpad: unsafe userId');
  }
  if (!SAFE_JOB_ID.test(jobId)) {
    throw new Error('scratchpad: unsafe jobId');
  }
}

/**
 * Write the scratchpad for `jobId`. No-op when the user's deletion
 * tombstone is set (matches `writeThreadsStorage`'s guard). The file
 * is written atomically via `writeFile`'s tmp+rename dance.
 */
export async function writeScratchpad(
  userId: string,
  jobId: string,
  data: Omit<JobScratchpad, 'jobId' | 'lastUpdated'>,
): Promise<void> {
  assertIds(userId, jobId);
  if (await isUserDeleted(userId)) return;
  await ensureDir(subdir(userId), { mode: 0o700 });
  const payload: JobScratchpad = {
    ...data,
    jobId,
    lastUpdated: new Date().toISOString(),
  };
  await writeFile(subdir(userId), filename(jobId), JSON.stringify(payload));
}

/** Read a single scratchpad, or null when none exists. */
export async function readScratchpad(
  userId: string,
  jobId: string,
): Promise<JobScratchpad | null> {
  assertIds(userId, jobId);
  const raw = await readFile(subdir(userId), filename(jobId));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as JobScratchpad;
    if (typeof parsed?.assistantMessageId !== 'string') return null;
    return parsed;
  } catch {
    log.warn(`Could not parse scratchpad ${jobId} for user ${userId}`);
    return null;
  }
}

/** Delete a scratchpad. Idempotent — no error when absent. */
export async function deleteScratchpad(userId: string, jobId: string): Promise<void> {
  assertIds(userId, jobId);
  await deleteFile(subdir(userId), filename(jobId));
}

/**
 * List every scratchpad for a user, indexed by `assistantMessageId` for
 * the hydration path. Bad/corrupt files are skipped silently — the
 * retention sweeper will pick them up.
 */
export async function listScratchpadsByMessageId(
  userId: string,
): Promise<Map<string, JobScratchpad>> {
  if (!SAFE_USER_ID.test(userId)) return new Map();
  const files = await listFiles(subdir(userId));
  const out = new Map<string, JobScratchpad>();
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const raw = await readFile(subdir(userId), file);
    if (raw === null) continue;
    try {
      const parsed = JSON.parse(raw) as JobScratchpad;
      if (typeof parsed?.assistantMessageId !== 'string') continue;
      out.set(parsed.assistantMessageId, parsed);
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * Merge per-job scratchpad state into the canonical threads array so
 * the polling client sees the live in-flight deltas without us
 * touching `threads.json` on every tick. For each thread message whose
 * id matches an active scratchpad's `assistantMessageId`, we replace
 * the message's `content` / `toolEvents` / `hasActionableItem` with
 * the scratchpad values and mark the thread as streaming.
 *
 * Pure: never writes anything. Tolerant of missing scratchpads —
 * returns the input threads unchanged when none exist.
 */
export async function hydrateThreadsWithScratchpads(
  userId: string,
  threads: Thread[],
): Promise<Thread[]> {
  if (threads.length === 0) return threads;
  const scratchpads = await listScratchpadsByMessageId(userId);
  if (scratchpads.size === 0) return threads;

  return threads.map((thread) => {
    let touched = false;
    const messages = thread.messages.map((m) => {
      if (m.role !== 'assistant') return m;
      const sp = scratchpads.get(m.id);
      if (!sp) return m;
      touched = true;
      const isFinal = sp.status !== 'streaming';
      return {
        ...m,
        content: sp.content + (isFinal ? '' : ' ▊'),
        toolEvents: sp.toolEvents && sp.toolEvents.length > 0 ? sp.toolEvents : m.toolEvents,
        hasActionableItem: sp.hasActionableItem ?? m.hasActionableItem,
      };
    });
    if (!touched) return thread;
    return {
      ...thread,
      messages,
      isStreaming: true,
    };
  });
}
