/**
 * Server-side accessors for the skills profile.
 *
 * Server Components and Server Actions read/write the user's skill profile
 * through these helpers so initial render doesn't have to wait on a client
 * HTTP round-trip. They resolve the authenticated user, then delegate to the
 * shared {@link skillsRepo} (the single source of the filename/default/guard
 * and the `lastUpdated` stamp). The browser-facing `skillsStore` in `./storage`
 * remains the entry point for client-side mutations.
 */

import { requireUserContext } from '@/lib/auth/context';
import { skillsRepo } from './repo';
import { type SkillProfile } from './types';

/**
 * Reads the authenticated user's skill profile from storage. Used by the
 * `/skills` RSC for initial render — falls back to the repo default when the
 * document is absent or corrupt.
 */
export async function readUserSkillsProfile(): Promise<SkillProfile> {
  const { userId } = await requireUserContext();
  return skillsRepo.read(userId);
}

/**
 * Persists the authenticated user's skill profile. The repo stamps
 * `lastUpdated` server-side and returns the stamped value, so Server Actions
 * don't have to thread the timestamp through.
 */
export async function writeUserSkillsProfile(profile: SkillProfile): Promise<SkillProfile> {
  const { userId } = await requireUserContext();
  return skillsRepo.write(userId, profile);
}
