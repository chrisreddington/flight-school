/**
 * Restores active background jobs after a page refresh by querying
 * /api/jobs (in the browser). During SSR there is no durable per-process
 * state to recover from — the in-memory `activeOperationsStore` is empty —
 * so the browser's `/api/jobs` fetch is the authoritative restore source.
 */

import { activeOperationsStore, type ActiveOperationItemType } from './active-operations-store';

export interface RestoredJobEntry {
  jobId: string;
  itemId: string;
  itemType: ActiveOperationItemType;
  startedAt: string;
  assistantMessageId?: string;
}

const JOB_TYPE_TO_ITEM_TYPE: Record<string, ActiveOperationItemType> = {
  'topic-regeneration': 'topic',
  'challenge-regeneration': 'challenge',
  'goal-regeneration': 'goal',
  'chat-response': 'chat',
};

interface RawApiJob {
  id: string;
  targetId?: string;
  type: string;
  createdAt: string;
  status: string;
  assistantMessageId?: string;
}

/**
 * Returns all pending/running jobs known to the system so the manager
 * can resume tracking them after the React tree remounts.
 *
 * @remarks
 * Network or store failures are swallowed and logged by the caller —
 * "no entries" is always a safe answer (the user simply won't see
 * carry-over operations).
 */
export async function fetchActiveJobEntries(onApiError: (error: unknown) => void): Promise<RestoredJobEntry[]> {
  if (typeof window === 'undefined') {
    return activeOperationsStore.getEntries();
  }

  try {
    const response = await fetch('/api/jobs', { cache: 'no-store' });
    if (!response.ok) return [];
    const data = (await response.json()) as { jobs?: RawApiJob[] };
    return (data.jobs ?? [])
      .filter((job) => job.status === 'pending' || job.status === 'running')
      .map((job) => ({
        jobId: job.id,
        itemId: job.targetId || job.id,
        itemType: JOB_TYPE_TO_ITEM_TYPE[job.type] ?? 'topic',
        startedAt: job.createdAt,
        assistantMessageId: job.assistantMessageId,
      }));
  } catch (error) {
    onApiError(error);
    return [];
  }
}
