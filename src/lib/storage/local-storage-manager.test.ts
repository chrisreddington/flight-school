/**
 * LocalStorageManager Tests
 *
 * Tests for the generic localStorage wrapper with versioning and migration.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { LocalStorageManager, type StorageSchema } from './local-storage-manager';

// Mock date utilities
vi.mock('@/lib/utils/date-utils', () => ({
  now: () => '2026-01-24T12:00:00.000Z',
}));

// Mock logger to prevent noise
vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// =============================================================================
// Test Setup
// =============================================================================

interface TestData {
  items: string[];
  count: number;
}

const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    get length() { return Object.keys(store).length; },
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
    _getStore: () => store,
  };
})();

// =============================================================================
// Tests
// =============================================================================

describe('LocalStorageManager', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    vi.clearAllMocks();
    
    // Setup window.localStorage mock
    vi.stubGlobal('window', { localStorage: mockLocalStorage });
    vi.stubGlobal('localStorage', mockLocalStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('constructor', () => {
    it('should create instance with options', () => {
      const manager = new LocalStorageManager<TestData>({
        key: 'test-key',
        version: 1,
        defaultValue: { items: [], count: 0 },
      });

      expect(manager).toBeInstanceOf(LocalStorageManager);
    });
  });

  describe('get', () => {
    it('should return defaultValue when no data exists', () => {
      const manager = new LocalStorageManager<TestData>({
        key: 'test-key',
        version: 1,
        defaultValue: { items: ['default'], count: 1 },
      });

      const result = manager.get();
      expect(result).toEqual({ items: ['default'], count: 1 });
    });

    it('should return stored data when valid', () => {
      const storedSchema: StorageSchema<TestData> = {
        version: 1,
        data: { items: ['stored'], count: 5 },
        updatedAt: '2026-01-20T00:00:00.000Z',
      };
      mockLocalStorage.setItem('test-key', JSON.stringify(storedSchema));

      const manager = new LocalStorageManager<TestData>({
        key: 'test-key',
        version: 1,
        defaultValue: { items: [], count: 0 },
      });

      const result = manager.get();
      expect(result).toEqual({ items: ['stored'], count: 5 });
    });

    it('should reset and return defaultValue for corrupted JSON', () => {
      mockLocalStorage.setItem('test-key', 'not valid json{{{');

      const manager = new LocalStorageManager<TestData>({
        key: 'test-key',
        version: 1,
        defaultValue: { items: ['default'], count: 0 },
      });

      const result = manager.get();
      expect(result).toEqual({ items: ['default'], count: 0 });
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('test-key');
    });

    it('should reset when schema structure is invalid', () => {
      // Missing version field
      mockLocalStorage.setItem('test-key', JSON.stringify({ data: { items: [] } }));

      const manager = new LocalStorageManager<TestData>({
        key: 'test-key',
        version: 1,
        defaultValue: { items: ['default'], count: 0 },
      });

      const result = manager.get();
      expect(result).toEqual({ items: ['default'], count: 0 });
    });
  });

  describe('version migration', () => {
    it('should migrate data when version mismatch', () => {
      const oldSchema: StorageSchema<{ items: string[] }> = {
        version: 1,
        data: { items: ['old'] },
        updatedAt: '2026-01-20T00:00:00.000Z',
      };
      mockLocalStorage.setItem('test-key', JSON.stringify(oldSchema));

      const manager = new LocalStorageManager<TestData>({
        key: 'test-key',
        version: 2,
        defaultValue: { items: [], count: 0 },
        migrate: (oldData, fromVersion) => {
          if (fromVersion === 1) {
            const old = oldData as { items: string[] };
            return { items: old.items, count: old.items.length };
          }
          return oldData as TestData;
        },
      });

      const result = manager.get();
      expect(result).toEqual({ items: ['old'], count: 1 });
    });

    it('should reset to defaults when no migration function and version mismatch', () => {
      const oldSchema: StorageSchema<TestData> = {
        version: 1,
        data: { items: ['old'], count: 5 },
        updatedAt: '2026-01-20T00:00:00.000Z',
      };
      mockLocalStorage.setItem('test-key', JSON.stringify(oldSchema));

      const manager = new LocalStorageManager<TestData>({
        key: 'test-key',
        version: 2,
        defaultValue: { items: [], count: 0 },
        // No migrate function
      });

      const result = manager.get();
      expect(result).toEqual({ items: [], count: 0 });
    });

    it('should reset when migration throws', () => {
      const oldSchema: StorageSchema<TestData> = {
        version: 1,
        data: { items: ['old'], count: 5 },
        updatedAt: '2026-01-20T00:00:00.000Z',
      };
      mockLocalStorage.setItem('test-key', JSON.stringify(oldSchema));

      const manager = new LocalStorageManager<TestData>({
        key: 'test-key',
        version: 2,
        defaultValue: { items: ['default'], count: 0 },
        migrate: () => {
          throw new Error('Migration failed');
        },
      });

      const result = manager.get();
      expect(result).toEqual({ items: ['default'], count: 0 });
    });
  });

  describe('validation', () => {
    it('should validate data when validator provided', () => {
      const storedSchema: StorageSchema<TestData> = {
        version: 1,
        data: { items: ['valid'], count: 1 },
        updatedAt: '2026-01-20T00:00:00.000Z',
      };
      mockLocalStorage.setItem('test-key', JSON.stringify(storedSchema));

      const manager = new LocalStorageManager<TestData>({
        key: 'test-key',
        version: 1,
        defaultValue: { items: [], count: 0 },
        validate: (data): data is TestData => {
          const d = data as TestData;
          return Array.isArray(d.items) && typeof d.count === 'number';
        },
      });

      const result = manager.get();
      expect(result).toEqual({ items: ['valid'], count: 1 });
    });

    it('should reset when validation fails', () => {
      const storedSchema: StorageSchema<TestData> = {
        version: 1,
        data: { items: 'not-array' as unknown as string[], count: 1 },
        updatedAt: '2026-01-20T00:00:00.000Z',
      };
      mockLocalStorage.setItem('test-key', JSON.stringify(storedSchema));

      const manager = new LocalStorageManager<TestData>({
        key: 'test-key',
        version: 1,
        defaultValue: { items: ['default'], count: 0 },
        validate: (data): data is TestData => {
          const d = data as TestData;
          return Array.isArray(d.items);
        },
      });

      const result = manager.get();
      expect(result).toEqual({ items: ['default'], count: 0 });
    });
  });

  describe('save', () => {
    it('should save data with schema wrapper', () => {
      const manager = new LocalStorageManager<TestData>({
        key: 'test-key',
        version: 1,
        defaultValue: { items: [], count: 0 },
      });

      manager.save({ items: ['new'], count: 1 });

      const stored = JSON.parse(mockLocalStorage._getStore()['test-key']);
      expect(stored.version).toBe(1);
      expect(stored.data).toEqual({ items: ['new'], count: 1 });
      expect(stored.updatedAt).toBe('2026-01-24T12:00:00.000Z');
    });
  });

  describe('clear', () => {
    it('should remove data from localStorage', () => {
      mockLocalStorage.setItem('test-key', 'some data');

      const manager = new LocalStorageManager<TestData>({
        key: 'test-key',
        version: 1,
        defaultValue: { items: [], count: 0 },
      });

      manager.clear();
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('test-key');
    });
  });

  describe('exists', () => {
    it('should return true when data exists', () => {
      mockLocalStorage.setItem('test-key', '{}');

      const manager = new LocalStorageManager<TestData>({
        key: 'test-key',
        version: 1,
        defaultValue: { items: [], count: 0 },
      });

      expect(manager.exists()).toBe(true);
    });

    it('should return false when no data exists', () => {
      const manager = new LocalStorageManager<TestData>({
        key: 'test-key',
        version: 1,
        defaultValue: { items: [], count: 0 },
      });

      expect(manager.exists()).toBe(false);
    });
  });

  describe('getLastUpdated', () => {
    it('should return updatedAt timestamp', () => {
      const storedSchema: StorageSchema<TestData> = {
        version: 1,
        data: { items: [], count: 0 },
        updatedAt: '2026-01-20T10:00:00.000Z',
      };
      mockLocalStorage.setItem('test-key', JSON.stringify(storedSchema));

      const manager = new LocalStorageManager<TestData>({
        key: 'test-key',
        version: 1,
        defaultValue: { items: [], count: 0 },
      });

      expect(manager.getLastUpdated()).toBe('2026-01-20T10:00:00.000Z');
    });

    it('should return null when no data exists', () => {
      const manager = new LocalStorageManager<TestData>({
        key: 'test-key',
        version: 1,
        defaultValue: { items: [], count: 0 },
      });

      expect(manager.getLastUpdated()).toBeNull();
    });

    it('should return null for corrupted data', () => {
      mockLocalStorage.setItem('test-key', 'not json');

      const manager = new LocalStorageManager<TestData>({
        key: 'test-key',
        version: 1,
        defaultValue: { items: [], count: 0 },
      });

      expect(manager.getLastUpdated()).toBeNull();
    });
  });

  describe('SSR safety', () => {
    it('should return defaultValue when window is undefined', () => {
      vi.stubGlobal('window', undefined);

      const manager = new LocalStorageManager<TestData>({
        key: 'test-key',
        version: 1,
        defaultValue: { items: ['ssr-default'], count: 0 },
      });

      expect(manager.get()).toEqual({ items: ['ssr-default'], count: 0 });
    });

    it('should no-op save when window is undefined', () => {
      vi.stubGlobal('window', undefined);

      const manager = new LocalStorageManager<TestData>({
        key: 'test-key',
        version: 1,
        defaultValue: { items: [], count: 0 },
      });

      // Should not throw
      expect(() => manager.save({ items: ['test'], count: 1 })).not.toThrow();
    });

    it('should return false for exists when window is undefined', () => {
      vi.stubGlobal('window', undefined);

      const manager = new LocalStorageManager<TestData>({
        key: 'test-key',
        version: 1,
        defaultValue: { items: [], count: 0 },
      });

      expect(manager.exists()).toBe(false);
    });
  });
});
