/**
 * Parity contract for the read-through-migrating compat core.
 *
 * Runs the identical §A.6 six-behaviour matrix against BOTH the file and
 * sqlite adapters, proving the migration semantics are adapter-independent.
 * Each case wraps a real {@link DocumentStore} (over a temp dir / temp DB) in a
 * {@link UserScopedStore} with the tombstone seam pinned open, and pairs it with
 * an in-memory legacy seam so the legacy-file branches are exercised without
 * touching the on-disk legacy layout (that wiring lives in `../user-storage`).
 *
 * The file adapter reads its root from a module-level env var, so the adapters
 * and the core are dynamic-imported AFTER the env stub — mirroring
 * `./scoped-store.test.ts`.
 *
 * @module storage/document-store/user-storage-core.test
 */

import { createRequire } from 'module';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DocumentStore } from './types';
import type { LegacyDocumentIO } from './user-storage-core';
import type { UserScopedStore } from './user-scoped-store';

/** node:sqlite landed in Node 22.5; skip the sqlite case on older runtimes. */
function nodeSqliteAvailable(): boolean {
  try {
    createRequire(import.meta.url)('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

const TEST_STORAGE_DIR = path.join(os.tmpdir(), `fs-compat-core-${Date.now()}`);

type CoreModule = typeof import('./user-storage-core');
type ScopedModule = typeof import('./user-scoped-store');

let core: CoreModule;
let createUserScopedStore: ScopedModule['createUserScopedStore'];
let createFileDocumentStore: typeof import('./file-adapter').createFileDocumentStore;
let createSqliteDocumentStore: typeof import('./sqlite-adapter').createSqliteDocumentStore;

beforeAll(async () => {
  vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_STORAGE_DIR);
  await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
  core = await import('./user-storage-core');
  ({ createUserScopedStore } = await import('./user-scoped-store'));
  ({ createFileDocumentStore } = await import('./file-adapter'));
  ({ createSqliteDocumentStore } = await import('./sqlite-adapter'));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });
});

/** An in-memory legacy seam: a filename→raw-contents map with idempotent delete. */
function createMemoryLegacy(seed: Record<string, string> = {}): LegacyDocumentIO & {
  store: Map<string, string>;
} {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    store,
    readRaw: async (filename) => store.get(filename) ?? null,
    remove: async (filename) => {
      store.delete(filename);
    },
  };
}

interface SampleBody {
  level: string;
}

const SAMPLE_FILENAME = 'skills-profile.json';
const DEFAULT_BODY: SampleBody = { level: 'default' };

function isSampleBody(data: unknown): data is SampleBody {
  return typeof data === 'object' && data !== null && typeof (data as SampleBody).level === 'string';
}

/** Factory returning a fresh raw store for one adapter; sqlite gets a temp DB. */
interface AdapterCase {
  name: string;
  available: boolean;
  makeStore: () => Promise<DocumentStore>;
}

const adapterCases: AdapterCase[] = [
  {
    name: 'file',
    available: true,
    makeStore: async () => createFileDocumentStore(),
  },
  {
    name: 'sqlite',
    available: nodeSqliteAvailable(),
    makeStore: async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'compat-core-sqlite-'));
      return createSqliteDocumentStore({ dbPath: path.join(dir, 'docstore.sqlite') });
    },
  },
];

describe.each(adapterCases)('compat core parity [$name adapter]', ({ available, makeStore }) => {
  /** Unique per-test userId keeps partitions isolated within a shared store. */
  let userSeq = 0;

  async function freshScoped(): Promise<UserScopedStore> {
    const store = await makeStore();
    userSeq += 1;
    return createUserScopedStore(`compat-user-${userSeq}-${Date.now()}`, store, {
      isUserDeleted: async () => false,
    });
  }

  const mapping = () => {
    const resolved = core.resolveContainerMapping(SAMPLE_FILENAME);
    if (resolved === null) {
      throw new Error('expected SAMPLE_FILENAME to be mapped');
    }
    return resolved;
  };

  const maybeIt = available ? it : it.skip;

  maybeIt('behaviour 1: missing everywhere → self-heals default as an envelope', async () => {
    const scoped = await freshScoped();
    const legacy = createMemoryLegacy();

    const read = await core.readMappedDoc(
      { store: scoped, legacy },
      mapping(),
      SAMPLE_FILENAME,
      DEFAULT_BODY,
      isSampleBody,
    );

    expect(read).toEqual(DEFAULT_BODY);
    // Self-heal targets the envelope, never the legacy file.
    expect(await scoped.get<SampleBody>(mapping().container, mapping().id)).toEqual(DEFAULT_BODY);
    expect(legacy.store.size).toBe(0);
  });

  maybeIt('behaviour 1b: valid legacy + no envelope → returns legacy WITHOUT write-back', async () => {
    const scoped = await freshScoped();
    const legacy = createMemoryLegacy({ [SAMPLE_FILENAME]: JSON.stringify({ level: 'fromLegacy' }) });

    const read = await core.readMappedDoc(
      { store: scoped, legacy },
      mapping(),
      SAMPLE_FILENAME,
      DEFAULT_BODY,
      isSampleBody,
    );

    expect(read).toEqual({ level: 'fromLegacy' });
    // Migrator (not the read path) promotes legacy → envelope; envelope stays empty.
    expect(await scoped.getEnvelope(mapping().container, mapping().id)).toBeNull();
    expect(legacy.store.get(SAMPLE_FILENAME)).toBe(JSON.stringify({ level: 'fromLegacy' }));
  });

  maybeIt('behaviour 2: corrupt envelope → overwrites with default', async () => {
    const scoped = await freshScoped();
    const legacy = createMemoryLegacy();
    await scoped.put(mapping().container, mapping().id, { not: 'valid' });

    const read = await core.readMappedDoc(
      { store: scoped, legacy },
      mapping(),
      SAMPLE_FILENAME,
      DEFAULT_BODY,
      isSampleBody,
    );

    expect(read).toEqual(DEFAULT_BODY);
    expect(await scoped.get<SampleBody>(mapping().container, mapping().id)).toEqual(DEFAULT_BODY);
  });

  maybeIt('behaviour 2b: corrupt legacy JSON + no envelope → self-heals default', async () => {
    const scoped = await freshScoped();
    const legacy = createMemoryLegacy({ [SAMPLE_FILENAME]: '{ this is not json' });

    const read = await core.readMappedDoc(
      { store: scoped, legacy },
      mapping(),
      SAMPLE_FILENAME,
      DEFAULT_BODY,
      isSampleBody,
    );

    expect(read).toEqual(DEFAULT_BODY);
    expect(await scoped.get<SampleBody>(mapping().container, mapping().id)).toEqual(DEFAULT_BODY);
  });

  maybeIt('valid envelope wins over legacy', async () => {
    const scoped = await freshScoped();
    const legacy = createMemoryLegacy({ [SAMPLE_FILENAME]: JSON.stringify({ level: 'fromLegacy' }) });
    await scoped.put(mapping().container, mapping().id, { level: 'fromEnvelope' });

    const read = await core.readMappedDoc(
      { store: scoped, legacy },
      mapping(),
      SAMPLE_FILENAME,
      DEFAULT_BODY,
      isSampleBody,
    );

    expect(read).toEqual({ level: 'fromEnvelope' });
  });

  maybeIt('write round-trips through the envelope and is read back', async () => {
    const scoped = await freshScoped();
    const legacy = createMemoryLegacy();

    await core.writeMappedDoc(
      { store: scoped, legacy },
      mapping(),
      SAMPLE_FILENAME,
      { level: 'written' },
      isSampleBody,
    );

    const read = await core.readMappedDoc(
      { store: scoped, legacy },
      mapping(),
      SAMPLE_FILENAME,
      DEFAULT_BODY,
      isSampleBody,
    );
    expect(read).toEqual({ level: 'written' });
  });

  maybeIt('behaviour 4: write rejects a schema-invalid payload', async () => {
    const scoped = await freshScoped();
    const legacy = createMemoryLegacy();

    await expect(
      core.writeMappedDoc(
        { store: scoped, legacy },
        mapping(),
        SAMPLE_FILENAME,
        { wrong: 'shape' } as unknown as SampleBody,
        isSampleBody,
      ),
    ).rejects.toThrow(/Invalid storage schema/);
  });

  maybeIt('behaviour 3: write rejects an empty-object serialization', async () => {
    const scoped = await freshScoped();
    const legacy = createMemoryLegacy();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- type predicate param is only referenced in the `is` clause
    const alwaysValid = (_data: unknown): _data is Record<string, never> => true;

    await expect(
      core.writeMappedDoc({ store: scoped, legacy }, mapping(), SAMPLE_FILENAME, {}, alwaysValid),
    ).rejects.toThrow(/Attempted to write empty data/);
  });

  maybeIt('behaviour 6: remove clears BOTH envelope and shadowed legacy, idempotently', async () => {
    const scoped = await freshScoped();
    const legacy = createMemoryLegacy({ [SAMPLE_FILENAME]: JSON.stringify({ level: 'fromLegacy' }) });
    await scoped.put(mapping().container, mapping().id, { level: 'fromEnvelope' });

    await core.removeMappedDoc({ store: scoped, legacy }, mapping(), SAMPLE_FILENAME);
    expect(await scoped.getEnvelope(mapping().container, mapping().id)).toBeNull();
    expect(legacy.store.has(SAMPLE_FILENAME)).toBe(false);

    // Idempotent second remove does not throw.
    await expect(core.removeMappedDoc({ store: scoped, legacy }, mapping(), SAMPLE_FILENAME)).resolves.toBeUndefined();
  });
});

describe('resolveContainerMapping', () => {
  it('maps every migrated singleton to its container with the singleton id', async () => {
    const { SINGLETON_DOCUMENT_ID } = await import('./types');
    const cases: Array<[string, string]> = [
      ['skills-profile.json', 'skills'],
      ['habits.json', 'habits'],
      ['focus-storage.json', 'focus'],
      ['profile-cache.json', 'profile'],
      ['challenge-queue.json', 'challenge-queue'],
    ];
    for (const [filename, container] of cases) {
      expect(core.resolveContainerMapping(filename)).toEqual({
        container,
        id: SINGLETON_DOCUMENT_ID,
      });
    }
  });

  it('returns null for an unmapped filename', () => {
    expect(core.resolveContainerMapping('threads.json')).toBeNull();
  });
});
