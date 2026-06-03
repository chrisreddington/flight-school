/**
 * Per-user skills-profile repository — the single source of truth for the
 * skills singleton's filename, default, schema guard, and write-time stamp.
 *
 * Before S1, three places re-declared the same `isSkillProfile` guard and
 * `skills-profile.json` / {@link DEFAULT_SKILL_PROFILE} pair: the RSC accessor
 * in `./server`, the storage route at `app/api/skills/storage/route.ts`, and
 * (implicitly) the client store. {@link skillsRepo} collapses the server-side
 * copies into one typed accessor so they cannot drift.
 *
 * @module skills/repo
 */

import { createSingletonRepo } from '@/lib/storage/document-store/singleton-repo';
import { now } from '@/lib/utils/date-utils';
import { DEFAULT_SKILL_PROFILE, type SkillProfile } from './types';

/**
 * Validate the persisted skills-profile shape. A document failing this guard is
 * treated as absent (read heals to the default; write is rejected).
 */
export function isSkillProfile(value: unknown): value is SkillProfile {
  if (typeof value !== 'object' || value === null) return false;
  const schema = value as Record<string, unknown>;

  if (!Array.isArray(schema.skills)) return false;
  if (typeof schema.lastUpdated !== 'string') return false;

  for (const skill of schema.skills) {
    if (typeof skill !== 'object' || skill === null) return false;
    const candidate = skill as Record<string, unknown>;
    if (typeof candidate.skillId !== 'string') return false;
    if (!['beginner', 'intermediate', 'advanced'].includes(candidate.level as string)) return false;
    if (!['github', 'github-confirmed', 'manual'].includes(candidate.source as string)) return false;
  }

  return true;
}

/**
 * Server-side skills-profile accessor. {@link SingletonRepo.write} stamps
 * `lastUpdated` so Server Actions don't thread the timestamp through; the
 * storage route persists the client's already-stamped body verbatim by using
 * {@link filename}/{@link defaultValue}/{@link guard} WITHOUT this repo's
 * stamping write.
 */
export const skillsRepo = createSingletonRepo<SkillProfile>({
  filename: 'skills-profile.json',
  defaultValue: DEFAULT_SKILL_PROFILE,
  guard: isSkillProfile,
  stamp: (profile) => ({ ...profile, lastUpdated: now() }),
});
