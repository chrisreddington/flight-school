/**
 * Thread Storage - Server-Only Functions
 *
 * File-per-thread storage functions that use Node.js fs module.
 * These are for server-side use only (API routes, background jobs).
 *
 * @remarks
 * This module uses direct file system access and should ONLY be imported
 * in server-side code (API routes, server actions, background jobs).
 * For client-side thread operations, use the `threadStore` from `./storage.ts`
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
import type { Thread } from './types';

const log = logger.withTag('ThreadStore:Server');

// =============================================================================
// File-per-Thread Storage API
// =============================================================================

/** Directory for thread files */
export const THREADS_STORAGE_DIR = 'threads';

/** Index file name for threads */
export const THREADS_INDEX_FILE = 'threads/index.json';

/**
 * Thread index entry for quick listing.
 */
interface ThreadIndexEntry {
  id: string;
  title: string;
  updatedAt: string;
}

/**
 * Thread index schema.
 */
interface ThreadIndexSchema {
  version: 1;
  updatedAt: string;
  threads: ThreadIndexEntry[];
}

/**
 * Metadata stored alongside each thread file.
 */
interface ThreadMetadata {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  operationState?: OperationState;
}

/**
 * File-based storage envelope for threads.
 */
interface ThreadFile {
  metadata: ThreadMetadata;
  data: Thread;
}

/**
 * Creates a default empty thread index.
 */
function createDefaultThreadIndex(): ThreadIndexSchema {
  return {
    version: 1,
    updatedAt: now(),
    threads: [],
  };
}

/**
 * Reads the thread index from storage.
 * Returns a default empty index if the file doesn't exist or is invalid.
 *
 * @example
 * ```typescript
 * const index = await readThreadIndex();
 * console.log(`Found ${index.threads.length} threads`);
 * ```
 */
export async function readThreadIndex(): Promise<ThreadIndexSchema> {
  try {
    const content = await readFile(THREADS_STORAGE_DIR, 'index.json');
    if (!content) {
      return createDefaultThreadIndex();
    }
    const parsed = JSON.parse(content);
    if (typeof parsed.version !== 'number' || !Array.isArray(parsed.threads)) {
      log.warn('Invalid thread index schema, using default');
      return createDefaultThreadIndex();
    }
    return parsed as ThreadIndexSchema;
  } catch {
    log.warn('Failed to read thread index, using default');
    return createDefaultThreadIndex();
  }
}

/**
 * Writes the thread index to storage.
 */
async function writeThreadIndex(index: ThreadIndexSchema): Promise<void> {
  await ensureDir(THREADS_STORAGE_DIR);
  await writeFile(THREADS_STORAGE_DIR, 'index.json', JSON.stringify(index, null, 2));
}

/**
 * Reads a thread from file storage.
 * Returns null if the thread doesn't exist.
 *
 * @param threadId - The thread ID to read
 * @returns The thread file or null if not found
 *
 * @example
 * ```typescript
 * const thread = await readThread('thread-123');
 * if (thread) {
 *   console.log(thread.data.messages.length, 'messages');
 * }
 * ```
 */
export async function readThread(threadId: string): Promise<ThreadFile | null> {
  try {
    const content = await readFile(THREADS_STORAGE_DIR, `${threadId}.json`);
    if (!content) {
      return null;
    }
    return JSON.parse(content) as ThreadFile;
  } catch {
    log.warn('Failed to read thread', { threadId });
    return null;
  }
}

/**
 * Writes a thread to file storage and updates the index.
 *
 * @param thread - The thread to write
 * @param operationState - Optional operation state for tracking in-progress generations
 *
 * @example
 * ```typescript
 * await writeThread(thread, {
 *   jobId: 'job-123',
 *   status: 'generating',
 *   startedAt: new Date().toISOString(),
 * });
 * ```
 */
export async function writeThread(
  thread: Thread,
  operationState?: OperationState
): Promise<void> {
  const timestamp = now();

  // Build the thread file
  const threadFile: ThreadFile = {
    metadata: {
      id: thread.id,
      title: thread.title,
      createdAt: thread.createdAt,
      updatedAt: timestamp,
      operationState,
    },
    data: {
      ...thread,
      updatedAt: timestamp,
    },
  };

  // Write the thread file
  await ensureDir(THREADS_STORAGE_DIR);
  await writeFile(THREADS_STORAGE_DIR, `${thread.id}.json`, JSON.stringify(threadFile, null, 2));

  // Update the index
  const index = await readThreadIndex();
  const existingIndex = index.threads.findIndex((entry) => entry.id === thread.id);

  const indexEntry: ThreadIndexEntry = {
    id: thread.id,
    title: thread.title,
    updatedAt: timestamp,
  };

  if (existingIndex >= 0) {
    index.threads[existingIndex] = indexEntry;
  } else {
    index.threads.unshift(indexEntry); // Add to front (most recent)
  }

  index.updatedAt = timestamp;
  await writeThreadIndex(index);

  log.debug('Thread written', { threadId: thread.id, hasOperationState: !!operationState });
}

// =============================================================================
// Buffered Writer (for Streaming)
// =============================================================================

/**
 * Buffered writer for streaming thread updates.
 * Accumulates content and flushes to the last assistant message.
 *
 * @remarks
 * Used during streaming responses to batch writes and reduce I/O.
 * Call `flush()` to persist buffered content to storage.
 *
 * @example
 * ```typescript
 * const writer = new BufferedThreadWriter('thread-123');
 * writer.append('Hello ');
 * writer.append('world!');
 * await writer.flush(); // Persists "Hello world!" to the assistant message
 * ```
 */
export class BufferedThreadWriter {
  private buffer = '';
  private threadId: string;

  constructor(threadId: string) {
    this.threadId = threadId;
  }

  /**
   * Appends content to the buffer.
   */
  append(content: string): void {
    this.buffer += content;
  }

  /**
   * Gets the current buffer content.
   */
  getBuffer(): string {
    return this.buffer;
  }

  /**
   * Flushes the buffer to the thread's last assistant message.
   */
  async flush(): Promise<void> {
    if (!this.buffer) return;

    const threadFile = await readThread(this.threadId);
    if (!threadFile) {
      log.warn('Cannot flush buffer: thread not found', { threadId: this.threadId });
      return;
    }

    // Find the last assistant message and update its content
    const messages = threadFile.data.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        messages[i].content = this.buffer;
        break;
      }
    }

    await writeThread(threadFile.data, threadFile.metadata.operationState);
    log.debug('Buffer flushed', { threadId: this.threadId, bytes: this.buffer.length });
  }
}
