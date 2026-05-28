/**
 * Per-user, by-id storage for challenge specs.
 *
 * The original challenge flow embedded the full spec into the URL
 * (`/challenge?title=…&description=…`), which (a) made the URL fragile,
 * (b) lost state across reloads, and (c) opened a "tampered link
 * overwrites another user's challenge" surface. M2.5 moves the spec
 * server-side under `users/{userId}/challenges/{id}.json` and resolves
 * the user identity internally via {@link requireUserContext} —
 * callers never pass `userId`.
 *
 * @module challenge/spec-storage
 */

import 'server-only';

import { requireUserContext } from '@/lib/auth/context';
import type { DailyChallenge } from '@/lib/focus/base-types';
import { logger } from '@/lib/logger';
import { ensureDir, readFile, writeFile } from '@/lib/storage/utils';
import { SAFE_PATH_SEGMENT, userScopedFilename } from '@/lib/storage/user-scope';

const log = logger.withTag('Challenge Spec Storage');

/**
 * The on-disk shape of a challenge spec. Aliased to `DailyChallenge` so
 * callers that already have a generated focus challenge can write it
 * through this module without a transform.
 */
export type ChallengeSpec = DailyChallenge;

/**
 * Thrown by {@link readUserChallengeSpec} / {@link writeUserChallengeSpec}
 * when the supplied `id` fails {@link SAFE_PATH_SEGMENT} validation.
 *
 * @remarks
 * Callers that emit JSON (the `/api/workspace/storage` route,
 * the `regenerateChallengeAction` Server Action, etc.) map this to a
 * `400 Bad Request`. Server Components pre-validate the id inline and
 * call `notFound()` instead — the throw is the defence-in-depth safety
 * net rather than the primary 400-class path.
 */
export class InvalidChallengeIdError extends Error {
  constructor(id: string) {
    super(`Invalid challenge id: ${JSON.stringify(id)}`);
    this.name = 'InvalidChallengeIdError';
  }
}

/**
 * Builds the per-user storage path for `challenges/{id}.json` after
 * validating both the user identity (handled by `userScopedFilename`)
 * and the supplied challenge id.
 *
 * @internal
 */
async function resolveSpecPath(id: string): Promise<{ subdir: string; filename: string }> {
  if (!SAFE_PATH_SEGMENT.test(id)) {
    throw new InvalidChallengeIdError(id);
  }
  const { userId } = await requireUserContext();
  // Build the relative path manually so we can split into `subdir + filename`
  // for the low-level `readFile` / `writeFile` helpers (they want the
  // directory and basename as separate args).
  const fullPath = userScopedFilename(userId, `challenges/${id}.json`);
  const lastSlash = fullPath.lastIndexOf('/');
  return {
    subdir: fullPath.slice(0, lastSlash),
    filename: fullPath.slice(lastSlash + 1),
  };
}

/**
 * Reads a previously-written challenge spec for the authenticated user.
 *
 * Contract:
 * - **Invalid id** (fails {@link SAFE_PATH_SEGMENT}) → throws
 *   {@link InvalidChallengeIdError}. JSON-contract callers map to `400`.
 * - **Missing file** (id valid, no spec on disk) → returns `null`.
 * - **Schema-invalid payload** on disk → returns `null` and logs at warn.
 *   Treated as missing rather than throwing so a corrupted file does not
 *   break the user's dashboard.
 */
export async function readUserChallengeSpec(id: string): Promise<ChallengeSpec | null> {
  const { subdir, filename } = await resolveSpecPath(id);
  const raw = await readFile(subdir, filename);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isChallengeSpec(parsed)) {
      log.warn('Challenge spec failed shape check; treating as missing', { id });
      return null;
    }
    return parsed;
  } catch (error) {
    log.warn('Challenge spec JSON parse failed; treating as missing', { id, error });
    return null;
  }
}

/**
 * Writes a challenge spec for the authenticated user. Validates `id`
 * against {@link SAFE_PATH_SEGMENT}; throws {@link InvalidChallengeIdError}
 * on invalid id. Ensures the per-user `challenges/` subdir exists before
 * writing so the first write to a brand-new user account succeeds without
 * a pre-flight `mkdir`.
 */
export async function writeUserChallengeSpec(id: string, spec: ChallengeSpec): Promise<void> {
  const { subdir, filename } = await resolveSpecPath(id);
  await ensureDir(subdir, { mode: 0o700 });
  await writeFile(subdir, filename, JSON.stringify(spec, null, 2));
}

/**
 * Defensive shape check applied to every read. Mirrors the load-bearing
 * fields the sandbox + workspace builder consume; full validation is the
 * writer's responsibility (writers call this module with a fresh
 * `DailyChallenge` produced by `generateFocus`).
 */
function isChallengeSpec(value: unknown): value is ChallengeSpec {
  if (typeof value !== 'object' || value === null) return false;
  const spec = value as Record<string, unknown>;
  return (
    typeof spec.id === 'string' &&
    typeof spec.title === 'string' &&
    typeof spec.description === 'string' &&
    typeof spec.difficulty === 'string' &&
    typeof spec.language === 'string'
  );
}
