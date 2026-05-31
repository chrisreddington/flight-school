/**
 * Tests for the registry reconciliation sweep (§A.4) — the PURE, UNWIRED
 * janitor that prunes registry entries whose user data is gone.
 *
 * Only the SAFE behaviours are pinned here, because wiring this sweep live is
 * deliberately deferred (a live prune races account creation — see the
 * `// CRITICAL:` note in the implementation). The contract a future caller
 * relies on: an old, empty registration is pruned; a recent empty one is
 * spared by the age guard; and an entry whose user still has data is never
 * pruned regardless of age.
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { reconcileUserRegistry } from './registry-reconciliation';
import { collectRegisteredUsers, registryItemId, registryShardFor, type UserRegistryEntry } from './user-registry';
import type { DocumentStore } from './types';

const TEST_STORAGE_DIR = path.join(os.tmpdir(), `fs-reconcile-${Date.now()}`);

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

/** Register a user with an explicit registration timestamp (bypassing now()). */
async function registerAt(store: DocumentStore, userId: string, registeredAt: string): Promise<void> {
  const entry: UserRegistryEntry = { userId, registeredAt };
  await store.put('system', registryShardFor(userId), registryItemId(userId), entry, {
    metadata: { type: 'user-registry' },
  });
}

const NOW = Date.parse('2026-06-01T00:00:00.000Z');
const ONE_HOUR_MS = 60 * 60 * 1000;

describe('reconcileUserRegistry', () => {
  it('prunes an old registration whose user has no data', async () => {
    const store = createFileDocumentStore();
    await registerAt(store, 'ghost', new Date(NOW - 2 * ONE_HOUR_MS).toISOString());

    const outcome = await reconcileUserRegistry(store, { minAgeMs: ONE_HOUR_MS, now: NOW });

    expect(outcome.pruned).toEqual(['ghost']);
    expect(await collectRegisteredUsers(store)).toEqual([]);
  });

  it('spares a recently-registered empty user (age guard)', async () => {
    const store = createFileDocumentStore();
    await registerAt(store, 'newcomer', new Date(NOW - ONE_HOUR_MS / 2).toISOString());

    const outcome = await reconcileUserRegistry(store, { minAgeMs: ONE_HOUR_MS, now: NOW });

    expect(outcome.pruned).toEqual([]);
    expect(await collectRegisteredUsers(store)).toEqual(['newcomer']);
  });

  it('never prunes a user that still has data, however old', async () => {
    const store = createFileDocumentStore();
    await registerAt(store, 'active', new Date(NOW - 10 * ONE_HOUR_MS).toISOString());
    await store.put('skills', 'active', 'current', { level: 'wizard' });

    const outcome = await reconcileUserRegistry(store, { minAgeMs: ONE_HOUR_MS, now: NOW });

    expect(outcome.pruned).toEqual([]);
    expect(await collectRegisteredUsers(store)).toEqual(['active']);
  });
});
