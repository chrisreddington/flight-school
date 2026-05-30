/**
 * Tests for {@link createUserScopedStore} (§0.3, §A.5).
 *
 * The wrapper bakes a server-resolved `userId` in as the partition key so
 * domain code only ever names `(container, id)` and can never read or write
 * another tenant's partition. Its write path also guards the deletion
 * tombstone at three points so a late background writer cannot resurrect a
 * just-deleted user.
 *
 * The deletion race is exercised deterministically two ways: a scripted
 * `isUserDeleted` sequence drives the post-write guard, and the test-only
 * `onAfterRegistryEnsure` hook drives the mid-write guard — no timing.
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { collectRegisteredUsers, registryItemId, registryShardFor } from './user-registry';
import { UserDeletedError, createUserScopedStore, createUserScopedStoreForTest } from './user-scoped-store';
import type { DocumentStore } from './types';

const TEST_STORAGE_DIR = path.join(os.tmpdir(), `fs-scoped-${Date.now()}`);

let createFileDocumentStore: () => DocumentStore;

beforeAll(async () => {
  vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_STORAGE_DIR);
  ({ createFileDocumentStore } = await import('./file-adapter'));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
});

/** A tombstone checker backed by a mutable set the test controls. */
function tombstoneFromSet(deleted: Set<string>) {
  return (userId: string) => Promise.resolve(deleted.has(userId));
}

describe('createUserScopedStore partition isolation', () => {
  it('bakes the userId in as the partition key and registers the user on first write', async () => {
    const store = createFileDocumentStore();
    const alice = createUserScopedStore('alice', store, { isUserDeleted: () => Promise.resolve(false) });

    await alice.put('skills', 'current', { level: 'beginner' });

    expect(await alice.get('skills', 'current')).toEqual({ level: 'beginner' });
    expect(await collectRegisteredUsers(store)).toEqual(['alice']);
  });

  it('never exposes another user partition through the same backing store', async () => {
    const store = createFileDocumentStore();
    const isUserDeleted = () => Promise.resolve(false);
    const alice = createUserScopedStore('alice', store, { isUserDeleted });
    const bob = createUserScopedStore('bob', store, { isUserDeleted });

    await alice.put('skills', 'current', { owner: 'alice' });
    await bob.put('skills', 'current', { owner: 'bob' });

    expect(await alice.get('skills', 'current')).toEqual({ owner: 'alice' });
    expect(await bob.get('skills', 'current')).toEqual({ owner: 'bob' });
  });

  it('scopes list, remove, removeByParent and deletePartition to the user partition', async () => {
    const store = createFileDocumentStore();
    const alice = createUserScopedStore('alice', store, { isUserDeleted: () => Promise.resolve(false) });

    await alice.put('track-steps', 'step-1', { n: 1 }, { metadata: { parentId: 'enroll-1' } });
    await alice.put('track-steps', 'step-2', { n: 2 }, { metadata: { parentId: 'enroll-2' } });

    const listed = await alice.list('track-steps');
    expect(listed.items.map((item) => item.id).sort()).toEqual(['step-1', 'step-2']);

    await alice.removeByParent('track-steps', 'enroll-1');
    expect((await alice.list('track-steps')).items.map((item) => item.id)).toEqual(['step-2']);

    await alice.deletePartition('track-steps');
    expect((await alice.list('track-steps')).items).toEqual([]);
  });

  it('rejects an unsafe userId at construction', () => {
    const store = createFileDocumentStore();
    expect(() => createUserScopedStore('../escape', store, { isUserDeleted: () => Promise.resolve(false) })).toThrow(
      /unsafe userId/,
    );
  });
});

describe('createUserScopedStore tombstone guard', () => {
  it('refuses a write for an already-deleted user and writes nothing', async () => {
    const store = createFileDocumentStore();
    const deleted = new Set(['ghost']);
    const ghost = createUserScopedStore('ghost', store, { isUserDeleted: tombstoneFromSet(deleted) });

    await expect(ghost.put('skills', 'current', { level: 'beginner' })).rejects.toBeInstanceOf(UserDeletedError);

    expect(await store.get('skills', 'ghost', 'current')).toBeNull();
    expect(await collectRegisteredUsers(store)).toEqual([]);
  });

  it('cleans up registry + data when the post-write re-check finds the user deleted', async () => {
    const store = createFileDocumentStore();
    // Guard A and guard B see a live user; only the post-write guard C sees the
    // tombstone — so the data row IS written, then rolled back.
    const isUserDeleted = vi
      .fn<(userId: string) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const racer = createUserScopedStore('racer', store, { isUserDeleted });

    await expect(racer.put('skills', 'current', { level: 'beginner' })).rejects.toBeInstanceOf(UserDeletedError);

    expect(isUserDeleted).toHaveBeenCalledTimes(3);
    expect(await store.get('skills', 'racer', 'current')).toBeNull();
    expect(await store.get('system', registryShardFor('racer'), registryItemId('racer'))).toBeNull();
  });

  it('cleans up when the tombstone lands at the registry-ensure boundary (hook)', async () => {
    const store = createFileDocumentStore();
    const deleted = new Set<string>();
    const racer = createUserScopedStoreForTest('racer', store, {
      isUserDeleted: tombstoneFromSet(deleted),
      onAfterRegistryEnsure: () => {
        deleted.add('racer');
      },
    });

    await expect(racer.put('skills', 'current', { level: 'beginner' })).rejects.toBeInstanceOf(UserDeletedError);

    expect(await store.get('skills', 'racer', 'current')).toBeNull();
    expect(await store.get('system', registryShardFor('racer'), registryItemId('racer'))).toBeNull();
  });

  it('does not expose the test hook on the production factory output', () => {
    const store = createFileDocumentStore();
    const scoped = createUserScopedStore('alice', store, { isUserDeleted: () => Promise.resolve(false) });

    expect(Object.keys(scoped)).not.toContain('onAfterRegistryEnsure');
  });

  it('rolls back only the racing write, sparing a returning user other data and the existing registry', async () => {
    const store = createFileDocumentStore();
    // The user wrote `keep` legitimately, signed out, was deleted, then signed
    // back in — the same partition is reused. A late writer that lost the race
    // must remove only the doc IT wrote, never the surviving `keep` doc, and
    // must leave the pre-existing registry entry intact.
    const isUserDeleted = vi
      .fn<(userId: string) => Promise<boolean>>()
      .mockResolvedValueOnce(false) // guard A for the legit `keep` write
      .mockResolvedValueOnce(false) // guard B for the legit `keep` write
      .mockResolvedValueOnce(false) // guard C for the legit `keep` write
      .mockResolvedValueOnce(false) // guard A for the racing `racer` write
      .mockResolvedValueOnce(false) // guard B for the racing `racer` write
      .mockResolvedValue(true); // guard C for the racing `racer` write — tombstone now set
    const returning = createUserScopedStore('returning', store, { isUserDeleted });

    await returning.put('skills', 'keep', { level: 'beginner' });

    await expect(returning.put('habits', 'racer', { streak: 1 })).rejects.toBeInstanceOf(UserDeletedError);

    expect(await store.get('skills', 'returning', 'keep')).toEqual({ level: 'beginner' });
    expect(await store.get('habits', 'returning', 'racer')).toBeNull();
    expect(await collectRegisteredUsers(store)).toEqual(['returning']);
  });
});
