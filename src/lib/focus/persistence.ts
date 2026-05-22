import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import { logger } from '@/lib/logger';
import type { FocusStorageSchema } from './types';

const log = logger.withTag('FocusPersistence');
const STORAGE_ROUTE = '/api/focus/storage';

export async function readFocusStorage(): Promise<FocusStorageSchema> {
  if (typeof window === 'undefined') {
    return { history: {} };
  }

  try {
    return await apiGet<FocusStorageSchema>(STORAGE_ROUTE);
  } catch (error) {
    log.error('Failed to load focus storage, using empty schema', error);
    return { history: {} };
  }
}

export async function writeFocusStorage(schema: FocusStorageSchema): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    await apiPost<void>(STORAGE_ROUTE, schema);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isNetworkError =
      error instanceof Error &&
      (error.name === 'AbortError' ||
        message === 'Load failed' ||
        message === 'Failed to fetch' ||
        message.startsWith('NetworkError'));
    if (isNetworkError) {
      log.warn('Storage save skipped (network unavailable)', message);
      return;
    }
    log.error('Failed to save to storage', message);
    throw error;
  }
}

export async function clearFocusStorage(): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }

  await apiDelete<void>(STORAGE_ROUTE);
}
