/**
 * Tests for the per-user deletion tombstone.
 *
 * The tombstone is set by `DELETE /api/user/data` before the user's
 * directory is wiped so any in-flight executor that tries to flush a
 * final delta aborts cleanly. Tests cover the round-trip:
 * mark → isDeleted → clear → isDeleted.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tombstone-test-'));
  process.env.FLIGHT_SCHOOL_DATA_DIR = tmpDir;
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.FLIGHT_SCHOOL_DATA_DIR;
});

beforeEach(async () => {
  await fs.rm(path.join(tmpDir, 'users'), { recursive: true, force: true });
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
});
