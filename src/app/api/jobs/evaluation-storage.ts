/**
 * Evaluation Storage
 * 
 * File-based storage for evaluation progress, allowing polling from client.
 * Similar pattern to threads-storage but for evaluation state.
 */

import { readStorage, writeStorage } from '@/lib/storage/utils';

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

/** Read evaluation storage */
export async function readEvaluationStorage(): Promise<EvaluationStorageSchema> {
  return readStorage<EvaluationStorageSchema>(STORAGE_KEY, DEFAULT_SCHEMA, validateSchema);
}

/** Write evaluation storage */
export async function writeEvaluationStorage(data: EvaluationStorageSchema): Promise<void> {
  return writeStorage(STORAGE_KEY, data);
}

/** Get evaluation progress by challenge ID */
export async function getEvaluationProgress(challengeId: string): Promise<EvaluationProgress | null> {
  const storage = await readEvaluationStorage();
  return storage.evaluations[challengeId] ?? null;
}

/** Update evaluation progress */
export async function updateEvaluationProgress(progress: EvaluationProgress): Promise<void> {
  const storage = await readEvaluationStorage();
  storage.evaluations[progress.challengeId] = progress;
  await writeEvaluationStorage(storage);
}

/** Clear evaluation progress for a challenge */
export async function clearEvaluationProgress(challengeId: string): Promise<void> {
  const storage = await readEvaluationStorage();
  delete storage.evaluations[challengeId];
  await writeEvaluationStorage(storage);
}
