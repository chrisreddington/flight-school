import { promises as fs } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestStorageContext, ensureTestStorageDirectory } from '@/test/mocks/storage';
import type { DailyChallenge, DailyGoal, LearningTopic } from './base-types';
import type { FocusIndexStatus, FocusItemFile, FocusItemType } from './types';

interface FocusStorageModule {
  FOCUS_INDEX_FILE: string;
  readFocusIndex: () => Promise<{ version: 1; updatedAt: string; items: Array<{ id: string; type: FocusItemType; status: FocusIndexStatus }> }>;
  readFocusItem: <T>(options: { dateKey: string; type: FocusItemType; itemId: string }) => Promise<FocusItemFile<T> | null>;
  writeFocusItem: <T>(options: {
    dateKey: string;
    type: FocusItemType;
    item: T;
    status: FocusIndexStatus;
    title: string;
    operationState?: { jobId: string; status: 'generating' | 'complete' | 'failed'; startedAt: string };
  }) => Promise<void>;
}

describe('Focus storage (file-per-item)', () => {
  let cleanup: () => Promise<void>;
  let storageDir: string;
  let storage: FocusStorageModule;

  beforeEach(async () => {
    vi.resetModules();
    const context = createTestStorageContext({ prefix: 'focus-storage' });
    storageDir = context.storageDir;
    cleanup = context.cleanup;
    await ensureTestStorageDirectory(storageDir);
    // Import server-only module for testing
    storage = (await import('./storage.server')) as FocusStorageModule;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('should return default index when missing', async () => {
    const index = await storage.readFocusIndex();

    expect(index.version).toBe(1);
    expect(index.items).toEqual([]);
  });

  it('should write item file and update index', async () => {
    const dateKey = '2026-01-25';
    const challenge: DailyChallenge = {
      id: 'challenge-1',
      title: 'Build a rate limiter',
      description: 'Implement a token bucket rate limiter.',
      difficulty: 'intermediate',
      language: 'TypeScript',
      estimatedTime: '30 minutes',
      whyThisChallenge: ['Practice concurrency control'],
    };

    await storage.writeFocusItem<DailyChallenge>({
      dateKey,
      type: 'challenge',
      item: challenge,
      status: 'complete',
      title: challenge.title,
      operationState: {
        jobId: 'job-123',
        status: 'complete',
        startedAt: new Date('2026-01-25T00:00:00.000Z').toISOString(),
      },
    });

    const index = await storage.readFocusIndex();
    expect(index.items).toEqual([
      expect.objectContaining({
        id: challenge.id,
        type: 'challenge',
        status: 'complete',
      }),
    ]);

    const item = await storage.readFocusItem<DailyChallenge>({
      dateKey,
      type: 'challenge',
      itemId: challenge.id,
    });

    expect(item).not.toBeNull();
    expect(item?.data).toEqual(challenge);
    expect(item?.metadata.operationState?.jobId).toBe('job-123');
  });

  it('should recover from invalid index JSON', async () => {
    const dateKey = '2026-01-25';
    const goal: DailyGoal = {
      id: 'goal-1',
      title: 'Ship a refactor',
      description: 'Refactor focus storage for file-per-item.',
      progress: 0,
      target: 'Complete step 3',
      reasoning: 'Improve reliability',
    };

    const indexPath = path.join(storageDir, storage.FOCUS_INDEX_FILE);
    await fs.mkdir(path.dirname(indexPath), { recursive: true });
    await fs.writeFile(indexPath, '{ invalid json }');

    await storage.writeFocusItem<DailyGoal>({
      dateKey,
      type: 'goal',
      item: goal,
      status: 'generating',
      title: goal.title,
    });

    const index = await storage.readFocusIndex();
    expect(index.items.some((entry) => entry.id === goal.id)).toBe(true);
  });

  it('should support topic items', async () => {
    const dateKey = '2026-01-25';
    const topic: LearningTopic = {
      id: 'topic-1',
      title: 'State machines',
      description: 'Use state machines for predictable UI state.',
      type: 'concept',
      relatedTo: 'focus storage',
    };

    await storage.writeFocusItem<LearningTopic>({
      dateKey,
      type: 'topic',
      item: topic,
      status: 'complete',
      title: topic.title,
    });

    const item = await storage.readFocusItem<LearningTopic>({
      dateKey,
      type: 'topic',
      itemId: topic.id,
    });

    expect(item?.data).toEqual(topic);
  });
});
