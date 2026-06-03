/**
 * Worker-local durable activity store.
 *
 * The activity bus (`activity-bus.ts`) holds the authoritative in-memory ring
 * buffer for live SSE delivery. This module persists those events to the
 * envelope {@link import('@/lib/storage/document-store/scoped-store').getUserScopedStoreForUser}
 * store under the `'activity'` container (singleton document `current`) so a
 * worker restart can re-hydrate recent activity for a returning client. It is
 * **not** a cross-process channel — the web tier never reads it. The only
 * consumer is the worker singleton in `logger-worker.ts`.
 *
 * Unlike the migratable singletons (skills, habits, threads, …) activity is a
 * disposable rehydration cache, so it is deliberately **absent** from
 * `FILENAME_TO_CONTAINER` / `MIGRATABLE_SINGLETON_FILENAMES`: it talks to the
 * store directly rather than through `createSingletonRepo`, keeps its bespoke
 * per-user write mutex + 400-event ring buffer, and abandons (does not migrate)
 * the legacy `users/{userId}/activity/events.json` file.
 *
 * This module is **worker-reached**. Because a user can delete their account
 * while the worker is still persisting, writes swallow {@link UserDeletedError}
 * — the store refuses the write for a tombstoned user and we silently abort.
 *
 * @module copilot/activity/activity-store
 */

import { getUserScopedStoreForUser } from '@/lib/storage/document-store/scoped-store';
import { SINGLETON_DOCUMENT_ID } from '@/lib/storage/document-store/types';
import { UserDeletedError } from '@/lib/storage/document-store/user-scoped-store';
import { logger } from '@/lib/logger';
import type { AIActivityEvent } from './types';

const log = logger.withTag('ActivityStore');

const ACTIVITY_CONTAINER = 'activity';
const MAX_STORED_EVENTS = 400;

interface StoredActivityEvent extends Omit<AIActivityEvent, 'timestamp'> {
  timestamp: string;
}

interface ActivityStoreFile {
  version: 1;
  events: StoredActivityEvent[];
}

const EMPTY_STORE_FILE: ActivityStoreFile = {
  version: 1,
  events: [],
};

function serializeEvent(event: AIActivityEvent): StoredActivityEvent {
  return {
    ...event,
    timestamp: event.timestamp.toISOString(),
  };
}

function deserializeEvent(event: StoredActivityEvent): AIActivityEvent {
  return {
    ...event,
    timestamp: new Date(event.timestamp),
  };
}

function coerceStorePayload(raw: ActivityStoreFile | null): ActivityStoreFile {
  if (!raw || !Array.isArray(raw.events)) {
    return EMPTY_STORE_FILE;
  }
  return {
    version: 1,
    events: raw.events.filter((event) => typeof event?.id === 'string'),
  };
}

async function readStoreFile(userId: string): Promise<ActivityStoreFile> {
  const store = await getUserScopedStoreForUser(userId);
  const raw = await store.get<ActivityStoreFile>(ACTIVITY_CONTAINER, SINGLETON_DOCUMENT_ID);
  return coerceStorePayload(raw);
}

async function writeStoreFile(userId: string, payload: ActivityStoreFile): Promise<void> {
  const store = await getUserScopedStoreForUser(userId);
  await store.put<ActivityStoreFile>(ACTIVITY_CONTAINER, SINGLETON_DOCUMENT_ID, payload);
}

/**
 * Per-user write serialization. The store is read-modify-write and the
 * worker fires multiple persists concurrently (create, patch, metrics).
 * Without this mutex, concurrent writers can lose updates.
 *
 * We chain each user's writes through a single promise so writes for
 * different users still run in parallel.
 */
const writeChains = new Map<string, Promise<void>>();

function enqueueWrite(userId: string, task: () => Promise<void>): Promise<void> {
  const prev = writeChains.get(userId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  writeChains.set(userId, next);
  // Best-effort cleanup so the map doesn't grow unbounded.
  void next
    .catch(() => undefined)
    .finally(() => {
      if (writeChains.get(userId) === next) {
        writeChains.delete(userId);
      }
    });
  return next;
}

export async function appendActivityEvent(event: AIActivityEvent): Promise<void> {
  await enqueueWrite(event.userId, async () => {
    const current = await readStoreFile(event.userId);
    const serialized = serializeEvent(event);

    const nextEvents = [...current.events];
    const existingIndex = nextEvents.findIndex((storedEvent) => storedEvent.id === event.id);
    if (existingIndex >= 0) {
      nextEvents[existingIndex] = serialized;
    } else {
      nextEvents.push(serialized);
    }

    const trimmed = nextEvents.slice(-MAX_STORED_EVENTS);
    try {
      await writeStoreFile(event.userId, { version: 1, events: trimmed });
    } catch (error) {
      if (error instanceof UserDeletedError) return;
      throw error;
    }
  });
}

export async function loadActivityEvents(userId: string): Promise<AIActivityEvent[]> {
  const payload = await readStoreFile(userId);
  return payload.events.map(deserializeEvent);
}

export async function clearActivityEvents(userId: string): Promise<void> {
  await enqueueWrite(userId, async () => {
    try {
      const store = await getUserScopedStoreForUser(userId);
      await store.remove(ACTIVITY_CONTAINER, SINGLETON_DOCUMENT_ID);
    } catch (error) {
      // Idempotent best-effort: a missing doc or a deleted user is a no-op.
      log.warn('Failed to clear activity events', { error });
    }
  });
}
