import { now } from '@/lib/utils/date-utils';
import { logger } from '@/lib/logger';

/**
 * Generic LocalStorage Manager
 *
 * Provides a type-safe, versioned localStorage wrapper with migration support.
 * Used as a base class for feature-specific storage implementations.
 *
 * @remarks
 * This module is client-side only - it uses localStorage which is
 * only available in the browser. Import only from hooks or components.
 *
 * @example
 * ```typescript
 * interface UserSettings {
 *   theme: 'light' | 'dark';
 *   notifications: boolean;
 * }
 *
 * class SettingsStorage extends LocalStorageManager<UserSettings> {
 *   constructor() {
 *     super('app-settings', 1, { theme: 'light', notifications: true });
 *   }
 * }
 *
 * const settingsStore = new SettingsStorage();
 * const settings = settingsStore.get();
 * settingsStore.save({ theme: 'dark', notifications: false });
 * ```
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Storage schema wrapper with versioning support.
 *
 * @typeParam T - The data type being stored
 */
export interface StorageSchema<T> {
  /** Schema version for migration support */
  version: number;
  /** The stored data */
  data: T;
  /** ISO timestamp when data was last updated */
  updatedAt: string;
}

/**
 * Migration function signature for schema upgrades.
 *
 * @typeParam T - The target data type
 */
export type MigrationFn<T> = (oldData: unknown, fromVersion: number) => T;

/**
 * Options for creating a LocalStorageManager instance.
 *
 * @typeParam T - The data type being stored
 */
export interface LocalStorageManagerOptions<T> {
  /** localStorage key */
  key: string;
  /** Current schema version */
  version: number;
  /** Default value when no data exists */
  defaultValue: T;
  /** Optional migration function for older schema versions */
  migrate?: MigrationFn<T>;
  /** Optional validator function for loaded data */
  validate?: (data: unknown) => data is T;
  /**
   * Optional legacy parser for non-standard storage shapes.
   *
   * @remarks
   * Used to migrate older storage formats that don't match StorageSchema<T>.
   */
  legacyParser?: (data: unknown) => T | null;
}

// =============================================================================
// LocalStorageManager Class
// =============================================================================

/**
 * Generic localStorage manager with versioning and migration support.
 *
 * @typeParam T - The data type being stored
 *
 * @remarks
 * - Handles SSR by returning defaultValue when window is undefined
 * - Gracefully recovers from corrupted data by resetting to defaults
 * - Supports schema migrations via the migrate option
 * - Logs errors to console for debugging
 *
 * @example
 * ```typescript
 * // Simple usage with object options
 * const store = new LocalStorageManager<MyData>({
 *   key: 'my-key',
 *   version: 1,
 *   defaultValue: { items: [] }
 * });
 *
 * // With migration support
 * const storeWithMigration = new LocalStorageManager<MyData>({
 *   key: 'my-key',
 *   version: 2,
 *   defaultValue: { items: [], newField: '' },
 *   migrate: (oldData, fromVersion) => {
 *     if (fromVersion === 1) {
 *       return { ...oldData, newField: 'default' };
 *     }
 *     return oldData as MyData;
 *   }
 * });
 * ```
 */
export class LocalStorageManager<T> {
  protected readonly key: string;
  protected readonly version: number;
  protected readonly defaultValue: T;
  protected readonly migrate?: MigrationFn<T>;
  protected readonly validate?: (data: unknown) => data is T;
  protected readonly legacyParser?: (data: unknown) => T | null;

  constructor(options: LocalStorageManagerOptions<T>) {
    this.key = options.key;
    this.version = options.version;
    this.defaultValue = options.defaultValue;
    this.migrate = options.migrate;
    this.validate = options.validate;
    this.legacyParser = options.legacyParser;
  }

  /**
   * Gets the stored data, applying migrations if needed.
   *
   * @returns The stored data or defaultValue if not found/invalid
   */
  get(): T {
    if (typeof window === 'undefined') {
      return this.defaultValue;
    }

    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) {
        return this.defaultValue;
      }

      const parsed = JSON.parse(raw) as StorageSchema<T>;

      // Validate basic schema structure
      if (!this.isValidSchema(parsed)) {
        const legacyData = this.legacyParser?.(parsed);
        if (legacyData !== null && legacyData !== undefined) {
          this.save(legacyData);
          return legacyData;
        }

        logger.warn('Invalid schema, resetting', { key: this.key }, 'LocalStorageManager');
        this.clear();
        return this.defaultValue;
      }

      // Handle version mismatch with migration
      if (parsed.version !== this.version) {
        if (this.migrate) {
          try {
            const migrated = this.migrate(parsed.data, parsed.version);
            // Save the migrated data
            this.save(migrated);
            return migrated;
          } catch (migrationError) {
            logger.error('Migration failed', { key: this.key, migrationError }, 'LocalStorageManager');
            this.clear();
            return this.defaultValue;
          }
        } else {
          // No migration function, reset to defaults
          logger.warn('Version mismatch, resetting', { 
            key: this.key, 
            oldVersion: parsed.version, 
            newVersion: this.version 
          }, 'LocalStorageManager');
          this.clear();
          return this.defaultValue;
        }
      }

      // Optional data validation
      if (this.validate && !this.validate(parsed.data)) {
        logger.warn('Data validation failed, resetting', { key: this.key }, 'LocalStorageManager');
        this.clear();
        return this.defaultValue;
      }

      return parsed.data;
    } catch (error) {
      logger.error('Failed to read', { key: this.key, error }, 'LocalStorageManager');
      this.clear();
      return this.defaultValue;
    }
  }

  /**
   * Saves data to localStorage with current version and timestamp.
   *
   * @param data - The data to save
   * @throws Logs warning on QuotaExceededError
   */
  save(data: T): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const schema: StorageSchema<T> = {
        version: this.version,
        data,
        updatedAt: now(),
      };

      localStorage.setItem(this.key, JSON.stringify(schema));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        logger.error(
          'localStorage quota exceeded - clear old data or reduce storage size',
          { key: this.key },
          'LocalStorageManager'
        );
      } else {
        logger.error('Failed to save', { key: this.key, error }, 'LocalStorageManager');
      }
    }
  }

  /**
   * Clears the stored data.
   */
  clear(): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      localStorage.removeItem(this.key);
    } catch (error) {
      logger.error('Failed to clear', { key: this.key, error }, 'LocalStorageManager');
    }
  }

  /**
   * Checks if any data exists in storage.
   *
   * @returns True if data exists, false otherwise
   */
  exists(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }

    return localStorage.getItem(this.key) !== null;
  }

  /**
   * Gets the timestamp of the last update.
   *
   * @returns ISO timestamp string or null if no data exists
   */
  getLastUpdated(): string | null {
    if (typeof window === 'undefined') {
      return null;
    }

    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as StorageSchema<T>;
      return parsed.updatedAt ?? null;
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // Protected Methods
  // ===========================================================================

  /**
   * Validates that parsed data has the required schema structure.
   */
  protected isValidSchema(data: unknown): data is StorageSchema<T> {
    if (typeof data !== 'object' || data === null) {
      return false;
    }

    const schema = data as StorageSchema<T>;

    if (typeof schema.version !== 'number') {
      return false;
    }

    // data field must exist (can be any type, including null for nullable T)
    if (!('data' in schema)) {
      return false;
    }

    return true;
  }
}
