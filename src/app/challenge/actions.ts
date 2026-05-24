'use server';

/**
 * Server Actions for custom challenge edits. Writing through the action
 * removes the JSON API hop from the edit form's submit path.
 */

import { revalidatePath } from 'next/cache';

import type { DailyChallenge } from '@/lib/focus/types';
import { requireGuardedUserContext } from '@/lib/security/guard';
import { readUserStorage, writeUserStorage } from '@/lib/storage/user-storage';

const QUEUE_FILENAME = 'challenge-queue.json';

interface CustomChallengeQueue {
  challenges: DailyChallenge[];
  lastUpdated: string;
}

const DEFAULT_QUEUE: CustomChallengeQueue = { challenges: [], lastUpdated: '' };

function isCustomChallengeQueue(data: unknown): data is CustomChallengeQueue {
  if (typeof data !== 'object' || data === null) return false;
  const schema = data as Record<string, unknown>;
  return Array.isArray(schema.challenges) && typeof schema.lastUpdated === 'string';
}

const CHALLENGE_ACTION_GUARD = {
  eventType: 'storage.write' as const,
  auditMetadata: { route: '/challenge/edit' },
};

export interface UpdateChallengeState {
  ok: boolean;
  error?: string;
}

/**
 * Persists edits to a single custom challenge. Validates the required
 * text fields server-side and 404s when the queue no longer contains the
 * challenge (e.g. it was completed or removed in another tab).
 */
export async function updateChallengeAction(
  challengeId: string,
  updates: Partial<DailyChallenge>,
): Promise<UpdateChallengeState> {
  const { release } = await requireGuardedUserContext({
    ...CHALLENGE_ACTION_GUARD,
    auditMetadata: { ...CHALLENGE_ACTION_GUARD.auditMetadata, action: 'updateChallenge' },
  });
  try {
    if (updates.title !== undefined && !updates.title.trim()) {
      return { ok: false, error: 'Title is required' };
    }
    if (updates.description !== undefined && !updates.description.trim()) {
      return { ok: false, error: 'Description is required' };
    }

    const queue = await readUserStorage<CustomChallengeQueue>(
      QUEUE_FILENAME,
      DEFAULT_QUEUE,
      isCustomChallengeQueue,
    );
    const index = queue.challenges.findIndex((c) => c.id === challengeId);
    if (index === -1) {
      return { ok: false, error: 'Failed to save changes. The challenge may no longer exist.' };
    }
    const updatedChallenge: DailyChallenge = { ...queue.challenges[index], ...updates };
    const updatedQueue: CustomChallengeQueue = {
      ...queue,
      challenges: queue.challenges.map((c, i) => (i === index ? updatedChallenge : c)),
      lastUpdated: new Date().toISOString(),
    };
    await writeUserStorage(QUEUE_FILENAME, updatedQueue, isCustomChallengeQueue);
    revalidatePath('/');
    revalidatePath(`/challenge/edit/${challengeId}`);
    return { ok: true };
  } finally {
    release();
  }
}
