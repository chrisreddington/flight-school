/**
 * Request-scoped store resolver (Web/API only).
 *
 * Resolves the authenticated user via {@link requireUserContext} and hands back
 * their {@link UserScopedStore}. This is the entry point for API route handlers,
 * Server Components, and Server Actions. It is intentionally split from
 * `./scoped-store` (which is Next-free) so importing the request path can never
 * drag `@/lib/auth/*` onto the worker's import graph.
 *
 * @module storage/document-store/request-store
 */

import 'server-only';

import { requireUserContext } from '@/lib/auth/context';
import { getUserScopedStoreForUser } from './scoped-store';
import type { UserScopedStore } from './user-scoped-store';

/**
 * Resolve the current request's {@link UserScopedStore}.
 *
 * Throws {@link UnauthorizedError} (mapped to 401 by the route guards) when no
 * authenticated session is present, mirroring {@link requireUserContext}.
 */
export async function getUserScopedStoreForRequest(): Promise<UserScopedStore> {
  const { userId } = await requireUserContext();
  return getUserScopedStoreForUser(userId);
}
