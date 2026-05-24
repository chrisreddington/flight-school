/**
 * Server-side accessors for the skills profile.
 *
 * Server Components and Server Actions read/write the user's skill profile
 * through these helpers so initial render doesn't have to wait on a client
 * HTTP round-trip. The browser-facing {@link skillsStore} in `./storage`
 * remains the entry point for client-side mutations.
 */

import { readUserStorage, writeUserStorage } from '@/lib/storage/user-storage';
import { now } from '@/lib/utils/date-utils';
import { DEFAULT_SKILL_PROFILE, type SkillProfile } from './types';

const SKILLS_FILENAME = 'skills-profile.json';

/**
 * Type guard mirrored from the API route — kept here so a misconfigured
 * server-side call can't bypass the validation the storage layer enforces.
 */
function isSkillProfile(data: unknown): data is SkillProfile {
  if (typeof data !== 'object' || data === null) return false;
  const schema = data as Record<string, unknown>;

  if (!Array.isArray(schema.skills)) return false;
  if (typeof schema.lastUpdated !== 'string') return false;

  for (const skill of schema.skills) {
    if (typeof skill !== 'object' || skill === null) return false;
    const s = skill as Record<string, unknown>;
    if (typeof s.skillId !== 'string') return false;
    if (!['beginner', 'intermediate', 'advanced'].includes(s.level as string)) return false;
    if (!['github', 'github-confirmed', 'manual'].includes(s.source as string)) return false;
  }

  return true;
}

/**
 * Reads the authenticated user's skill profile from disk. Used by the
 * `/skills` RSC for initial render — falls back to {@link
 * DEFAULT_SKILL_PROFILE} when the file is absent or corrupt.
 */
export async function readUserSkillsProfile(): Promise<SkillProfile> {
  return readUserStorage<SkillProfile>(SKILLS_FILENAME, DEFAULT_SKILL_PROFILE, isSkillProfile);
}

/**
 * Persists the authenticated user's skill profile. Stamps `lastUpdated`
 * server-side so Server Actions don't have to thread the timestamp through.
 */
export async function writeUserSkillsProfile(profile: SkillProfile): Promise<SkillProfile> {
  const stamped: SkillProfile = { ...profile, lastUpdated: now() };
  await writeUserStorage<SkillProfile>(SKILLS_FILENAME, stamped, isSkillProfile);
  return stamped;
}
