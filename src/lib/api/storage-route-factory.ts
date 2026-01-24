/**
 * Storage Route Factory
 * 
 * Generic factory for creating storage API routes with consistent GET/POST/DELETE handlers.
 * Eliminates duplication across storage routes with type-safe schema validation.
 * 
 * @module api/storage-route-factory
 */

import { NextRequest, NextResponse } from 'next/server';
import { readStorage, writeStorage, deleteStorage } from '@/lib/storage/utils';
import { apiSuccess, validationErrorResponse } from './response-utils';
import type { logger } from '@/lib/logger';

/**
 * Type for logger instance with tag support.
 */
type LoggerInstance = ReturnType<typeof logger.withTag>;

/**
 * Configuration for a storage route.
 * 
 * @template T - Type of storage schema
 */
export interface StorageRouteConfig<T> {
  /** Filename for storage (e.g., 'focus-storage.json') */
  filename: string;
  /** Default schema to return when file doesn't exist */
  defaultSchema: T;
  /** Logger instance for route operations */
  logger: LoggerInstance;
  /** Type guard function to validate schema structure */
  validateSchema: (data: unknown) => data is T;
}

/**
 * Creates standardized GET/POST/DELETE handlers for a storage route.
 * 
 * @template T - Type of storage schema
 * @param config - Storage route configuration
 * @returns Object with GET, POST, DELETE handler functions
 * 
 * @example
 * ```typescript
 * const { GET, POST, DELETE } = createStorageRoute({
 *   filename: 'focus-storage.json',
 *   defaultSchema: { history: {} },
 *   logger: logger.withTag('Focus Storage API'),
 *   validateSchema: (data): data is FocusStorageSchema => {
 *     if (typeof data !== 'object' || data === null) return false;
 *     const schema = data as Record<string, unknown>;
 *     return typeof schema.history === 'object' && schema.history !== null;
 *   }
 * });
 * export { GET, POST, DELETE };
 * ```
 */
export function createStorageRoute<T>(config: StorageRouteConfig<T>) {
  const { filename, defaultSchema, logger, validateSchema } = config;

  /**
   * GET: Read current storage
   */
  async function GET() {
    try {
      const storage = await readStorage<T>(
        filename,
        defaultSchema,
        validateSchema
      );
      return NextResponse.json(storage);
    } catch (error) {
      logger.error(`GET failed`, { error });
      return NextResponse.json(
        { error: 'Failed to read storage' },
        { status: 500 }
      );
    }
  }

  /**
   * POST: Write storage
   */
  async function POST(request: NextRequest) {
    try {
      const body = await request.json();
      const schema = body as T;
      
      // Validate before writing
      if (!validateSchema(schema)) {
        return validationErrorResponse('Invalid storage schema');
      }

      await writeStorage(filename, schema);
      return apiSuccess(null);
    } catch (error) {
      logger.error(`POST failed`, { error });
      return NextResponse.json(
        { error: 'Failed to write storage' },
        { status: 500 }
      );
    }
  }

  /**
   * DELETE: Clear storage
   */
  async function DELETE() {
    try {
      await deleteStorage(filename);
      return apiSuccess(null);
    } catch (error) {
      logger.error(`DELETE failed`, { error });
      return NextResponse.json(
        { error: 'Failed to delete storage' },
        { status: 500 }
      );
    }
  }

  return { GET, POST, DELETE };
}
