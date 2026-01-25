import { logger } from '@/lib/logger';
import { deleteFile, ensureDir, readFile, writeFile } from '@/lib/storage/utils';
import { now, nowMs } from '@/lib/utils/date-utils';

const log = logger.withTag('ActiveStream');

const ACTIVE_STREAM_DIR = 'active-streams';
const ACTIVE_STREAM_TTL_MS = 5 * 60 * 1000;

export type ActiveStreamStatus = 'streaming' | 'completed' | 'failed';

export interface ActiveStreamEntry {
  jobId: string;
  threadId: string;
  content: string;
  status: ActiveStreamStatus;
  updatedAt: string;
}

type ActiveStreamSubscriber = (entry: ActiveStreamEntry | null) => void;

const activeStreams = new Map<string, ActiveStreamEntry>();
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
const subscribers = new Map<string, Set<ActiveStreamSubscriber>>();

function isTerminalStatus(status: ActiveStreamStatus): boolean {
  return status === 'completed' || status === 'failed';
}

function isExpired(entry: ActiveStreamEntry, currentTimeMs: number): boolean {
  if (!isTerminalStatus(entry.status)) {
    return false;
  }
  const updatedAtMs = Date.parse(entry.updatedAt);
  if (Number.isNaN(updatedAtMs)) {
    return true;
  }
  return currentTimeMs - updatedAtMs > ACTIVE_STREAM_TTL_MS;
}

function getStreamFilename(jobId: string): string {
  return `${jobId}.json`;
}

function notifySubscribers(jobId: string, entry: ActiveStreamEntry | null): void {
  const callbacks = subscribers.get(jobId);
  if (!callbacks) return;
  for (const callback of callbacks) {
    try {
      callback(entry);
    } catch (error) {
      log.warn('Subscriber callback failed', { error });
    }
  }
}

function clearCleanupTimer(jobId: string): void {
  const timer = cleanupTimers.get(jobId);
  if (timer) {
    clearTimeout(timer);
    cleanupTimers.delete(jobId);
  }
}

async function removeActiveStream(jobId: string): Promise<void> {
  activeStreams.delete(jobId);
  clearCleanupTimer(jobId);
  await deleteFile(ACTIVE_STREAM_DIR, getStreamFilename(jobId));
  notifySubscribers(jobId, null);
}

function scheduleCleanup(entry: ActiveStreamEntry): void {
  clearCleanupTimer(entry.jobId);
  if (!isTerminalStatus(entry.status)) {
    return;
  }
  cleanupTimers.set(
    entry.jobId,
    setTimeout(() => {
      void removeActiveStream(entry.jobId);
    }, ACTIVE_STREAM_TTL_MS)
  );
}

async function loadStreamFromDisk(jobId: string): Promise<ActiveStreamEntry | null> {
  await ensureDir(ACTIVE_STREAM_DIR);
  const fileContent = await readFile(ACTIVE_STREAM_DIR, getStreamFilename(jobId));
  if (!fileContent) {
    return null;
  }
  try {
    const parsed = JSON.parse(fileContent) as ActiveStreamEntry;
    if (
      typeof parsed.jobId !== 'string' ||
      typeof parsed.threadId !== 'string' ||
      typeof parsed.content !== 'string' ||
      typeof parsed.status !== 'string' ||
      typeof parsed.updatedAt !== 'string'
    ) {
      await deleteFile(ACTIVE_STREAM_DIR, getStreamFilename(jobId));
      return null;
    }
    return parsed;
  } catch (error) {
    log.warn('Failed to parse active stream file, deleting', { error, jobId });
    await deleteFile(ACTIVE_STREAM_DIR, getStreamFilename(jobId));
    return null;
  }
}

function normalizeEntry(entry: ActiveStreamEntry): ActiveStreamEntry {
  return {
    ...entry,
    updatedAt: entry.updatedAt || now(),
  };
}

export async function setActiveStream(entry: ActiveStreamEntry): Promise<void> {
  const normalized = normalizeEntry(entry);
  activeStreams.set(normalized.jobId, normalized);
  scheduleCleanup(normalized);
  await ensureDir(ACTIVE_STREAM_DIR);
  await writeFile(
    ACTIVE_STREAM_DIR,
    getStreamFilename(normalized.jobId),
    JSON.stringify(normalized, null, 2)
  );
  notifySubscribers(normalized.jobId, normalized);
}

export async function getActiveStream(jobId: string): Promise<ActiveStreamEntry | null> {
  const cached = activeStreams.get(jobId);
  const currentTime = nowMs();
  if (cached) {
    if (isExpired(cached, currentTime)) {
      await removeActiveStream(jobId);
      return null;
    }
    return cached;
  }

  const loaded = await loadStreamFromDisk(jobId);
  if (!loaded) {
    return null;
  }
  if (isExpired(loaded, currentTime)) {
    await removeActiveStream(jobId);
    return null;
  }
  activeStreams.set(jobId, loaded);
  scheduleCleanup(loaded);
  return loaded;
}

export function watchActiveStream(jobId: string, callback: ActiveStreamSubscriber): () => void {
  if (!subscribers.has(jobId)) {
    subscribers.set(jobId, new Set());
  }
  subscribers.get(jobId)!.add(callback);
  void getActiveStream(jobId)
    .then((entry) => callback(entry))
    .catch((error) => log.warn('Failed to load active stream for subscriber', { error, jobId }));

  return () => {
    const callbacks = subscribers.get(jobId);
    if (!callbacks) return;
    callbacks.delete(callback);
    if (callbacks.size === 0) {
      subscribers.delete(jobId);
    }
  };
}
