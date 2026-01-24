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

const log = logger.withTag('Storage Utils');

/** Determines the appropriate storage directory based on platform. */
function getDefaultStorageDir(): string {
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

const STORAGE_DIR = getDefaultStorageDir();

/**
 * Validates a path segment to prevent directory traversal attacks.
 * Rejects paths containing '..' or absolute path indicators.
 * @throws Error if path segment is invalid
 */
function validatePathSegment(segment: string, paramName: string): void {
  if (!segment || typeof segment !== 'string') {
    throw new Error(`${paramName} must be a non-empty string`);
  }
  
  // Normalize and check for traversal attempts
  const normalized = path.normalize(segment);
  
  // Reject if contains parent directory references
  if (normalized.includes('..')) {
    throw new Error(`${paramName} cannot contain parent directory references`);
  }
  
  // Reject absolute paths
  if (path.isAbsolute(segment) || path.isAbsolute(normalized)) {
    throw new Error(`${paramName} must be a relative path`);
  }
  
  // Reject if normalized path escapes (starts with ..)
  if (normalized.startsWith('..')) {
    throw new Error(`${paramName} cannot escape storage directory`);
  }
}

/**
 * Validates that a constructed path is within the storage directory.
 * @throws Error if path escapes storage boundary
 */
function validateWithinStorage(fullPath: string): void {
  const resolved = path.resolve(fullPath);
  const storageResolved = path.resolve(STORAGE_DIR);
  
  if (!resolved.startsWith(storageResolved + path.sep) && resolved !== storageResolved) {
    throw new Error('Path must be within storage directory');
  }
}

/** Ensures the .data storage directory exists (internal). */
async function ensureStorageDir(): Promise<void> {
  try {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
  } catch (error) {
    log.error('Failed to create storage directory', { error });
    throw error;
  }
}

/** Gets the full path for a storage file in .data directory (internal). */
function getStoragePath(filename: string): string {
  validatePathSegment(filename, 'filename');
  const fullPath = path.join(STORAGE_DIR, filename);
  validateWithinStorage(fullPath);
  return fullPath;
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
  validate?: (data: unknown) => boolean
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
export async function writeStorage<T>(
  filename: string,
  data: T
): Promise<void> {
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
      bytes: jsonData.length
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
 * Gets the full path for a subdirectory in .data directory.
 */
function getStorageDir(subdir: string): string {
  validatePathSegment(subdir, 'subdir');
  const fullPath = path.join(STORAGE_DIR, subdir);
  validateWithinStorage(fullPath);
  return fullPath;
}

/**
 * Ensures a subdirectory exists in .data directory.
 * 
 * @param subdir - Subdirectory path relative to .data
 */
export async function ensureDir(subdir: string): Promise<void> {
  const dirPath = getStorageDir(subdir);
  try {
    await fs.mkdir(dirPath, { recursive: true });
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
  validatePathSegment(filename, 'filename');
  const filePath = path.join(getStorageDir(subdir), filename);
  validateWithinStorage(filePath);
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
  validatePathSegment(filename, 'filename');
  const dirPath = getStorageDir(subdir);
  const filePath = path.join(dirPath, filename);
  validateWithinStorage(filePath);
  const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  
  try {
    await ensureDir(subdir);
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    try { await fs.unlink(tempPath); } catch { /* ignore */ }
    log.error(`Failed to write file: ${subdir}/${filename}`, { error });
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
  validatePathSegment(filename, 'filename');
  const filePath = path.join(getStorageDir(subdir), filename);
  validateWithinStorage(filePath);
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
  const dirPath = getStorageDir(subdir);
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
  const dirPath = subdir ? getStorageDir(subdir) : STORAGE_DIR;
  try {
    await ensureStorageDir();
    if (subdir) await ensureDir(subdir);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
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
  const dirPath = getStorageDir(subdir);
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter(e => e.isFile()).map(e => e.name);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    log.error(`Failed to list files: ${subdir}`, { error });
    throw error;
  }
}
