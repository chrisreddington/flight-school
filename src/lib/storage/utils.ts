/**
 * Storage Utilities
 *
 * Reusable utilities for server-side file storage in user data directory.
 * Ensures atomic writes, schema validation, and consistent error handling.
 *
 * Storage location (cross-platform):
 * - Linux/macOS: ~/.local/share/flight-school/
 * - Windows: %LOCALAPPDATA%\flight-school\
 * - Override: FLIGHT_SCHOOL_DATA_DIR environment variable
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '@/lib/logger';

/**
 * Re-exported from the `node:fs`-free {@link import('./safe-path')} leaf so that
 * `@/lib/storage/utils` remains the public import path for server callers while
 * client-reachable validators can import the pure helper directly without
 * pulling `node:fs` into the browser bundle.
 */
export { safeChildPath } from './safe-path';

const log = logger.withTag('Storage Utils');

/** Determines the appropriate storage directory based on platform. */
export function getStorageRoot(): string {
  // Allow override via environment variable
  if (process.env.FLIGHT_SCHOOL_DATA_DIR) {
    return process.env.FLIGHT_SCHOOL_DATA_DIR;
  }

  const platform = os.platform();
  const home = os.homedir();

  if (platform === 'win32') {
    // Windows: %LOCALAPPDATA%\flight-school\
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(localAppData, 'flight-school');
  }

  // Linux/macOS: ~/.local/share/flight-school/
  return path.join(home, '.local', 'share', 'flight-school');
}

/**
 * Safely joins path segments and ensures the result is within the storage root.
 * This is the ONLY function that should construct paths from user input.
 *
 * The storage root is resolved per call via {@link getStorageRoot} rather than
 * captured once at module load: `FLIGHT_SCHOOL_DATA_DIR` is a runtime config
 * source, so a value set after this module first evaluates (the common case in
 * per-test isolation, where the env is stubbed before each test) must still
 * take effect. Caching it here previously made the resolved directory depend on
 * import order, which silently routed writes to the real home directory.
 *
 * @param segments - Path segments to join (relative to the storage root)
 * @returns Absolute path guaranteed to be within the storage root
 * @throws Error if the resulting path would escape the storage root
 */
function safePath(...segments: string[]): string {
  // Resolve the base storage directory to an absolute path
  const baseDir = path.resolve(/* turbopackIgnore: true */ getStorageRoot());

  // Join all segments and resolve to absolute path
  const targetPath = path.resolve(/* turbopackIgnore: true */ baseDir, ...segments);

  // Ensure the resolved path starts with baseDir
  // This check MUST happen after path.resolve() to catch traversal attacks
  if (!targetPath.startsWith(baseDir + path.sep) && targetPath !== baseDir) {
    throw new Error(`Path traversal detected: ${segments.join('/')}`);
  }

  return targetPath;
}

/**
 * Resolve a path that MUST stay under `baseDir`. Throws if any segment (or the
 * resolved path) escapes that subtree via `..`, absolute paths, embedded
 * separators, NUL bytes, or other tricks.
 *
 * Unlike {@link safePath} (which only verifies containment within the global
 * storage root), this validates containment within a caller-specified subtree.
 * Use it when constructing a filesystem path from caller-supplied components
 * (e.g. workspace filenames) where the caller must not be able to escape into
 * a sibling subtree such as another user's data directory.
 *
 * @remarks
 * The implementation lives in the `node:fs`-free {@link import('./safe-path')}
 * leaf and is re-exported above; see that module for the full contract.
 */

/** Ensures the .data storage directory exists (internal). */
async function ensureStorageDir(): Promise<void> {
  try {
    await fs.mkdir(getStorageRoot(), { recursive: true });
  } catch (error) {
    log.error('Failed to create storage directory', { error });
    throw error;
  }
}

/** Gets the full path for a storage file in .data directory (internal). */
function getStoragePath(filename: string): string {
  return safePath(filename);
}

/**
 * Reads and parses a JSON storage file with schema validation.
 *
 * @template T - The expected schema type
 * @param filename - Name of file in .data directory
 * @param defaultSchema - Default schema if file doesn't exist or is invalid
 * @param validate - Optional validation function
 * @returns Parsed and validated schema
 *
 * @example
 * ```typescript
 * const storage = await readStorage<MySchema>(
 *   'my-data.json',
 *   { version: 1, data: [] },
 *   (data) => typeof data.version === 'number'
 * );
 * ```
 */
export async function readStorage<T>(
  filename: string,
  defaultSchema: T,
  validate?: (data: unknown) => boolean,
): Promise<T> {
  const filePath = getStoragePath(filename);

  try {
    await ensureStorageDir();
    const data = await fs.readFile(filePath, 'utf-8');

    // Handle empty file
    if (!data || data.trim().length === 0) {
      log.warn(`Empty storage file: ${filename}, using default schema`);
      await writeStorage(filename, defaultSchema);
      return defaultSchema;
    }

    const parsed = JSON.parse(data);

    // Validate schema if validator provided
    if (validate && !validate(parsed)) {
      log.warn(`Invalid schema in ${filename}, using default schema`);
      await writeStorage(filename, defaultSchema);
      return defaultSchema;
    }

    return parsed as T;
  } catch (error: unknown) {
    // File doesn't exist - create with default
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      log.debug(`Storage file does not exist: ${filename}, initializing`);
      await writeStorage(filename, defaultSchema);
      return defaultSchema;
    }

    // JSON parse error or other error - use default
    log.error(`Failed to read storage file: ${filename}`, { error });
    await writeStorage(filename, defaultSchema);
    return defaultSchema;
  }
}

/**
 * Writes data to storage file atomically (temp file + rename).
 *
 * @template T - The schema type
 * @param filename - Name of file in .data directory
 * @param data - Data to write
 *
 * @example
 * ```typescript
 * await writeStorage('my-data.json', { version: 1, items: [] });
 * ```
 */
export async function writeStorage<T>(filename: string, data: T): Promise<void> {
  const filePath = getStoragePath(filename);
  // Use unique temp file per write to avoid race conditions with concurrent writes
  const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;

  try {
    await ensureStorageDir();

    // Validate data is not empty
    const jsonData = JSON.stringify(data, null, 2);
    if (jsonData.length === 0 || jsonData === '{}' || jsonData === '[]') {
      throw new Error(`Attempted to write empty data to ${filename}`);
    }

    // Atomic write: write to temp, then rename
    await fs.writeFile(tempPath, jsonData, 'utf-8');
    await fs.rename(tempPath, filePath);

    log.debug(`Storage written successfully: ${filename}`, {
      bytes: jsonData.length,
    });
  } catch (error) {
    // Clean up temp file if it exists
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }

    log.error(`Failed to write storage file: ${filename}`, { error });
    throw error;
  }
}

/**
 * Deletes a storage file.
 *
 * @param filename - Name of file in .data directory
 */
export async function deleteStorage(filename: string): Promise<void> {
  const filePath = getStoragePath(filename);

  try {
    await fs.unlink(filePath);
    log.debug(`Storage file deleted: ${filename}`);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist - that's fine
      return;
    }
    log.error(`Failed to delete storage file: ${filename}`, { error });
    throw error;
  }
}

// =============================================================================
// Directory-Based Storage (for workspaces)
// =============================================================================

/**
 * Ensures a subdirectory exists in .data directory.
 *
 * @param subdir - Subdirectory path relative to .data
 * @param options - Optional mkdir options. Pass `mode` (e.g. `0o700`) to
 *   restrict the directory permissions on platforms that honour POSIX modes.
 *   On Windows the mode is ignored by the OS.
 */
export async function ensureDir(subdir: string, options: { mode?: number } = {}): Promise<void> {
  const dirPath = safePath(subdir);
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

/**
 * Reads a file from a subdirectory.
 *
 * @param subdir - Subdirectory path relative to .data
 * @param filename - Name of file in subdirectory
 * @returns File contents or null if not found
 */
export async function readFile(subdir: string, filename: string): Promise<string | null> {
  const filePath = safePath(subdir, filename);
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

/**
 * Writes a file to a subdirectory atomically.
 *
 * @param subdir - Subdirectory path relative to .data
 * @param filename - Name of file in subdirectory
 * @param content - File content to write
 */
export async function writeFile(subdir: string, filename: string, content: string): Promise<void> {
  const filePath = safePath(subdir, filename);
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

/**
 * Atomically creates a file, failing if it already exists.
 *
 * Uses the OS-level exclusive-create flag (`wx`), so two callers racing the
 * same path can never both succeed: exactly one create wins and every other
 * caller observes `EEXIST`. This closes the create-only TOCTOU window that the
 * temp-write-then-rename {@link writeFile} path leaves open. The document-store
 * file adapter relies on this to give `ifNoneMatch: '*'` real uniqueness under
 * concurrency (e.g. racing track enrollments claiming the same slot).
 *
 * The atomicity guarantee holds for a local POSIX/NTFS filesystem; it is not
 * claimed for networked filesystems where `O_EXCL` is unreliable.
 *
 * @param subdir - Subdirectory path relative to the storage root.
 * @param filename - Name of the file to create within the subdirectory.
 * @param content - File content to write.
 * @returns `true` when this call created the file, `false` when it already
 *   existed (the caller decides whether that is a conflict).
 */
export async function createFileExclusive(subdir: string, filename: string, content: string): Promise<boolean> {
  const filePath = safePath(subdir, filename);
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

/**
 * Deletes a file from a subdirectory.
 *
 * @param subdir - Subdirectory path relative to .data
 * @param filename - Name of file in subdirectory
 */
export async function deleteFile(subdir: string, filename: string): Promise<void> {
  const filePath = safePath(subdir, filename);
  try {
    await fs.unlink(filePath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return; // File doesn't exist - that's fine
    }
    log.error(`Failed to delete file: ${subdir}/${filename}`, { error });
    throw error;
  }
}

/**
 * Deletes an entire subdirectory and its contents.
 *
 * @param subdir - Subdirectory path relative to .data
 */
export async function deleteDir(subdir: string): Promise<void> {
  const dirPath = safePath(subdir);
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

/**
 * Lists subdirectories in a directory.
 *
 * @param subdir - Subdirectory path relative to .data (empty string for .data root)
 * @returns Array of subdirectory names
 */
export async function listDirs(subdir: string): Promise<string[]> {
  const dirPath = subdir ? safePath(subdir) : path.resolve(/* turbopackIgnore: true */ getStorageRoot());
  try {
    await ensureStorageDir();
    if (subdir) await ensureDir(subdir);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    log.error(`Failed to list directories: ${subdir}`, { error });
    throw error;
  }
}

/**
 * Lists files in a subdirectory.
 *
 * @param subdir - Subdirectory path relative to .data
 * @returns Array of filenames
 */
export async function listFiles(subdir: string): Promise<string[]> {
  const dirPath = safePath(subdir);
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    log.error(`Failed to list files: ${subdir}`, { error });
    throw error;
  }
}
