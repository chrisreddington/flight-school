import { challengeQueueStore } from '@/lib/challenge/custom-queue';
import { focusStore } from '@/lib/focus/storage';
import { habitStore } from '@/lib/habits/storage';
import { logger } from '@/lib/logger';
import { skillsStore } from '@/lib/skills/storage';
import { threadStore } from '@/lib/threads/storage';
import { workspaceStore } from '@/lib/workspace/storage';

/**
 * Clears every locally stored Flight School data set from this browser:
 * skill profile, focus history, chat threads, workspaces, habits, and the
 * challenge queue.
 *
 * Each store is cleared independently so a single failure doesn't block the
 * rest of the wipe; failures are logged but not surfaced (best effort). The
 * caller is responsible for any post-reset navigation/reload.
 *
 * @remarks
 * This only touches client-side storage. It is distinct from the server-side
 * account deletion offered by the "Delete all my data" flow.
 */
export async function clearAllLocalData(): Promise<void> {
  const stores: Array<{ name: string; clear: () => Promise<void> }> = [
    { name: 'skills', clear: () => skillsStore.clear() },
    { name: 'focus', clear: () => focusStore.clear() },
    { name: 'threads', clear: () => threadStore.clearAll() },
    { name: 'workspaces', clear: () => workspaceStore.clearAll() },
    { name: 'habits', clear: () => habitStore.clear() },
    { name: 'challenge queue', clear: () => challengeQueueStore.clear() },
  ];

  for (const { name, clear } of stores) {
    try {
      await clear();
    } catch (error) {
      logger.error(`Failed to clear ${name} storage`, { error }, 'LocalDataReset');
    }
  }
}
