/**
 * Advisory-lock tests for the legacy → docstore importer
 * ({@link runStorageMigration}).
 *
 * Split from `migrate.test.ts` to keep both suites under the test file-size
 * cap. These cases share the same isolation strategy: the data dir is stubbed
 * to an isolated, NESTED temp directory **before** `migrate.ts` is dynamically
 * imported, because the advisory lock lives at
 * `getStorageRoot()/../.storage-migration-lock` and the nesting keeps each
 * suite's lock file inside its own temp tree. Runs drive a real file-backed
 * {@link DocumentStore} while labelling the backend `sqlite`, so the
 * file-backend refusal guard never trips.
 *
 * @module storage/migrate-lock.test
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentStore } from './document-store/types';

const TEST_ROOT = path.join(os.tmpdir(), `flight-school-migrate-lock-${Date.now()}-${process.pid}`);
const TEST_DATA_DIR = path.join(TEST_ROOT, 'data');
const LOCK_PATH = path.join(TEST_ROOT, '.storage-migration-lock');
const SQLITE_RUN = { backend: 'sqlite' as const };

let runStorageMigration: typeof import('./migrate').runStorageMigration;
let StorageMigrationLockError: typeof import('./migrate').StorageMigrationLockError;
let StaleStorageMigrationLockError: typeof import('./migrate').StaleStorageMigrationLockError;
let createFileDocumentStore: () => DocumentStore;

beforeAll(async () => {
  vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_DATA_DIR);
  ({ runStorageMigration, StorageMigrationLockError, StaleStorageMigrationLockError } = await import('./migrate'));
  ({ createFileDocumentStore } = await import('./document-store/file-adapter'));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
});

beforeEach(async () => {
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
  await fs.mkdir(TEST_DATA_DIR, { recursive: true });
});

/** Writes a legacy file under `users/{userId}/{relativePath}`. */
async function seedLegacyFile(userId: string, relativePath: string, body: unknown): Promise<void> {
  const filePath = path.join(TEST_DATA_DIR, 'users', userId, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const serialized = typeof body === 'string' ? body : JSON.stringify(body);
  await fs.writeFile(filePath, serialized, 'utf8');
}

describe('runStorageMigration — advisory lock', () => {
  it('refuses to start when a live lock is held by another owner', async () => {
    const store = createFileDocumentStore();
    await seedLegacyFile('alice', 'skills-profile.json', { level: 'intermediate' });
    await fs.writeFile(
      LOCK_PATH,
      JSON.stringify({ ownerId: 'other', expiresAt: new Date(Date.now() + 60_000).toISOString() }),
      'utf8',
    );

    await expect(runStorageMigration({ ...SQLITE_RUN, store })).rejects.toBeInstanceOf(StorageMigrationLockError);
  });

  it('refuses a stale lock and leaves it intact for manual removal', async () => {
    const store = createFileDocumentStore();
    await seedLegacyFile('alice', 'skills-profile.json', { level: 'intermediate' });
    const stalePayload = JSON.stringify({ ownerId: 'dead', expiresAt: new Date(Date.now() - 60_000).toISOString() });
    await fs.writeFile(LOCK_PATH, stalePayload, 'utf8');

    await expect(runStorageMigration({ ...SQLITE_RUN, store })).rejects.toBeInstanceOf(StaleStorageMigrationLockError);
    // The crashed predecessor's lock must survive so an operator can inspect it.
    expect(await fs.readFile(LOCK_PATH, 'utf8')).toBe(stalePayload);
    expect(await store.getEnvelope('skills', 'alice', 'current')).toBeNull();
  });

  it('treats a lock with an unparseable expiry as stale and refuses it', async () => {
    const store = createFileDocumentStore();
    await seedLegacyFile('alice', 'skills-profile.json', { level: 'intermediate' });
    const malformedPayload = JSON.stringify({ ownerId: 'dead', expiresAt: 'not-a-date' });
    await fs.writeFile(LOCK_PATH, malformedPayload, 'utf8');

    await expect(runStorageMigration({ ...SQLITE_RUN, store })).rejects.toBeInstanceOf(StaleStorageMigrationLockError);
    expect(await fs.readFile(LOCK_PATH, 'utf8')).toBe(malformedPayload);
    expect(await store.getEnvelope('skills', 'alice', 'current')).toBeNull();
  });

  it('treats a lock with no expiry field as stale and refuses it', async () => {
    const store = createFileDocumentStore();
    await seedLegacyFile('alice', 'skills-profile.json', { level: 'intermediate' });
    const noExpiryPayload = JSON.stringify({ ownerId: 'dead' });
    await fs.writeFile(LOCK_PATH, noExpiryPayload, 'utf8');

    await expect(runStorageMigration({ ...SQLITE_RUN, store })).rejects.toBeInstanceOf(StaleStorageMigrationLockError);
    expect(await fs.readFile(LOCK_PATH, 'utf8')).toBe(noExpiryPayload);
    expect(await store.getEnvelope('skills', 'alice', 'current')).toBeNull();
  });

  it('treats a non-JSON lock body as stale and refuses it', async () => {
    const store = createFileDocumentStore();
    await seedLegacyFile('alice', 'skills-profile.json', { level: 'intermediate' });
    const corruptPayload = 'this is not json at all';
    await fs.writeFile(LOCK_PATH, corruptPayload, 'utf8');

    await expect(runStorageMigration({ ...SQLITE_RUN, store })).rejects.toBeInstanceOf(StaleStorageMigrationLockError);
    expect(await fs.readFile(LOCK_PATH, 'utf8')).toBe(corruptPayload);
    expect(await store.getEnvelope('skills', 'alice', 'current')).toBeNull();
  });
});
