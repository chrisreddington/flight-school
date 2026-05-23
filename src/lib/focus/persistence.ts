import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import { logger } from '@/lib/logger';
import type { FocusStorageSchema } from './types';

const log = logger.withTag('FocusPersistence');
const STORAGE_ROUTE = '/api/focus/storage';
const EMPTY_SCHEMA: FocusStorageSchema = { history: {} };

function transientNetworkMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const message = error.message;
  return error.name === 'AbortError' || ['Load failed', 'Failed to fetch'].includes(message) || message.startsWith('NetworkError')
    ? message
    : null;
}

export async function readFocusStorage(): Promise<FocusStorageSchema> {
  if (typeof window === 'undefined') return EMPTY_SCHEMA;
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
  await apiDelete<void>(STORAGE_ROUTE);
}
