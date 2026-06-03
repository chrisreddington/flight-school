/**
 * Pure path-containment helper, isolated from the `node:fs`-bound storage
 * utilities.
 *
 * @remarks
 * {@link safeChildPath} is a string-only safety check: it resolves candidate
 * segments under a base directory and rejects anything that escapes it. It
 * touches neither the filesystem nor the storage-root environment, so it lives
 * here — apart from {@link import('./utils')}, which imports `node:fs` and
 * captures the storage root at module load. Keeping the helper in this leaf
 * means client-reachable validators (e.g.
 * {@link import('../workspace/filename').assertSafeWorkspaceFilename}) can use
 * it WITHOUT dragging `node:fs` into the browser bundle. `@/lib/storage/utils`
 * re-exports it, so existing server callers keep their import path.
 *
 * @module storage/safe-path
 */

import path from 'path';

/**
 * Safely joins child segments under `baseDir`, throwing when any segment is
 * malformed or the resolved target escapes the base directory.
 *
 * @remarks
 * This is the ONLY function that should construct a filesystem path from
 * caller-supplied segments. It rejects empty, non-string, `.`/`..`,
 * separator-bearing, NUL-bearing, and absolute segments, then verifies the
 * fully resolved target stays strictly under `baseDir`.
 *
 * @param baseDir - The containment root the result must stay under.
 * @param segments - One or more child segments to append.
 * @throws {Error} when a segment is invalid or the result escapes `baseDir`.
 */
export function safeChildPath(baseDir: string, ...segments: string[]): string {
  if (typeof baseDir !== 'string' || baseDir.length === 0) {
    throw new Error('safeChildPath: baseDir must be a non-empty string');
  }
  if (segments.length === 0) {
    throw new Error('safeChildPath: at least one child segment is required');
  }

  for (const segment of segments) {
    if (typeof segment !== 'string') {
      throw new Error('safeChildPath: segments must be strings');
    }
    if (segment.length === 0) {
      throw new Error('safeChildPath: empty segment');
    }
    if (segment === '.' || segment === '..') {
      throw new Error(`safeChildPath: forbidden segment "${segment}"`);
    }
    if (segment.includes('\0')) {
      throw new Error('safeChildPath: NUL byte in segment');
    }
    if (segment.includes('/') || segment.includes('\\')) {
      throw new Error(`safeChildPath: separator in segment "${segment}"`);
    }
    if (path.isAbsolute(segment)) {
      throw new Error(`safeChildPath: absolute segment "${segment}"`);
    }
  }

  const resolvedBase = path.resolve(/* turbopackIgnore: true */ baseDir);
  const resolvedTarget = path.resolve(/* turbopackIgnore: true */ resolvedBase, ...segments);

  // NOTE: append path.sep so a sibling like "/data-evil" cannot satisfy the
  //       prefix check against base "/data"; this also requires a true child.
  if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error(`safeChildPath: path "${segments.join('/')}" escapes baseDir`);
  }

  return resolvedTarget;
}
