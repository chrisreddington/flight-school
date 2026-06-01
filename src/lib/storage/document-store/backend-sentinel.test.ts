/**
 * Tests for the backend-neutral storage sentinel (§0.5).
 *
 * The sentinel is the one piece of coordination state that must be readable
 * before any adapter is chosen, so it is a raw file — never routed through a
 * `DocumentStore`. These tests pin the three behaviours the split-brain guard
 * depends on: first-writer-wins create, mismatch refusal, and corrupt = fatal.
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BackendSentinelCorruptError,
  BackendSentinelMismatchError,
  STORAGE_SCHEMA_VERSION,
  SENTINEL_FILENAME,
  readSentinel,
  reconcileBackendSentinel,
} from './backend-sentinel';

const tempDirs: string[] = [];

async function freshDataDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-sentinel-'));
  tempDirs.push(dir);
  return dir;
}

function sentinelPath(dataDir: string): string {
  return path.join(dataDir, SENTINEL_FILENAME);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('reconcileBackendSentinel', () => {
  it('creates the sentinel when absent and returns the chosen backend', async () => {
    const dataDir = await freshDataDir();

    const result = await reconcileBackendSentinel({ dataDir, backend: 'file' });

    expect(result).toEqual({ backend: 'file', schemaVersion: STORAGE_SCHEMA_VERSION });
    const onDisk: unknown = JSON.parse(await fs.readFile(sentinelPath(dataDir), 'utf-8'));
    expect(onDisk).toEqual({ backend: 'file', schemaVersion: STORAGE_SCHEMA_VERSION });
  });

  it('accepts a matching pre-existing sentinel without rewriting it', async () => {
    const dataDir = await freshDataDir();
    await reconcileBackendSentinel({ dataDir, backend: 'sqlite' });
    const firstBytes = await fs.readFile(sentinelPath(dataDir));

    const result = await reconcileBackendSentinel({ dataDir, backend: 'sqlite' });

    expect(result.backend).toBe('sqlite');
    const secondBytes = await fs.readFile(sentinelPath(dataDir));
    expect(secondBytes.equals(firstBytes)).toBe(true);
  });

  it('refuses to start when the requested backend differs from the sentinel', async () => {
    const dataDir = await freshDataDir();
    await reconcileBackendSentinel({ dataDir, backend: 'file' });

    await expect(reconcileBackendSentinel({ dataDir, backend: 'sqlite' })).rejects.toBeInstanceOf(
      BackendSentinelMismatchError,
    );
  });

  it('refuses to start when the schema version is incompatible', async () => {
    const dataDir = await freshDataDir();
    await fs.writeFile(
      sentinelPath(dataDir),
      JSON.stringify({ backend: 'file', schemaVersion: STORAGE_SCHEMA_VERSION + 1 }),
    );

    await expect(reconcileBackendSentinel({ dataDir, backend: 'file' })).rejects.toBeInstanceOf(
      BackendSentinelMismatchError,
    );
  });

  it('hard-fails on a corrupt sentinel and leaves the file untouched', async () => {
    const dataDir = await freshDataDir();
    const corruptBytes = Buffer.from('{ this is not valid json', 'utf-8');
    await fs.writeFile(sentinelPath(dataDir), corruptBytes);

    await expect(reconcileBackendSentinel({ dataDir, backend: 'file' })).rejects.toBeInstanceOf(
      BackendSentinelCorruptError,
    );

    const afterBytes = await fs.readFile(sentinelPath(dataDir));
    expect(afterBytes.equals(corruptBytes)).toBe(true);
  });

  it('hard-fails on a structurally invalid sentinel (missing backend)', async () => {
    const dataDir = await freshDataDir();
    await fs.writeFile(sentinelPath(dataDir), JSON.stringify({ schemaVersion: STORAGE_SCHEMA_VERSION }));

    await expect(reconcileBackendSentinel({ dataDir, backend: 'file' })).rejects.toBeInstanceOf(
      BackendSentinelCorruptError,
    );
  });

  it('creates the data directory if it does not yet exist', async () => {
    const dataDir = path.join(await freshDataDir(), 'nested', 'data');

    const result = await reconcileBackendSentinel({ dataDir, backend: 'file' });

    expect(result.backend).toBe('file');
    const onDisk: unknown = JSON.parse(await fs.readFile(sentinelPath(dataDir), 'utf-8'));
    expect(onDisk).toMatchObject({ backend: 'file' });
  });
});

describe('readSentinel', () => {
  it('returns null when no sentinel file exists (a fresh data dir)', async () => {
    const dataDir = await freshDataDir();

    expect(await readSentinel(dataDir)).toBeNull();
  });

  it('returns the parsed record for an existing sentinel without creating one', async () => {
    const dataDir = await freshDataDir();
    await reconcileBackendSentinel({ dataDir, backend: 'sqlite' });

    expect(await readSentinel(dataDir)).toEqual({ backend: 'sqlite', schemaVersion: STORAGE_SCHEMA_VERSION });
  });

  it('hard-fails on a corrupt sentinel rather than reporting it absent', async () => {
    const dataDir = await freshDataDir();
    await fs.writeFile(sentinelPath(dataDir), Buffer.from('{ not json', 'utf-8'));

    await expect(readSentinel(dataDir)).rejects.toBeInstanceOf(BackendSentinelCorruptError);
  });

  it('hard-fails on a structurally invalid sentinel (missing backend)', async () => {
    const dataDir = await freshDataDir();
    await fs.writeFile(sentinelPath(dataDir), JSON.stringify({ schemaVersion: STORAGE_SCHEMA_VERSION }));

    await expect(readSentinel(dataDir)).rejects.toBeInstanceOf(BackendSentinelCorruptError);
  });
});
