import type { CopilotRuntime, CopilotRuntimePool, CreatePerUserRuntimePoolOptions } from './types';

interface RuntimeEntry {
  runtime: CopilotRuntime;
  lastUsed: number;
}

export function createPerUserRuntimePool({
  createRuntime,
  idleTtlMs,
  maxActiveRuntimes,
  now = Date.now,
  onEvent,
}: CreatePerUserRuntimePoolOptions): CopilotRuntimePool {
  if (maxActiveRuntimes < 1) {
    throw new Error('maxActiveRuntimes must be at least 1');
  }

  const runtimes = new Map<string, RuntimeEntry>();
  const pendingCreations = new Map<string, Promise<CopilotRuntime>>();

  async function disconnectEntry(
    userId: string,
    entry: RuntimeEntry,
    reason: 'capacity' | 'idle' | 'manual' | 'shutdown',
  ): Promise<void> {
    runtimes.delete(userId);
    await entry.runtime.disconnect();
    onEvent?.({ type: 'evicted', userId, reason });
  }

  async function pruneExpired(currentTime: number): Promise<void> {
    for (const [userId, entry] of runtimes.entries()) {
      if (currentTime - entry.lastUsed > idleTtlMs) {
        await disconnectEntry(userId, entry, 'idle');
      }
    }
  }

  async function pruneOverflow(): Promise<void> {
    while (runtimes.size > maxActiveRuntimes) {
      const oldest = [...runtimes.entries()].sort((first, second) => first[1].lastUsed - second[1].lastUsed)[0];
      if (!oldest) return;
      await disconnectEntry(oldest[0], oldest[1], 'capacity');
    }
  }

  async function createAndStoreRuntime(userId: string, currentTime: number): Promise<CopilotRuntime> {
    const runtime = await createRuntime(userId);
    runtimes.set(userId, { runtime, lastUsed: currentTime });
    pendingCreations.delete(userId);
    onEvent?.({ type: 'created', userId });
    await pruneOverflow();
    return runtime;
  }

  return {
    async getRuntime(userId: string) {
      const currentTime = now();
      await pruneExpired(currentTime);

      const existing = runtimes.get(userId);
      if (existing) {
        existing.lastUsed = currentTime;
        onEvent?.({ type: 'reused', userId });
        return existing.runtime;
      }

      const pending = pendingCreations.get(userId);
      if (pending) {
        return pending;
      }

      const created = createAndStoreRuntime(userId, currentTime).catch((error: unknown) => {
        pendingCreations.delete(userId);
        throw error;
      });
      pendingCreations.set(userId, created);
      return created;
    },
    async evictRuntime(userId: string) {
      const entry = runtimes.get(userId);
      if (entry) {
        await disconnectEntry(userId, entry, 'manual');
      }
    },
    async shutdown() {
      const entries = [...runtimes.entries()];
      await Promise.all(entries.map(([userId, entry]) => disconnectEntry(userId, entry, 'shutdown')));
    },
  };
}
