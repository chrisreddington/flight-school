/**
 * Evaluation Storage (per-user)
 *
 * Challenge evaluation progress, polled by the Challenge Sandbox client and
 * written by the worker's evaluation executor. Each user has exactly one
 * evaluations singleton, stored through the envelope
 * {@link import('@/lib/storage/document-store/singleton-repo')} via the
 * `'evaluations'` container mapping (legacy path `users/{userId}/evaluations`).
 *
 * This module is **worker-reached**: the evaluation executor persists progress
 * from the Next-free worker process. Because a user can delete their account
 * while an evaluation job is still streaming, {@link writeEvaluationStorage}
 * swallows {@link UserDeletedError} — the store refuses the write for a
 * tombstoned user and we silently abort rather than surfacing an error to the
 * poller.
 *
 * `userId` MUST come from a server-resolved identity (Auth.js session
 * or the persisted job payload populated by an authenticated request),
 * never from client input.
 *
 * @module jobs/evaluation-storage
 */

import { createSingletonRepo } from '@/lib/storage/document-store/singleton-repo';
import { UserDeletedError } from '@/lib/storage/document-store/user-scoped-store';

/** Evaluation progress stored in file */
export interface EvaluationProgress {
  challengeId: string;
  jobId: string;
  status: 'pending' | 'streaming' | 'completed' | 'failed';
  /** Streaming feedback content (updated incrementally) */
  streamingFeedback: string;
  /** Partial metadata available before full result */
  partial?: {
    isCorrect: boolean;
    score?: number;
    strengths: string[];
    improvements: string[];
    nextSteps?: string[];
  };
  /** Final result when completed */
  result?: {
    isCorrect: boolean;
    feedback: string;
    strengths: string[];
    improvements: string[];
    score?: number;
    nextSteps?: string[];
  };
  /** Error message if failed */
  error?: string;
  /** Machine-readable failure classification, mirrored from the job record. */
  errorCode?: 'credentials_missing' | 'credentials_refresh_failed' | 'unknown';
  /** Short label describing the current executor phase (e.g. "Running tests…"). */
  currentStep?: string;
  updatedAt: string;
}

interface EvaluationStorageSchema {
  evaluations: Record<string, EvaluationProgress>;
  version: number;
}

const DEFAULT_SCHEMA: EvaluationStorageSchema = { evaluations: {}, version: 1 };

function validateSchema(data: unknown): data is EvaluationStorageSchema {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return typeof obj.evaluations === 'object' && typeof obj.version === 'number';
}

const evaluationsRepo = createSingletonRepo<EvaluationStorageSchema>({
  filename: 'evaluations',
  defaultValue: DEFAULT_SCHEMA,
  guard: validateSchema,
});

/** Read evaluation storage for a specific user. */
export async function readEvaluationStorage(userId: string): Promise<EvaluationStorageSchema> {
  return evaluationsRepo.read(userId);
}

/**
 * Write evaluation storage for a specific user. Silently aborts when the user
 * has been deleted mid-job (the store rejects the write with
 * {@link UserDeletedError}).
 */
export async function writeEvaluationStorage(userId: string, data: EvaluationStorageSchema): Promise<void> {
  try {
    await evaluationsRepo.write(userId, data);
  } catch (error) {
    if (error instanceof UserDeletedError) return;
    throw error;
  }
}

/** Get evaluation progress by challenge ID for a specific user. */
export async function getEvaluationProgress(userId: string, challengeId: string): Promise<EvaluationProgress | null> {
  const storage = await readEvaluationStorage(userId);
  return storage.evaluations[challengeId] ?? null;
}

/** Clear evaluation progress for a challenge owned by a specific user. */
export async function clearEvaluationProgress(userId: string, challengeId: string): Promise<void> {
  const storage = await readEvaluationStorage(userId);
  delete storage.evaluations[challengeId];
  await writeEvaluationStorage(userId, storage);
}
