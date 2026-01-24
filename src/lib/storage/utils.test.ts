/**
 * Tests for Storage Utilities.
 *
 * These tests use a temporary directory to avoid polluting the real storage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

// Set up test storage directory BEFORE importing the module
const TEST_STORAGE_DIR = path.join(os.tmpdir(), `flight-school-test-${Date.now()}`);
vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_STORAGE_DIR);

// Now import the module (it will use the test directory)
const {
  readStorage,
  writeStorage,
  deleteStorage,
  ensureDir,
  readFile,
  writeFile,
  deleteFile,
  deleteDir,
  listDirs,
  listFiles,
} = await import('./utils');

describe('Storage Utils', () => {
  beforeEach(async () => {
    // Ensure test directory exists
    await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ===========================================================================
  // readStorage / writeStorage tests
  // ===========================================================================

  describe('writeStorage', () => {
    it('should write JSON data to file', async () => {
      const data = { version: 1, items: ['a', 'b'] };

      await writeStorage('test.json', data);

      const content = await fs.readFile(path.join(TEST_STORAGE_DIR, 'test.json'), 'utf-8');
      expect(JSON.parse(content)).toEqual(data);
    });

    it('should format JSON with 2-space indentation', async () => {
      const data = { key: 'value' };

      await writeStorage('formatted.json', data);

      const content = await fs.readFile(path.join(TEST_STORAGE_DIR, 'formatted.json'), 'utf-8');
      expect(content).toBe('{\n  "key": "value"\n}');
    });

    it('should throw error when writing empty object', async () => {
      await expect(writeStorage('empty.json', {})).rejects.toThrow('empty data');
    });

    it('should throw error when writing empty array', async () => {
      await expect(writeStorage('empty.json', [])).rejects.toThrow('empty data');
    });

    it('should create storage directory if it does not exist', async () => {
      // Remove the directory first
      await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });

      await writeStorage('new.json', { created: true });

      const exists = await fs.stat(TEST_STORAGE_DIR).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe('readStorage', () => {
    it('should read and parse JSON data', async () => {
      const data = { version: 2, name: 'test' };
      await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
      await fs.writeFile(path.join(TEST_STORAGE_DIR, 'read.json'), JSON.stringify(data));

      const result = await readStorage('read.json', { version: 1, name: '' });

      expect(result).toEqual(data);
    });

    it('should return default schema when file does not exist', async () => {
      const defaultSchema = { version: 1, items: [] };

      const result = await readStorage('nonexistent.json', defaultSchema);

      expect(result).toEqual(defaultSchema);
    });

    it('should create file with default schema when file does not exist', async () => {
      const defaultSchema = { version: 1, items: [] };

      await readStorage('created.json', defaultSchema);

      const content = await fs.readFile(path.join(TEST_STORAGE_DIR, 'created.json'), 'utf-8');
      expect(JSON.parse(content)).toEqual(defaultSchema);
    });

    it('should return default schema when file is empty', async () => {
      await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
      await fs.writeFile(path.join(TEST_STORAGE_DIR, 'empty.json'), '');
      const defaultSchema = { version: 1 };

      const result = await readStorage('empty.json', defaultSchema);

      expect(result).toEqual(defaultSchema);
    });

    it('should return default schema when file contains only whitespace', async () => {
      await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
      await fs.writeFile(path.join(TEST_STORAGE_DIR, 'whitespace.json'), '   \n\t  ');
      const defaultSchema = { version: 1 };

      const result = await readStorage('whitespace.json', defaultSchema);

      expect(result).toEqual(defaultSchema);
    });

    it('should return default schema when JSON is invalid', async () => {
      await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
      await fs.writeFile(path.join(TEST_STORAGE_DIR, 'invalid.json'), '{ invalid json }');
      const defaultSchema = { version: 1 };

      const result = await readStorage('invalid.json', defaultSchema);

      expect(result).toEqual(defaultSchema);
    });

    it('should validate schema and return default when invalid', async () => {
      await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
      await fs.writeFile(path.join(TEST_STORAGE_DIR, 'badschema.json'), '{"version": "wrong"}');
      const defaultSchema = { version: 1 };
      const validate = (data: unknown) =>
        typeof data === 'object' && data !== null && typeof (data as { version: unknown }).version === 'number';

      const result = await readStorage('badschema.json', defaultSchema, validate);

      expect(result).toEqual(defaultSchema);
    });

    it('should return data when schema validation passes', async () => {
      const validData = { version: 2, name: 'valid' };
      await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
      await fs.writeFile(path.join(TEST_STORAGE_DIR, 'valid.json'), JSON.stringify(validData));
      const validate = (data: unknown) =>
        typeof data === 'object' && data !== null && typeof (data as { version: unknown }).version === 'number';

      const result = await readStorage('valid.json', { version: 1, name: '' }, validate);

      expect(result).toEqual(validData);
    });
  });

  describe('deleteStorage', () => {
    it('should delete existing file', async () => {
      await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
      const filePath = path.join(TEST_STORAGE_DIR, 'todelete.json');
      await fs.writeFile(filePath, '{}');

      await deleteStorage('todelete.json');

      const exists = await fs.stat(filePath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it('should not throw when file does not exist', async () => {
      await expect(deleteStorage('nonexistent.json')).resolves.toBeUndefined();
    });
  });

  // ===========================================================================
  // Directory-based storage tests
  // ===========================================================================

  describe('ensureDir', () => {
    it('should create subdirectory', async () => {
      await ensureDir('workspace/project1');

      const dirPath = path.join(TEST_STORAGE_DIR, 'workspace/project1');
      const stat = await fs.stat(dirPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should not throw if directory already exists', async () => {
      await ensureDir('existing');
      await expect(ensureDir('existing')).resolves.toBeUndefined();
    });
  });

  describe('writeFile / readFile', () => {
    it('should write and read file in subdirectory', async () => {
      const content = 'Hello, World!';

      await writeFile('mydir', 'hello.txt', content);
      const result = await readFile('mydir', 'hello.txt');

      expect(result).toBe(content);
    });

    it('should return null when file does not exist', async () => {
      const result = await readFile('missing', 'file.txt');

      expect(result).toBeNull();
    });

    it('should create parent directory when writing', async () => {
      await writeFile('newdir/nested', 'file.txt', 'content');

      const dirExists = await fs.stat(path.join(TEST_STORAGE_DIR, 'newdir/nested'))
        .then(() => true).catch(() => false);
      expect(dirExists).toBe(true);
    });
  });

  describe('deleteFile', () => {
    it('should delete file from subdirectory', async () => {
      await writeFile('dir', 'file.txt', 'content');

      await deleteFile('dir', 'file.txt');

      const result = await readFile('dir', 'file.txt');
      expect(result).toBeNull();
    });

    it('should not throw when file does not exist', async () => {
      await expect(deleteFile('nonexistent', 'file.txt')).resolves.toBeUndefined();
    });
  });

  describe('deleteDir', () => {
    it('should delete directory and all contents', async () => {
      await writeFile('todelete', 'file1.txt', 'a');
      await writeFile('todelete', 'file2.txt', 'b');
      await writeFile('todelete/nested', 'file3.txt', 'c');

      await deleteDir('todelete');

      const exists = await fs.stat(path.join(TEST_STORAGE_DIR, 'todelete'))
        .then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it('should not throw when directory does not exist', async () => {
      await expect(deleteDir('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('listDirs', () => {
    it('should list subdirectories', async () => {
      await ensureDir('parent/child1');
      await ensureDir('parent/child2');
      await writeFile('parent', 'file.txt', 'content'); // File, not dir

      const dirs = await listDirs('parent');

      expect(dirs).toContain('child1');
      expect(dirs).toContain('child2');
      expect(dirs).not.toContain('file.txt');
    });

    it('should return empty array when directory does not exist', async () => {
      const dirs = await listDirs('nonexistent');

      expect(dirs).toEqual([]);
    });

    it('should list root directories when subdir is empty string', async () => {
      await ensureDir('rootdir1');
      await ensureDir('rootdir2');

      const dirs = await listDirs('');

      expect(dirs).toContain('rootdir1');
      expect(dirs).toContain('rootdir2');
    });
  });

  describe('listFiles', () => {
    it('should list files in subdirectory', async () => {
      await writeFile('filedir', 'file1.txt', 'a');
      await writeFile('filedir', 'file2.txt', 'b');
      await ensureDir('filedir/subdir'); // Directory, not file

      const files = await listFiles('filedir');

      expect(files).toContain('file1.txt');
      expect(files).toContain('file2.txt');
      expect(files).not.toContain('subdir');
    });

    it('should return empty array when directory does not exist', async () => {
      const files = await listFiles('nonexistent');

      expect(files).toEqual([]);
    });
  });
});
