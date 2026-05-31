/**
 * Root-bound filesystem primitives for the storage layer.
 *
 * The seven directory/file operations here used to live in
 * {@link import('./utils')} as module-level functions that each resolved their
 * path against the global {@link import('./utils').getStorageRoot}. That made
 * every caller share one implicit root, so a store that wanted its OWN data
 * directory (e.g. the file {@link import('./document-store/file-adapter').FileDocumentStore}
 * constructed with an explicit `dataDir`) had no way to express it — the
 * adapter silently routed writes to the process-global root regardless.
 *
 * {@link createStorageFileOps} closes that gap: it binds the seven primitives
 * to a caller-supplied `resolveRoot` thunk, so two stores can operate on two
 * roots without a shared module global. `utils.ts` re-exports a default set
 * bound to `getStorageRoot` for backward compatibility; the file adapter builds
 * its own set bound to its instance root.
 *
 * This module imports ONLY `node:fs`/`node:path`/`node:os` and the logger — it
 * has no dependency on `utils.ts`. That direction (utils → scoped-file-ops, never
 * the reverse) keeps the storage import graph acyclic, which `npm run debt:circular`
 * enforces.
 *
 * @module storage/scoped-file-ops
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { logger } from '@/lib/logger';

const log = logger.withTag('Storage FileOps');

/**
 * Safely join `segments` beneath `root`, guaranteeing the result stays within
 * that subtree. This is the only place that constructs a filesystem path from
 * caller-supplied components, so the containment check is the single chokepoint
 * for traversal defence.
 *
 * @param root - The absolute (or resolvable) base directory the result must stay under.
 * @param segments - Path segments to join relative to `root`.
 * @returns An absolute path guaranteed to be within `root`.
 * @throws {Error} when the resolved path would escape `root` via `..`, an
 *   absolute segment, or any other traversal vector.
 */
export function resolveStoragePath(root: string, segments: string[]): string {
  const baseDir = path.resolve(/* turbopackIgnore: true */ root);
  const targetPath = path.resolve(/* turbopackIgnore: true */ baseDir, ...segments);

  // The check MUST happen after path.resolve() so it catches traversal attacks
  // that only become visible once `..` segments are collapsed.
  if (!targetPath.startsWith(baseDir + path.sep) && targetPath !== baseDir) {
    throw new Error(`Path traversal detected: ${segments.join('/')}`);
  }

  return targetPath;
}

/**
 * The seven root-bound filesystem primitives shared by the storage utilities
 * and the file document-store adapter. Every method resolves its path against
 * the bound root via {@link resolveStoragePath}.
 */
export interface StorageFileOps {
  /** Create `subdir` (recursively), optionally restricting POSIX permissions. */
  ensureDir(subdir: string, options?: { mode?: number }): Promise<void>;
  /** Read a file's UTF-8 contents, or `null` when it does not exist. */
  readFile(subdir: string, filename: string): Promise<string | null>;
  /** Write a file atomically (temp + rename), creating `subdir` first. */
  writeFile(subdir: string, filename: string, content: string): Promise<void>;
  /** Atomically create a file, returning `false` (not throwing) if it exists. */
  createFileExclusive(subdir: string, filename: string, content: string): Promise<boolean>;
  /** Delete a file; absent is success. */
  deleteFile(subdir: string, filename: string): Promise<void>;
  /** Delete a directory and its contents; absent is success. */
  deleteDir(subdir: string): Promise<void>;
  /** List the file (not directory) names directly within `subdir`. */
  listFiles(subdir: string): Promise<string[]>;
}

/**
 * Build a {@link StorageFileOps} set bound to `resolveRoot`.
 *
 * `resolveRoot` is a thunk, not a value, so a binding can track a root that is
 * configured at runtime (the default set re-resolves `getStorageRoot` per call
 * so a test stubbing `FLIGHT_SCHOOL_DATA_DIR` takes effect), while an adapter
 * can bind a fixed instance root. `writeFile` and `createFileExclusive` call the
 * SAME bound `ensureDir`, so directory creation always honours the bound root.
 *
 * @param resolveRoot - Returns the base directory all ops resolve paths under.
 */
export function createStorageFileOps(resolveRoot: () => string): StorageFileOps {
  const resolve = (segments: string[]): string => resolveStoragePath(resolveRoot(), segments);

  async function ensureDir(subdir: string, options: { mode?: number } = {}): Promise<void> {
    const dirPath = resolve([subdir]);
    try {
      await fs.mkdir(dirPath, { recursive: true, mode: options.mode });
      if (options.mode !== undefined && os.platform() !== 'win32') {
        try {
          await fs.chmod(dirPath, options.mode);
        } catch (chmodError) {
          log.debug(`chmod ignored on directory: ${subdir}`, { chmodError });
        }
      }
    } catch (error) {
      log.error(`Failed to create directory: ${subdir}`, { error });
      throw error;
    }
  }

  async function readFile(subdir: string, filename: string): Promise<string | null> {
    const filePath = resolve([subdir, filename]);
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      log.error(`Failed to read file: ${subdir}/${filename}`, { error });
      throw error;
    }
  }

  async function writeFile(subdir: string, filename: string, content: string): Promise<void> {
    const filePath = resolve([subdir, filename]);
    const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;

    try {
      await ensureDir(subdir);
      await fs.writeFile(tempPath, content, 'utf-8');
      await fs.rename(tempPath, filePath);
    } catch (error) {
      try {
        await fs.unlink(tempPath);
      } catch {
        /* ignore */
      }
      log.error(`Failed to write file: ${subdir}/${filename}`, { error });
      throw error;
    }
  }

  async function createFileExclusive(subdir: string, filename: string, content: string): Promise<boolean> {
    const filePath = resolve([subdir, filename]);
    try {
      await ensureDir(subdir);
      await fs.writeFile(filePath, content, { encoding: 'utf-8', flag: 'wx' });
      return true;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return false;
      }
      log.error(`Failed to exclusively create file: ${subdir}/${filename}`, { error });
      throw error;
    }
  }

  async function deleteFile(subdir: string, filename: string): Promise<void> {
    const filePath = resolve([subdir, filename]);
    try {
      await fs.unlink(filePath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      log.error(`Failed to delete file: ${subdir}/${filename}`, { error });
      throw error;
    }
  }

  async function deleteDir(subdir: string): Promise<void> {
    const dirPath = resolve([subdir]);
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
      log.debug(`Directory deleted: ${subdir}`);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      log.error(`Failed to delete directory: ${subdir}`, { error });
      throw error;
    }
  }

  async function listFiles(subdir: string): Promise<string[]> {
    const dirPath = resolve([subdir]);
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      log.error(`Failed to list files: ${subdir}`, { error });
      throw error;
    }
  }

  return { ensureDir, readFile, writeFile, createFileExclusive, deleteFile, deleteDir, listFiles };
}
