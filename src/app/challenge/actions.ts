'use server';

/**
 * Server Actions for custom challenge edits. Writing through the action
 * removes the JSON API hop from the edit form's submit path.
 */

import { revalidatePath } from 'next/cache';

import { UnauthorizedError } from '@/lib/auth/context';
import { InvalidChallengeIdError, readUserChallengeSpec, writeUserChallengeSpec } from '@/lib/challenge/spec-storage';
import { createSessionIdentity } from '@/lib/copilot/session-identity';
import { generateFocus } from '@/lib/focus/handlers';
import type { DailyChallenge } from '@/lib/focus/types';
import { logger } from '@/lib/logger';
import { RateLimitedError } from '@/lib/security/rate-limit';
import { requireGuardedUserContext } from '@/lib/security/guard';
import { FOCUS_GUARD } from '@/lib/security/route-defaults';
import { TooManyConcurrentSessionsError } from '@/lib/security/session-cap';
import { challengeQueueRepo, type CustomChallengeQueue } from '@/lib/challenge/queue-repo';

const log = logger.withTag('ChallengeActions');

const CHALLENGE_ACTION_GUARD = {
  eventType: 'storage.write' as const,
  auditMetadata: { route: '/challenge/edit' },
};

export interface RegenerateChallengeInput {
  currentChallengeId?: string;
}

export type RegenerateChallengeResult =
  | { ok: true; challenge: DailyChallenge }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'rate-limited'; retryAfterMs: number }
  | { ok: false; error: 'concurrent-cap' }
  | { ok: false; error: 'generation-failed' }
  | { ok: false; error: 'unexpected' };

export async function regenerateChallengeAction(
  input: RegenerateChallengeInput = {},
): Promise<RegenerateChallengeResult> {
  let guardedContext!: Awaited<ReturnType<typeof requireGuardedUserContext>>;
  try {
    guardedContext = await requireGuardedUserContext({
      ...FOCUS_GUARD,
      eventType: 'copilot.session.create',
      auditMetadata: { route: 'action:regenerate-challenge' },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return { ok: false, error: 'unauthenticated' };
    }
    if (error instanceof RateLimitedError) {
      return { ok: false, error: 'rate-limited', retryAfterMs: error.retryAfterMs };
    }
    if (error instanceof TooManyConcurrentSessionsError) {
      return { ok: false, error: 'concurrent-cap' };
    }
    log.error('Guard phase failed in regenerateChallengeAction', { error });
    return { ok: false, error: 'unexpected' };
  }

  const { ctx, release } = guardedContext;
  try {
    const existingChallengeTitles: string[] = [];
    if (input.currentChallengeId) {
      const currentChallenge = await readUserChallengeSpec(input.currentChallengeId);
      if (currentChallenge?.title) {
        existingChallengeTitles.push(currentChallenge.title);
      }
    }

    const generatedFocus = await generateFocus(createSessionIdentity(ctx), {
      component: 'challenge',
      existingChallengeTitles,
    });
    if (!('challenge' in generatedFocus) || !generatedFocus.challenge) {
      return { ok: false, error: 'generation-failed' };
    }

    await writeUserChallengeSpec(generatedFocus.challenge.id, generatedFocus.challenge);
    return { ok: true, challenge: generatedFocus.challenge };
  } catch (error) {
    if (error instanceof InvalidChallengeIdError) {
      return { ok: false, error: 'unexpected' };
    }
    log.error('Work phase failed in regenerateChallengeAction', { error });
    return { ok: false, error: 'unexpected' };
  } finally {
    release();
  }
}

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
  const { ctx, release } = await requireGuardedUserContext({
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

    const queue = await challengeQueueRepo.read(ctx.userId);
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
    await challengeQueueRepo.write(ctx.userId, updatedQueue);
    revalidatePath('/');
    revalidatePath(`/challenge/edit/${challengeId}`);
    return { ok: true };
  } finally {
    release();
  }
}
