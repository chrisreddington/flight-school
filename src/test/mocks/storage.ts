/**
 * Storage test helpers for file-based persistence.
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';

export interface TestStorageContext {
  /** Absolute path to the temporary storage directory. */
  storageDir: string;
  /** Removes the directory and restores stubbed env values. */
  cleanup: () => Promise<void>;
}

interface TestStorageOptions {
  /** Prefix for the temp directory name. */
  prefix?: string;
  /** Whether to stub FLIGHT_SCHOOL_DATA_DIR. Defaults to true. */
  stubEnv?: boolean;
}

/**
 * Creates a temporary storage directory and stubs the storage env variable.
 *
 * @remarks
 * Call this before importing storage modules that read env values on load.
 *
 * @param options - Optional configuration for the temp directory.
 * @returns A context with the storage directory path and cleanup helper.
 */
export function createTestStorageContext(options: TestStorageOptions = {}): TestStorageContext {
  const { prefix = 'flight-school-test', stubEnv = true } = options;
  const storageDir = path.join(
    os.tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  if (stubEnv) {
    vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', storageDir);
  }

  return {
    storageDir,
    cleanup: async () => {
      await fs.rm(storageDir, { recursive: true, force: true });
      if (stubEnv) {
        vi.unstubAllEnvs();
      }
    },
  };
}

/**
 * Ensures the temporary storage directory exists.
 *
 * @param storageDir - Directory to create if missing.
 */
export async function ensureTestStorageDirectory(storageDir: string): Promise<void> {
  await fs.mkdir(storageDir, { recursive: true });
}
