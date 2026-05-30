/**
 * Storage Route Factory
 *
 * Generic factory for creating storage API routes with consistent GET/POST/DELETE handlers.
 * Eliminates duplication across storage routes with type-safe schema validation.
 *
 * Storage is **partitioned per authenticated user**: each handler resolves the
 * GitHub identity via {@link requireUserContext} and rewrites the configured
 * filename to live under `users/{userId}/{filename}` inside the storage root.
 * There is no shared cross-user view of the data — User A's GET cannot see
 * User B's file because the underlying paths never collide.
 *
 * The userId is taken from the session (the numeric GitHub ID), never from a
 * query or body parameter, and is validated against {@link SAFE_USER_ID} to
 * defend against path-traversal even though GitHub IDs are numeric in
 * production.
 *
 * @module api/storage-route-factory
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  deleteUserStorageForUser,
  readUserStorageForUser,
  resolveScopedUserId,
  writeUserStorageForUser,
  type SchemaGuard,
} from '@/lib/storage/user-storage';
import { apiSuccess, validationErrorResponse } from './response-utils';
import { authErrorResponse } from './auth-errors';
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
interface StorageRouteConfig<T> {
  /** Filename for storage (e.g., 'focus-storage.json') */
  filename: string;
  /** Default schema to return when file doesn't exist */
  defaultSchema: T;
  /** Logger instance for route operations */
  logger: LoggerInstance;
  /** Type guard function to validate schema structure */
  validateSchema: SchemaGuard<T>;
  /**
   * Optional async hook invoked on GET after the storage file is read,
   * allowing the route to mutate the response body before it's
   * serialized. Failures here are caught and logged; the raw storage
   * payload is returned on hook error.
   */
  transformRead?: (userId: string, data: T) => Promise<T> | T;
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
  const { filename, defaultSchema, logger, validateSchema, transformRead } = config;

  /**
   * Resolves the authenticated user (for the `transformRead` hook + audit) or
   * returns an HTTP response describing why the request can't proceed (401 for
   * missing auth, 400 for an unrepresentable userId). Delegates the heavy
   * lifting to {@link resolveScopedUserId} and translates its typed errors
   * into HTTP responses appropriate for an API route. Resolution has no side
   * effects, so an invalid POST body never leaves a stray user directory; the
   * resolved userId is then handed to the `*ForUser` storage helpers so a
   * request authenticates exactly once.
   */
  async function resolveScopedUser(): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
    try {
      const userId = await resolveScopedUserId(filename);
      return { ok: true, userId };
    } catch (error) {
      const authResponse = authErrorResponse(error);
      if (authResponse) return { ok: false, response: authResponse };
      if (error instanceof Error && /unsafe userId/i.test(error.message)) {
        logger.warn('Rejected unsafe userId', { error });
        return { ok: false, response: validationErrorResponse('Invalid user identifier') };
      }
      throw error;
    }
  }

  /**
   * GET: Read current storage for the authenticated user.
   */
  async function GET() {
    const scoped = await resolveScopedUser();
    if (!scoped.ok) return scoped.response;

    try {
      let storage = await readUserStorageForUser<T>(scoped.userId, filename, defaultSchema, validateSchema);
      if (transformRead) {
        try {
          storage = await transformRead(scoped.userId, storage);
        } catch (error) {
          logger.warn('transformRead hook failed; returning raw storage', { error });
        }
      }
      return NextResponse.json(storage);
    } catch (error) {
      logger.error(`GET failed`, { error });
      return NextResponse.json({ error: 'Failed to read storage' }, { status: 500 });
    }
  }

  /**
   * POST: Write storage for the authenticated user.
   */
  async function POST(request: NextRequest) {
    const scoped = await resolveScopedUser();
    if (!scoped.ok) return scoped.response;

    try {
      const body = await request.json();
      const schema = body as T;

      if (!validateSchema(schema)) {
        return validationErrorResponse('Invalid storage schema');
      }

      await writeUserStorageForUser(scoped.userId, filename, schema, validateSchema);
      return apiSuccess(null);
    } catch (error) {
      logger.error(`POST failed`, { error });
      return NextResponse.json({ error: 'Failed to write storage' }, { status: 500 });
    }
  }

  /**
   * DELETE: Clear storage for the authenticated user.
   */
  async function DELETE() {
    const scoped = await resolveScopedUser();
    if (!scoped.ok) return scoped.response;

    try {
      await deleteUserStorageForUser(scoped.userId, filename);
      return apiSuccess(null);
    } catch (error) {
      logger.error(`DELETE failed`, { error });
      return NextResponse.json({ error: 'Failed to delete storage' }, { status: 500 });
    }
  }

  return { GET, POST, DELETE };
}
