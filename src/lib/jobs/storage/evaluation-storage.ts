/**
 * Evaluation Storage (per-user)
 *
 * File-based storage for challenge evaluation progress, polled by the
 * Challenge Sandbox client. Every file is partitioned per authenticated
 * user via `users/{userId}/evaluations.json` (see
 * `@/lib/storage/user-scope`).
 *
 * `userId` MUST come from a server-resolved identity (Auth.js session
 * or the persisted job payload populated by an authenticated request),
 * never from client input.
 *
 * @module jobs/evaluation-storage
 */

import { readStorage, writeStorage, ensureDir } from '@/lib/storage/utils';
import { userScopedFilename } from '@/lib/storage/user-scope';

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

const STORAGE_KEY = 'evaluations';
const DEFAULT_SCHEMA: EvaluationStorageSchema = { evaluations: {}, version: 1 };

function validateSchema(data: unknown): data is EvaluationStorageSchema {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return typeof obj.evaluations === 'object' && typeof obj.version === 'number';
}

/** Read evaluation storage for a specific user. */
export async function readEvaluationStorage(userId: string): Promise<EvaluationStorageSchema> {
  return readStorage<EvaluationStorageSchema>(
    userScopedFilename(userId, STORAGE_KEY),
    DEFAULT_SCHEMA,
    validateSchema
  );
}

/** Write evaluation storage for a specific user. */
export async function writeEvaluationStorage(userId: string, data: EvaluationStorageSchema): Promise<void> {
  await ensureDir(`users/${userId}`, { mode: 0o700 });
  return writeStorage(userScopedFilename(userId, STORAGE_KEY), data);
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
