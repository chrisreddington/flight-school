import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import { logger } from '@/lib/logger';
import type { FocusStorageSchema } from './types';

const log = logger.withTag('FocusPersistence');
const STORAGE_ROUTE = '/api/focus/storage';
const EMPTY_SCHEMA: FocusStorageSchema = { history: {} };

/**
 * In-flight request dedup. Multiple components mounting concurrently
 * (Dashboard subtrees, StrictMode double-invoke) frequently call
 * `readFocusStorage` / `writeFocusStorage` in the same tick, producing
 * duplicate `/api/focus/storage` traces and an avoidable GET/POST race.
 *
 * Reads and deletes are safely coalesced — same key, same result. Writes
 * are deliberately NOT deduped because two concurrent saves may carry
 * different payloads.
 */
const inflight = new Map<string, Promise<unknown>>();

function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = fn().finally(() => {
    if (inflight.get(key) === promise) {
      inflight.delete(key);
    }
  });
  inflight.set(key, promise);
  return promise;
}

function transientNetworkMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const message = error.message;
  return error.name === 'AbortError' || ['Load failed', 'Failed to fetch'].includes(message) || message.startsWith('NetworkError')
    ? message
    : null;
}

export async function readFocusStorage(): Promise<FocusStorageSchema> {
  if (typeof window === 'undefined') return EMPTY_SCHEMA;
  return dedupe('read', async () => {
    try {
      return await apiGet<FocusStorageSchema>(STORAGE_ROUTE);
    } catch (error) {
      const transientMessage = transientNetworkMessage(error);
      if (transientMessage) {
        log.warn('Storage read skipped (network unavailable)', transientMessage);
        return EMPTY_SCHEMA;
      }
      log.error('Failed to load focus storage, using empty schema', error);
      return EMPTY_SCHEMA;
    }
  });
}

export async function writeFocusStorage(schema: FocusStorageSchema): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await apiPost<void>(STORAGE_ROUTE, schema);
  } catch (error) {
    const transientMessage = transientNetworkMessage(error);
    if (transientMessage) {
      log.warn('Storage save skipped (network unavailable)', transientMessage);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    log.error('Failed to save to storage', message);
    throw error;
  }
}
export async function clearFocusStorage(): Promise<void> {
  if (typeof window === 'undefined') return;
  await dedupe('clear', () => apiDelete<void>(STORAGE_ROUTE));
}
