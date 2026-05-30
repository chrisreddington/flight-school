/**
 * Per-user profile-cache repository — the single source of truth for the
 * profile singleton's filename, default, and schema guard.
 *
 * The `/api/profile/storage` route previously re-declared its own
 * `validateSchema`, `ProfileStorageSchema`, and `profile-cache.json` / `null`
 * pair. {@link profileRepo} collapses that into one typed accessor.
 *
 * Unlike the skills/habits/focus singletons, the profile cache is **nullable**:
 * its default is `null` (no cached profile yet), and the guard admits `null`
 * alongside a well-formed `{ date, profile }` record. The schema carries no
 * server-stamped field, so this repo configures no `stamp`.
 *
 * Profile has no server-side reader and no Server Actions — the browser hook in
 * `@/hooks/use-user-profile` reads through the route — so the route is this
 * repo's only consumer today.
 *
 * @module profile/repo
 */

import { createSingletonRepo } from '@/lib/storage/document-store/singleton-repo';
import type { ProfileResponse } from '@/lib/github/profile-handler';

/** Date-stamped cache envelope for a user's resolved GitHub profile. */
export interface ProfileStorageSchema {
  /** ISO date string (YYYY-MM-DD) for cache invalidation. */
  date: string;
  /** Cached profile payload. */
  profile: ProfileResponse;
}

/** A user with no cached profile persists `null` rather than an empty record. */
const DEFAULT_PROFILE_CACHE: ProfileStorageSchema | null = null;

/**
 * Validate the persisted profile-cache shape. `null` is a valid, expected value
 * (no cache yet); any non-null value must carry a string `date` and an object
 * `profile`. A document failing this guard is treated as absent.
 */
export function isProfileStorageSchema(data: unknown): data is ProfileStorageSchema | null {
  if (data === null) return true;
  if (typeof data !== 'object') return false;
  const schema = data as Record<string, unknown>;
  return typeof schema.date === 'string' && typeof schema.profile === 'object' && schema.profile !== null;
}

/**
 * Server-side profile-cache accessor. The storage route consumes this repo's
 * {@link SingletonRepo.filename}, {@link SingletonRepo.defaultValue}, and
 * {@link SingletonRepo.guard}.
 */
export const profileRepo = createSingletonRepo<ProfileStorageSchema | null>({
  filename: 'profile-cache.json',
  defaultValue: DEFAULT_PROFILE_CACHE,
  guard: isProfileStorageSchema,
});
