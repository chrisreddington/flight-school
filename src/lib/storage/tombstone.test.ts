/**
 * Tests for the per-user deletion tombstone.
 *
 * The tombstone is set by `DELETE /api/user/data` before the user's
 * directory is wiped so any in-flight executor that tries to flush a
 * final delta aborts cleanly. Tests cover the round-trip:
 * mark → isDeleted → clear → isDeleted.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tombstone-test-'));
  vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', tmpDir);
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await fs.rm(path.join(tmpDir, 'users'), { recursive: true, force: true });
  await fs.rm(path.join(tmpDir, 'tombstones'), { recursive: true, force: true });
});

describe('tombstone', () => {
  it('returns false when no marker has been written', async () => {
    const { isUserDeleted } = await import('./tombstone');
    expect(await isUserDeleted('fresh-user')).toBe(false);
  });

  it('marks then detects deletion', async () => {
    const { markUserDeleted, isUserDeleted } = await import('./tombstone');
    await markUserDeleted('u-1');
    expect(await isUserDeleted('u-1')).toBe(true);
  });

  it('clears the tombstone on demand', async () => {
    const { markUserDeleted, clearUserTombstone, isUserDeleted } = await import('./tombstone');
    await markUserDeleted('u-2');
    expect(await isUserDeleted('u-2')).toBe(true);
    await clearUserTombstone('u-2');
    expect(await isUserDeleted('u-2')).toBe(false);
  });

  it('reflects an out-of-band clear by another process (no positive cache)', async () => {
    // Regression guard: a process-local positive cache would keep returning
    // true after the marker file is removed by a SEPARATE process (e.g. the
    // Next.js sign-in clear while this worker holds the write guard),
    // permanently wedging a resurrected user. Deleting the file directly —
    // not via clearUserTombstone — simulates that cross-process clear.
    const { markUserDeleted, isUserDeleted } = await import('./tombstone');
    await markUserDeleted('u-cross-process');
    expect(await isUserDeleted('u-cross-process')).toBe(true);
    await fs.rm(path.join(tmpDir, 'tombstones'), { recursive: true, force: true });
    expect(await isUserDeleted('u-cross-process')).toBe(false);
  });

  it('writes the marker outside the users/ subtree', async () => {
    const { markUserDeleted } = await import('./tombstone');
    await markUserDeleted('u-3');
    const newPath = path.join(tmpDir, 'tombstones', 'u-3.json');
    // The storage layer may append an extension. Probe the directory.
    const entries = await fs.readdir(path.join(tmpDir, 'tombstones'));
    expect(entries.some((e) => e.startsWith('u-3'))).toBe(true);
    expect(newPath).toBeDefined();
  });

  it('falls back to the legacy users/{id}/.deleted path on read', async () => {
    // Simulate a tombstone written by an older build by writing
    // directly to the legacy location.
    const legacyDir = path.join(tmpDir, 'users', 'legacy-user');
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, '.deleted'), '"2024-01-01T00:00:00.000Z"', 'utf8');
    const { isUserDeleted } = await import('./tombstone');
    expect(await isUserDeleted('legacy-user')).toBe(true);
  });
});
