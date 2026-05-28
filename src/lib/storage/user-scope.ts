/**
 * Shared helpers for partitioning storage paths per authenticated user.
 *
 * Storage is **partitioned per authenticated user**: callers rewrite a
 * logical filename like `threads.json` into `users/{userId}/threads.json`
 * inside the storage root before handing it to {@link readStorage} /
 * {@link writeStorage}. That ensures User A's reads cannot see User B's
 * file because the underlying paths never collide.
 *
 * `userId` MUST come from a server-resolved identity (Auth.js session,
 * job payload populated by an authenticated request, etc.) — never from
 * a query string, request body, or anything client-controllable. The
 * {@link SAFE_USER_ID} pattern is a defence-in-depth guard against
 * path-traversal even though GitHub IDs are numeric in production.
 *
 * @module storage/user-scope
 */

import 'server-only';

/**
 * Allowed characters in a userId used as a path segment. GitHub IDs are
 * numeric, but we accept the full alphanumeric + `_-` set so tests and
 * any future non-GitHub identity providers don't have to special-case
 * the helpers. Anything outside this set (including `..`, `/`, `.`) is
 * rejected.
 */
export const SAFE_USER_ID = /^[a-zA-Z0-9_-]+$/;

/**
 * Allowed characters in a logical path segment that the caller embeds into
 * a per-user storage path (e.g. `{challengeId}` in
 * `challenges/{challengeId}.json`). Identical character class to
 * {@link SAFE_USER_ID} so callers don't have to remember two patterns.
 * Any segment containing `..`, `/`, or `.` is rejected.
 *
 * @remarks
 * The workspace storage route at `src/app/api/workspace/storage/route.ts`
 * and the per-user challenge spec module at
 * `src/lib/challenge/spec-storage.ts` both import this constant — there
 * is exactly one definition in the codebase.
 */
export const SAFE_PATH_SEGMENT = /^[a-zA-Z0-9_-]+$/;

/**
 * Build the per-user storage path for a logical filename.
 *
 * @param userId - Stable user identifier (numeric GitHub ID as string).
 *   MUST come from a server-resolved identity, never from client input.
 * @param filename - The logical filename (e.g. `'threads.json'`).
 * @returns A storage-relative path of the form `users/{userId}/{filename}`.
 *
 * @throws {Error} when `userId` fails {@link SAFE_USER_ID} validation.
 */
export function userScopedFilename(userId: string, filename: string): string {
  if (!SAFE_USER_ID.test(userId)) {
    throw new Error(`Refusing unsafe userId for storage path: ${JSON.stringify(userId)}`);
  }
  return `users/${userId}/${filename}`;
}
