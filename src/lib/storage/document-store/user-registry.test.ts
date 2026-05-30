/**
 * Tests for the sharded user-registry (§A.4).
 *
 * Two concerns are pinned here: the shard function is deterministic and
 * serializer-neutral (a fixed user id always lands in the same bucket), and
 * registration is idempotent + enumerable by walking the fixed bucket set —
 * the property retention relies on instead of scanning every partition.
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  collectRegisteredUsers,
  ensureUserRegistered,
  registryItemId,
  registryShardFor,
  removeUserRegistration,
} from './user-registry';
import type { DocumentStore } from './types';

const TEST_STORAGE_DIR = path.join(os.tmpdir(), `fs-registry-${Date.now()}`);

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

describe('registryShardFor', () => {
  it('maps a user id to a stable registry-NN bucket', () => {
    // Pinned against an independent SHA-256: the first digest byte of "alice"
    // is 0x2b, so the bucket is registry-2b. If the shard algorithm ever
    // drifts (e.g. a different hash or byte), this fixed expectation breaks.
    expect(registryShardFor('alice')).toBe('registry-2b');
    expect(registryShardFor('bob')).toBe('registry-81');
  });

  it('always yields a two-hex-char bucket in the registry-00..registry-ff range', () => {
    for (const userId of ['a', 'user-with-low-byte', 'zzz', '12345', 'Z']) {
      expect(registryShardFor(userId)).toMatch(/^registry-[0-9a-f]{2}$/);
    }
  });

  it('uses a hyphen so the shard and item id pass the safe-segment guard', () => {
    expect(registryShardFor('alice')).not.toContain(':');
    expect(registryItemId('alice')).toBe('user-alice');
  });
});

describe('ensureUserRegistered', () => {
  it('registers a user and surfaces them in the bucket sweep', async () => {
    const store = createFileDocumentStore();

    await ensureUserRegistered(store, 'alice');

    expect(await collectRegisteredUsers(store)).toEqual(['alice']);
  });

  it('is idempotent — a second ensure does not throw or duplicate', async () => {
    const store = createFileDocumentStore();

    await ensureUserRegistered(store, 'alice');
    await ensureUserRegistered(store, 'alice');

    expect(await collectRegisteredUsers(store)).toEqual(['alice']);
  });

  it('reports whether it created the entry this call or found one already present', async () => {
    const store = createFileDocumentStore();

    expect(await ensureUserRegistered(store, 'alice')).toBe('created');
    expect(await ensureUserRegistered(store, 'alice')).toBe('exists');
  });

  it('preserves the original registration timestamp across re-ensures', async () => {
    const store = createFileDocumentStore();

    await ensureUserRegistered(store, 'alice');
    const first = await store.get<{ registeredAt: string }>(
      'system',
      registryShardFor('alice'),
      registryItemId('alice'),
    );

    await new Promise((resolve) => setTimeout(resolve, 5));
    await ensureUserRegistered(store, 'alice');
    const second = await store.get<{ registeredAt: string }>(
      'system',
      registryShardFor('alice'),
      registryItemId('alice'),
    );

    expect(second?.registeredAt).toBe(first?.registeredAt);
  });

  it('enumerates users spread across multiple shards', async () => {
    const store = createFileDocumentStore();
    const userIds = ['alice', 'bob', 'carol', 'dave', 'erin'];

    for (const userId of userIds) {
      await ensureUserRegistered(store, userId);
    }

    expect((await collectRegisteredUsers(store)).sort()).toEqual([...userIds].sort());
  });

  it('propagates non-conflict failures so the caller can abort the user write', async () => {
    const store = createFileDocumentStore();
    const boom = new Error('disk on fire');
    vi.spyOn(store, 'put').mockRejectedValueOnce(boom);

    await expect(ensureUserRegistered(store, 'alice')).rejects.toThrow('disk on fire');
  });
});

describe('removeUserRegistration', () => {
  it('removes a user from the sweep and is idempotent', async () => {
    const store = createFileDocumentStore();
    await ensureUserRegistered(store, 'alice');
    await ensureUserRegistered(store, 'bob');

    await removeUserRegistration(store, 'alice');
    await removeUserRegistration(store, 'alice');

    expect(await collectRegisteredUsers(store)).toEqual(['bob']);
  });
});
