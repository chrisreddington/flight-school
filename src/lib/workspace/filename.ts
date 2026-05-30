/**
 * Shared safe-filename validation for the per-user workspace tree.
 *
 * Workspace file names are the ONE place in storage where dots are legitimate
 * (`solution.ts`, `solution.test.ts`, `src/index.ts`), so they cannot reuse the
 * dot-free {@link import('../storage/user-scope').SAFE_PATH_SEGMENT} class that
 * guards challenge/user ids. This validator permits dots and `/`-separated
 * subpaths while still rejecting traversal (`..`), separators inside a segment,
 * NUL bytes, absolute paths, and any path that resolves outside `workspaceDir`.
 *
 * It is the single source of truth for both the `/api/workspace/storage` POST
 * guard (caller-supplied filenames → 400 on rejection) and the
 * {@link import('./repo').workspacesRepo} legacy read-through (re-validating
 * each on-disk file name before `readRaw` builds a path from it). Keeping ONE
 * implementation means the write boundary and the migrating read boundary can
 * never drift apart.
 *
 * This module is SERVER-SIDE: {@link safeChildPath} lives in the `node:fs`-bound
 * storage utils. Do not import it from client/browser code.
 *
 * @module workspace/filename
 */

import { safeChildPath } from '@/lib/storage/utils';

/** Maximum length allowed for a workspace filename (incl. any subpath). */
export const MAX_WORKSPACE_FILENAME_LENGTH = 255;

/** Per-segment character class. Permits dots (unlike `SAFE_PATH_SEGMENT`). */
const SEGMENT_PATTERN = /^[a-zA-Z0-9._-]+$/;

/**
 * Validates that `name` is a safe workspace filename: it may consist of one or
 * more `/`-separated segments, each matching a conservative character class,
 * and the resolved path must stay under `workspaceDir`. Throws on rejection.
 *
 * @param workspaceDir - The `.data`-relative workspace directory the file must
 *   resolve under (e.g. `users/{userId}/workspaces/{challengeId}`).
 * @param name - The candidate file name. Validated to be a string here, so
 *   callers may pass an untyped value straight from a parsed request body.
 * @throws {Error} when `name` is not a string, is empty, exceeds
 *   {@link MAX_WORKSPACE_FILENAME_LENGTH}, contains an invalid segment, or
 *   resolves outside `workspaceDir`.
 */
export function assertSafeWorkspaceFilename(workspaceDir: string, name: unknown): void {
  if (typeof name !== 'string') {
    throw new Error('filename must be a string');
  }
  if (name.length === 0 || name.length > MAX_WORKSPACE_FILENAME_LENGTH) {
    throw new Error('filename length out of bounds');
  }
  const segments = name.split('/');
  for (const segment of segments) {
    if (!SEGMENT_PATTERN.test(segment)) {
      throw new Error(`invalid filename segment "${segment}"`);
    }
  }
  // Structural + containment check (rejects `..`, `\`, NUL, absolute, etc.).
  safeChildPath(workspaceDir, ...segments);
}
