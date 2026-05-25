/**
 * Worker-local durable activity store.
 *
 * The activity bus (`activity-bus.ts`) holds the authoritative
 * in-memory ring buffer for live SSE delivery. This module persists
 * those events to disk under `users/{userId}/activity/events.json`
 * so that a worker restart can re-hydrate recent activity for a
 * returning client. It is **not** used as a cross-process channel
 * any more — the web tier never reads this file. The only consumer
 * is the worker singleton in `logger-worker.ts`.
 */

import { logger } from '@/lib/logger';
import { deleteFile, ensureDir, readFile, writeFile } from '@/lib/storage/utils';
import type { AIActivityEvent } from './types';

const log = logger.withTag('ActivityStore');

const STORE_SUBDIR = (userId: string) => `users/${userId}/activity`;
const STORE_FILE = 'events.json';
const MAX_STORED_EVENTS = 400;

interface StoredActivityEvent
  extends Omit<AIActivityEvent, 'timestamp'> {
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

function parseStorePayload(raw: string | null): ActivityStoreFile {
  if (raw === null || raw.trim().length === 0) {
    return EMPTY_STORE_FILE;
  }

  try {
    const parsed = JSON.parse(raw) as ActivityStoreFile;
    if (!parsed || !Array.isArray(parsed.events)) {
      return EMPTY_STORE_FILE;
    }
    return {
      version: 1,
      events: parsed.events.filter((event) => typeof event?.id === 'string'),
    };
  } catch (error) {
    log.warn('Failed to parse activity store payload', { error });
    return EMPTY_STORE_FILE;
  }
}

async function readStoreFile(userId: string): Promise<ActivityStoreFile> {
  const raw = await readFile(STORE_SUBDIR(userId), STORE_FILE);
  return parseStorePayload(raw);
}

async function writeStoreFile(userId: string, payload: ActivityStoreFile): Promise<void> {
  await ensureDir(STORE_SUBDIR(userId), { mode: 0o700 });
  await writeFile(
    STORE_SUBDIR(userId),
    STORE_FILE,
    JSON.stringify(payload),
  );
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
  void next.catch(() => undefined).finally(() => {
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
    await writeStoreFile(event.userId, {
      version: 1,
      events: trimmed,
    });
  });
}

export async function loadActivityEvents(userId: string): Promise<AIActivityEvent[]> {
  const payload = await readStoreFile(userId);
  return payload.events.map(deserializeEvent);
}

export async function clearActivityEvents(userId: string): Promise<void> {
  await enqueueWrite(userId, async () => {
    await deleteFile(STORE_SUBDIR(userId), STORE_FILE);
  });
}
