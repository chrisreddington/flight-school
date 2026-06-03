/**
 * Active operations materialized view (in-memory).
 *
 * Tracks which background jobs the operations manager is currently following
 * so it can de-duplicate concurrent regenerations. State is per-process and
 * non-durable: the browser is the only caller that mutates it, and the
 * authoritative cross-reload restore source is `/api/jobs` (see
 * `restore-active-jobs.ts`), not this view. Kept free of `node:fs` so it never
 * drags filesystem modules into the client bundle.
 */

import { now, nowMs } from '@/lib/utils/date-utils';

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
  /**
   * For chat operations: stable assistant-message id the worker is
   * streaming into. Persisted so cold reloads can rebind the
   * `chatStreamStore` record without waiting for the first delta.
   */
  assistantMessageId?: string;
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

function pruneExpiredEntries(entries: ActiveOperationEntry[], nowTimestamp: number): ActiveOperationEntry[] {
  return entries.filter((entry) => {
    const startedAtMs = Date.parse(entry.startedAt);
    if (Number.isNaN(startedAtMs)) return false;
    return nowTimestamp - startedAtMs <= OPERATION_TTL_MS;
  });
}

export class ActiveOperationsStore {
  /** In-memory cache for client-side or when file storage unavailable */
  private memoryCache: ActiveOperationsSchema = { ...DEFAULT_SCHEMA };

  /**
   * Returns active operations after applying TTL cleanup.
   */
  async getEntries(): Promise<ActiveOperationEntry[]> {
    const prunedEntries = pruneExpiredEntries(this.memoryCache.entries, nowMs());

    if (prunedEntries.length !== this.memoryCache.entries.length) {
      this.memoryCache = { ...this.memoryCache, updatedAt: now(), entries: prunedEntries };
    }

    return prunedEntries;
  }

  /**
   * Adds or replaces an active operation entry.
   */
  async addEntry(entry: ActiveOperationEntry): Promise<void> {
    const prunedEntries = pruneExpiredEntries(this.memoryCache.entries, nowMs());

    const filteredEntries = prunedEntries.filter((existing) => {
      if (existing.jobId === entry.jobId) return false;
      return !(existing.itemId === entry.itemId && existing.itemType === entry.itemType);
    });

    this.memoryCache = {
      version: 1,
      updatedAt: now(),
      entries: [...filteredEntries, entry],
    };
  }

  /**
   * Removes an entry by job ID.
   */
  async removeByJobId(jobId: string): Promise<void> {
    const remainingEntries = this.memoryCache.entries.filter((entry) => entry.jobId !== jobId);

    if (remainingEntries.length === this.memoryCache.entries.length) {
      return;
    }

    this.memoryCache = { ...this.memoryCache, updatedAt: now(), entries: remainingEntries };
  }
}

export const activeOperationsStore = new ActiveOperationsStore();
