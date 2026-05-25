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

/** Fields the edit form is allowed to mutate via the server action. */
export interface ChallengeEditableFields {
  title?: string;
  description?: string;
  difficulty?: DailyChallenge['difficulty'];
  language?: DailyChallenge['language'];
  estimatedTime?: DailyChallenge['estimatedTime'];
  whyThisChallenge?: DailyChallenge['whyThisChallenge'];
}

const EDITABLE_KEYS: ReadonlyArray<keyof ChallengeEditableFields> = [
  'title',
  'description',
  'difficulty',
  'language',
  'estimatedTime',
  'whyThisChallenge',
];

function pickEditable(input: ChallengeEditableFields): ChallengeEditableFields {
  const picked: ChallengeEditableFields = {};
  for (const key of EDITABLE_KEYS) {
    if (input[key] !== undefined) {
      // Index assignment is type-safe because we iterate the known keys.
      (picked as Record<string, unknown>)[key] = input[key];
    }
  }
  return picked;
}

/**
 * Persists edits to a single custom challenge. Validates the required
 * text fields server-side and 404s when the queue no longer contains the
 * challenge (e.g. it was completed or removed in another tab).
 */
export async function updateChallengeAction(
  challengeId: string,
  updates: ChallengeEditableFields,
): Promise<UpdateChallengeState> {
  const { release } = await requireGuardedUserContext({
    ...CHALLENGE_ACTION_GUARD,
    auditMetadata: { ...CHALLENGE_ACTION_GUARD.auditMetadata, action: 'updateChallenge' },
  });
  try {
    const safeUpdates = pickEditable(updates);
    if (safeUpdates.title !== undefined && !safeUpdates.title.trim()) {
      return { ok: false, error: 'Title is required' };
    }
    if (safeUpdates.description !== undefined && !safeUpdates.description.trim()) {
      return { ok: false, error: 'Description is required' };
    }

    const queue = await readUserStorage<CustomChallengeQueue>(QUEUE_FILENAME, DEFAULT_QUEUE, isCustomChallengeQueue);
    const index = queue.challenges.findIndex((c) => c.id === challengeId);
    if (index === -1) {
      return { ok: false, error: 'Failed to save changes. The challenge may no longer exist.' };
    }
    const updatedChallenge: DailyChallenge = { ...queue.challenges[index], ...safeUpdates };
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
