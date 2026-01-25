/**
 * Active operations materialized view.
 * 
 * On the server, persists to disk for recovery across restarts.
 * On the client, uses in-memory storage only (no fs module available).
 */

import { now, nowMs } from '@/lib/utils/date-utils';

const STORAGE_FILE = 'active-operations.json';
const OPERATION_TTL_MS = 5 * 60 * 1000;

export type ActiveOperationItemType = 'topic' | 'challenge' | 'goal' | 'chat';

export interface ActiveOperationEntry {
  /** ID of the item associated with the operation. */
  itemId: string;
  /** Item type for UI routing or filtering. */
  itemType: ActiveOperationItemType;
  /** Background job identifier. */
  jobId: string;
  /** ISO timestamp when the operation started. */
  startedAt: string;
}

interface ActiveOperationsSchema {
  version: 1;
  updatedAt: string;
  entries: ActiveOperationEntry[];
}

const DEFAULT_SCHEMA: ActiveOperationsSchema = {
  version: 1,
  updatedAt: now(),
  entries: [],
};

function validateSchema(data: unknown): data is ActiveOperationsSchema {
  if (typeof data !== 'object' || data === null) return false;
  const schema = data as Record<string, unknown>;
  if (schema.version !== 1) return false;
  if (typeof schema.updatedAt !== 'string') return false;
  if (!Array.isArray(schema.entries)) return false;
  return schema.entries.every((entry) => {
    if (typeof entry !== 'object' || entry === null) return false;
    const record = entry as Record<string, unknown>;
    return (
      typeof record.itemId === 'string' &&
      typeof record.itemType === 'string' &&
      typeof record.jobId === 'string' &&
      typeof record.startedAt === 'string'
    );
  });
}

function pruneExpiredEntries(entries: ActiveOperationEntry[], nowTimestamp: number): ActiveOperationEntry[] {
  return entries.filter((entry) => {
    const startedAtMs = Date.parse(entry.startedAt);
    if (Number.isNaN(startedAtMs)) return false;
    return nowTimestamp - startedAtMs <= OPERATION_TTL_MS;
  });
}

/**
 * Check if we're running on the server (Node.js) vs browser.
 */
function isServer(): boolean {
  return typeof window === 'undefined';
}

/**
 * Dynamically import storage utils only on the server.
 * Returns null on the client where fs is not available.
 */
async function getStorageUtils(): Promise<{
  readStorage: typeof import('@/lib/storage/utils').readStorage;
  writeStorage: typeof import('@/lib/storage/utils').writeStorage;
} | null> {
  if (!isServer()) {
    return null;
  }
  try {
    const utils = await import('@/lib/storage/utils');
    return { readStorage: utils.readStorage, writeStorage: utils.writeStorage };
  } catch {
    return null;
  }
}

export class ActiveOperationsStore {
  /** In-memory cache for client-side or when file storage unavailable */
  private memoryCache: ActiveOperationsSchema = { ...DEFAULT_SCHEMA };

  /**
   * Returns active operations after applying TTL cleanup.
   */
  async getEntries(): Promise<ActiveOperationEntry[]> {
    const storageUtils = await getStorageUtils();
    
    let schema: ActiveOperationsSchema;
    if (storageUtils) {
      schema = await storageUtils.readStorage(STORAGE_FILE, DEFAULT_SCHEMA, validateSchema);
    } else {
      schema = this.memoryCache;
    }

    const nowTimestamp = nowMs();
    const prunedEntries = pruneExpiredEntries(schema.entries, nowTimestamp);

    if (prunedEntries.length !== schema.entries.length) {
      const updatedSchema = {
        ...schema,
        updatedAt: now(),
        entries: prunedEntries,
      };
      if (storageUtils) {
        await storageUtils.writeStorage(STORAGE_FILE, updatedSchema);
      } else {
        this.memoryCache = updatedSchema;
      }
    }

    return prunedEntries;
  }

  /**
   * Adds or replaces an active operation entry.
   */
  async addEntry(entry: ActiveOperationEntry): Promise<void> {
    const storageUtils = await getStorageUtils();
    
    let schema: ActiveOperationsSchema;
    if (storageUtils) {
      schema = await storageUtils.readStorage(STORAGE_FILE, DEFAULT_SCHEMA, validateSchema);
    } else {
      schema = this.memoryCache;
    }

    const nowTimestamp = nowMs();
    const prunedEntries = pruneExpiredEntries(schema.entries, nowTimestamp);

    const filteredEntries = prunedEntries.filter((existing) => {
      if (existing.jobId === entry.jobId) return false;
      return !(existing.itemId === entry.itemId && existing.itemType === entry.itemType);
    });

    const updatedSchema: ActiveOperationsSchema = {
      version: 1,
      updatedAt: now(),
      entries: [...filteredEntries, entry],
    };

    if (storageUtils) {
      await storageUtils.writeStorage(STORAGE_FILE, updatedSchema);
    } else {
      this.memoryCache = updatedSchema;
    }
  }

  /**
   * Removes an entry by job ID.
   */
  async removeByJobId(jobId: string): Promise<void> {
    const storageUtils = await getStorageUtils();
    
    let schema: ActiveOperationsSchema;
    if (storageUtils) {
      schema = await storageUtils.readStorage(STORAGE_FILE, DEFAULT_SCHEMA, validateSchema);
    } else {
      schema = this.memoryCache;
    }

    const remainingEntries = schema.entries.filter((entry) => entry.jobId !== jobId);

    if (remainingEntries.length === schema.entries.length) {
      return;
    }

    const updatedSchema = {
      ...schema,
      updatedAt: now(),
      entries: remainingEntries,
    };

    if (storageUtils) {
      await storageUtils.writeStorage(STORAGE_FILE, updatedSchema);
    } else {
      this.memoryCache = updatedSchema;
    }
  }
}

export const activeOperationsStore = new ActiveOperationsStore();
