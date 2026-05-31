/**
 * SQLite-adapter tests: the shared {@link describeDocumentStoreContract} suite
 * plus sqlite-backend-specific concerns (monotonic-integer etags, WAL mode,
 * on-disk persistence).
 *
 * Each test gets a fresh temp-FILE database (not `:memory:`) so the multi-file
 * WAL layout the production path relies on is actually exercised. The adapter
 * only `import type`s `node:sqlite` and dynamic-imports the driver, so it is
 * safe to import statically here with no env-stub dance.
 *
 * @module storage/document-store/sqlite-adapter.test
 */

import { createRequire } from 'module';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { describeDocumentStoreContract } from './contract';
import { createSqliteDocumentStore } from './sqlite-adapter';
import { SINGLETON_DOCUMENT_ID } from './types';

/** node:sqlite landed in Node 22.5; skip the whole file on older runtimes. */
function nodeSqliteAvailable(): boolean {
  try {
    createRequire(import.meta.url)('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

const SQLITE_AVAILABLE = nodeSqliteAvailable();

const tempDirs: string[] = [];

/** Allocate a fresh temp-file DB path, tracked for afterEach cleanup. */
async function freshDbPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flight-school-sqlite-'));
  tempDirs.push(dir);
  return path.join(dir, 'docstore.sqlite');
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

describe.skipIf(!SQLITE_AVAILABLE)('sqlite adapter', () => {
  describeDocumentStoreContract('sqlite', async () => createSqliteDocumentStore({ dbPath: await freshDbPath() }), {
    // Two connections over the same on-disk database. node:sqlite executes
    // synchronously so the two writers run strictly sequentially (one winner
    // falls out of the ordering); the paired case still pins that CAS holds
    // across separate connections, not just within one store instance.
    getPairedStores: async () => {
      const dbPath = await freshDbPath();
      return Promise.all([createSqliteDocumentStore({ dbPath }), createSqliteDocumentStore({ dbPath })]);
    },
  });

  describe('SqliteDocumentStore backend specifics', () => {
    let dbPath: string;

    beforeEach(async () => {
      dbPath = await freshDbPath();
    });

    it('surfaces etags as monotonically increasing integer strings', async () => {
      const store = await createSqliteDocumentStore({ dbPath });
      const first = await store.put('skills', 'user-a', SINGLETON_DOCUMENT_ID, { label: 'a' });
      const second = await store.put(
        'skills',
        'user-a',
        SINGLETON_DOCUMENT_ID,
        { label: 'b' },
        { ifMatch: first.etag },
      );
      const third = await store.put('habits', 'user-a', SINGLETON_DOCUMENT_ID, { label: 'c' });

      expect(Number.isInteger(Number(first.etag))).toBe(true);
      expect(Number(second.etag)).toBeGreaterThan(Number(first.etag));
      // The counter is global, so an unrelated container still advances it.
      expect(Number(third.etag)).toBeGreaterThan(Number(second.etag));
    });

    it('opens the database in WAL mode', async () => {
      await createSqliteDocumentStore({ dbPath });
      // WAL mode creates a sidecar `-wal` file alongside the main database.
      await expect(fs.access(`${dbPath}-wal`)).resolves.toBeUndefined();
    });

    it('persists documents to the file so a reopened store sees them', async () => {
      const first = await createSqliteDocumentStore({ dbPath });
      await first.put('skills', 'user-a', SINGLETON_DOCUMENT_ID, { label: 'durable' });

      const reopened = await createSqliteDocumentStore({ dbPath });
      expect(await reopened.get('skills', 'user-a', SINGLETON_DOCUMENT_ID)).toEqual({ label: 'durable' });
    });
  });
});
