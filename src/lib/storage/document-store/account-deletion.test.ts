/**
 * Tests for {@link deleteUserData} — the account-deletion partition wipe.
 *
 * Two layers of coverage:
 *
 * 1. **Ordering + partial-failure** against a recording fake store, pinning
 *    the multi-tenant safety invariant: data partitions are deleted FIRST and
 *    the registry entry removed LAST, and ONLY when every partition succeeded
 *    — the inverse of the registry-first CREATE ordering, so a crash leaves a
 *    discoverable registry entry (retryable) rather than orphaned data.
 * 2. **Real-adapter isolation** against both the file and sqlite stores: one
 *    user's wipe clears every one of their partitions and their registry
 *    entry while leaving a second user's data, the second user's registry
 *    entry, and the shared `system` container untouched.
 */

import { createRequire } from 'module';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteUserData } from './account-deletion';
import { USER_SCOPED_CONTAINERS } from './containers';
import { createFileDocumentStore } from './file-adapter';
import { createSqliteDocumentStore } from './sqlite-adapter';
import { collectRegisteredUsers, ensureUserRegistered, registryShardFor } from './user-registry';
import { SINGLETON_DOCUMENT_ID, type ContainerName, type DocumentStore } from './types';

/**
 * A minimal {@link DocumentStore} that records partition deletes and document
 * removes in call order, and can be told to throw on specific containers'
 * `deletePartition`. Only the methods {@link deleteUserData} touches are
 * implemented; the rest throw so an accidental new dependency is loud.
 */
function createRecordingStore(failOn: Set<ContainerName> = new Set()) {
  const deletedPartitions: ContainerName[] = [];
  const removedRegistryShards: string[] = [];
  const store = {
    async deletePartition(container: ContainerName): Promise<void> {
      if (failOn.has(container)) throw new Error(`boom: ${container}`);
      deletedPartitions.push(container);
    },
    async remove(container: ContainerName, partitionKey: string): Promise<void> {
      removedRegistryShards.push(`${container}/${partitionKey}`);
    },
    get: () => Promise.reject(new Error('unexpected get')),
    getEnvelope: () => Promise.reject(new Error('unexpected getEnvelope')),
    put: () => Promise.reject(new Error('unexpected put')),
    list: () => Promise.reject(new Error('unexpected list')),
    removeByParent: () => Promise.reject(new Error('unexpected removeByParent')),
  } as unknown as DocumentStore;
  return { store, deletedPartitions, removedRegistryShards };
}

describe('deleteUserData ordering and partial failure', () => {
  it('deletes every user-scoped partition before removing the registry entry', async () => {
    const { store, deletedPartitions, removedRegistryShards } = createRecordingStore();

    await deleteUserData(store, 'user-a');

    expect(deletedPartitions).toEqual([...USER_SCOPED_CONTAINERS]);
    expect(removedRegistryShards).toEqual([`system/${registryShardFor('user-a')}`]);
  });

  it('never deletes the shared system container as a user partition', async () => {
    const { store, deletedPartitions } = createRecordingStore();

    await deleteUserData(store, 'user-a');

    expect(deletedPartitions).not.toContain('system');
  });

  it('leaves the registry entry in place when any partition delete fails', async () => {
    const { store, removedRegistryShards } = createRecordingStore(new Set<ContainerName>(['focus']));

    await expect(deleteUserData(store, 'user-a')).rejects.toThrow(/focus/);
    expect(removedRegistryShards).toEqual([]);
  });

  it('completes and removes the registry entry on retry after a partial failure', async () => {
    const failing = createRecordingStore(new Set<ContainerName>(['focus']));
    await expect(deleteUserData(failing.store, 'user-a')).rejects.toThrow();

    // Retry against a now-healthy store: idempotent re-deletes of the
    // already-cleared partitions succeed and the registry entry is removed.
    const healthy = createRecordingStore();
    await deleteUserData(healthy.store, 'user-a');
    expect(healthy.removedRegistryShards).toEqual([`system/${registryShardFor('user-a')}`]);
  });
});

/** Build a fresh temp directory the test owns and cleans up. */
async function freshTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'flight-school-account-deletion-'));
}

/** node:sqlite landed in Node 22.5; skip the sqlite leg on older runtimes. */
function nodeSqliteAvailable(): boolean {
  try {
    createRequire(import.meta.url)('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

const SQLITE_AVAILABLE = nodeSqliteAvailable();

/** Seed one document into every user-scoped container for `userId`. */
async function seedAllContainers(store: DocumentStore, userId: string): Promise<void> {
  await ensureUserRegistered(store, userId);
  for (const container of USER_SCOPED_CONTAINERS) {
    await store.put(container, userId, SINGLETON_DOCUMENT_ID, { seededFor: userId });
  }
}

/** Count documents across every user-scoped container for `userId`. */
async function countAllContainers(store: DocumentStore, userId: string): Promise<number> {
  let total = 0;
  for (const container of USER_SCOPED_CONTAINERS) {
    const page = await store.list(container, userId, { limit: 100 });
    total += page.items.length;
  }
  return total;
}

interface AdapterCase {
  name: string;
  make: (dir: string) => Promise<DocumentStore>;
}

const adapterCases: AdapterCase[] = [
  {
    name: 'file',
    make: async (dir) => {
      vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', dir);
      return createFileDocumentStore();
    },
  },
  {
    name: 'sqlite',
    make: async (dir) => createSqliteDocumentStore({ dbPath: path.join(dir, 'docstore.sqlite') }),
  },
];

describe.each(adapterCases)('deleteUserData isolation on the $name adapter', ({ name, make }) => {
  let dir: string;

  beforeEach(async () => {
    dir = await freshTempDir();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const maybeIt = name === 'sqlite' && !SQLITE_AVAILABLE ? it.skip : it;

  maybeIt('wipes the target user while leaving other users and system intact', async () => {
    const store = await make(dir);
    await seedAllContainers(store, 'user-a');
    await seedAllContainers(store, 'user-b');

    await deleteUserData(store, 'user-a');

    expect(await countAllContainers(store, 'user-a')).toBe(0);
    expect(await countAllContainers(store, 'user-b')).toBe(USER_SCOPED_CONTAINERS.length);

    const registered = await collectRegisteredUsers(store);
    expect(registered).not.toContain('user-a');
    expect(registered).toContain('user-b');
  });
});
