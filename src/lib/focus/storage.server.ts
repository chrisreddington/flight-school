/**
 * Focus Storage - Server-Only Functions
 *
 * File-per-item storage functions that use Node.js fs module.
 * These are for server-side use only (API routes, background jobs).
 *
 * @remarks
 * This module uses direct file system access and should ONLY be imported
 * in server-side code (API routes, server actions, background jobs).
 * For client-side focus operations, use the `focusStore` from `./storage.ts`
 * which communicates via API routes.
 */

import {
  readFile,
  writeFile,
  ensureDir,
} from '@/lib/storage/utils';
import type { OperationState } from '@/lib/operations/types';
import { logger } from '@/lib/logger';
import { now } from '@/lib/utils/date-utils';
import type {
  DailyChallenge,
  DailyGoal,
  FocusIndexEntry,
  FocusIndexSchema,
  FocusIndexStatus,
  FocusItemFile,
  FocusItemType,
  LearningTopic,
} from './types';

const log = logger.withTag('FocusStore:Server');

// =============================================================================
// File-per-Item Storage API
// =============================================================================

/** Directory for focus item files */
export const FOCUS_STORAGE_DIR = 'focus';

/** Index file name for focus items */
export const FOCUS_INDEX_FILE = 'focus/index.json';

/**
 * Creates a default empty focus index.
 */
function createDefaultIndex(): FocusIndexSchema {
  return {
    version: 1,
    updatedAt: now(),
    items: [],
  };
}

/**
 * Reads the focus index from storage.
 * Returns a default empty index if the file doesn't exist or is invalid.
 */
export async function readFocusIndex(): Promise<FocusIndexSchema> {
  try {
    const content = await readFile(FOCUS_STORAGE_DIR, 'index.json');
    if (!content) {
      return createDefaultIndex();
    }
    const parsed = JSON.parse(content);
    if (typeof parsed.version !== 'number' || !Array.isArray(parsed.items)) {
      log.warn('Invalid focus index schema, using default');
      return createDefaultIndex();
    }
    return parsed as FocusIndexSchema;
  } catch {
    log.warn('Failed to read focus index, using default');
    return createDefaultIndex();
  }
}

/**
 * Writes the focus index to storage.
 */
async function writeFocusIndex(index: FocusIndexSchema): Promise<void> {
  await ensureDir(FOCUS_STORAGE_DIR);
  await writeFile(FOCUS_STORAGE_DIR, 'index.json', JSON.stringify(index, null, 2));
}

/**
 * Generates the filename for a focus item.
 */
function getItemFilename(dateKey: string, type: FocusItemType, itemId: string): string {
  return `${dateKey}/${type}-${itemId}.json`;
}

interface ReadFocusItemOptions {
  dateKey: string;
  type: FocusItemType;
  itemId: string;
}

/**
 * Reads a focus item from storage.
 * Returns null if the item doesn't exist.
 *
 * @param options - The item location (dateKey, type, itemId)
 * @returns The item file or null if not found
 *
 * @example
 * ```typescript
 * const item = await readFocusItem<DailyChallenge>({
 *   dateKey: '2026-01-25',
 *   type: 'challenge',
 *   itemId: 'challenge-123',
 * });
 * if (item) {
 *   console.log(item.data.title, item.metadata.status);
 * }
 * ```
 */
export async function readFocusItem<T>(
  options: ReadFocusItemOptions
): Promise<FocusItemFile<T> | null> {
  const { dateKey, type, itemId } = options;
  const filename = getItemFilename(dateKey, type, itemId);
  
  try {
    const content = await readFile(FOCUS_STORAGE_DIR, filename);
    if (!content) {
      return null;
    }
    return JSON.parse(content) as FocusItemFile<T>;
  } catch {
    log.warn('Failed to read focus item', { dateKey, type, itemId });
    return null;
  }
}

interface WriteFocusItemOptions<T> {
  dateKey: string;
  type: FocusItemType;
  item: T & { id: string };
  status: FocusIndexStatus;
  title: string;
  operationState?: OperationState;
}

/**
 * Writes a focus item to storage and updates the index atomically.
 * Used by operations completion handlers to persist generated content.
 *
 * @param options - The item data and metadata to write
 *
 * @example
 * ```typescript
 * await writeFocusItem<DailyChallenge>({
 *   dateKey: '2026-01-25',
 *   type: 'challenge',
 *   item: { id: 'challenge-123', title: 'Build a rate limiter', ... },
 *   status: 'complete',
 *   title: 'Build a rate limiter',
 *   operationState: { jobId: 'job-456', status: 'complete', startedAt: '...' },
 * });
 * ```
 */
export async function writeFocusItem<T>(
  options: WriteFocusItemOptions<T>
): Promise<void> {
  const { dateKey, type, item, status, title, operationState } = options;
  const itemId = (item as { id: string }).id;
  const filename = getItemFilename(dateKey, type, itemId);
  const timestamp = now();

  // Build the item file
  const itemFile: FocusItemFile<T> = {
    metadata: {
      id: itemId,
      type,
      dateKey,
      status,
      title,
      updatedAt: timestamp,
      operationState,
    },
    data: item,
  };

  // Ensure the date directory exists and write the item
  await ensureDir(`${FOCUS_STORAGE_DIR}/${dateKey}`);
  await writeFile(FOCUS_STORAGE_DIR, filename, JSON.stringify(itemFile, null, 2));

  // Update the index
  const index = await readFocusIndex();
  const existingIndex = index.items.findIndex(
    (entry) => entry.id === itemId && entry.type === type
  );

  const indexEntry: FocusIndexEntry = {
    id: itemId,
    type,
    dateKey,
    status,
    title,
    updatedAt: timestamp,
  };

  if (existingIndex >= 0) {
    index.items[existingIndex] = indexEntry;
  } else {
    index.items.push(indexEntry);
  }

  index.updatedAt = timestamp;
  await writeFocusIndex(index);
  
  log.debug('Focus item written', { dateKey, type, itemId, status });
}

// Re-export types needed by consumers
export type { DailyChallenge, DailyGoal, LearningTopic, FocusItemType, FocusIndexStatus };
