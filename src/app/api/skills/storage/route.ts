/**
 * Skills Storage API Route
 * GET/POST/DELETE /api/skills/storage
 *
 * Server-side persistence for user skill profiles.
 */

import { createStorageRoute } from '@/lib/api';
import type { SkillProfile } from '@/lib/skills/types';
import { DEFAULT_SKILL_PROFILE } from '@/lib/skills/types';
import { logger } from '@/lib/logger';

/**
 * Validates skill profile schema structure.
 */
function validateSchema(data: unknown): data is SkillProfile {
  if (typeof data !== 'object' || data === null) return false;
  const schema = data as Record<string, unknown>;
  
  if (!Array.isArray(schema.skills)) return false;
  if (typeof schema.lastUpdated !== 'string') return false;
  
  // Validate each skill
  for (const skill of schema.skills) {
    if (typeof skill !== 'object' || skill === null) return false;
    const s = skill as Record<string, unknown>;
    if (typeof s.skillId !== 'string') return false;
    if (!['beginner', 'intermediate', 'advanced'].includes(s.level as string)) return false;
    if (!['github', 'manual'].includes(s.source as string)) return false;
  }
  
  return true;
}

export const { GET, POST, DELETE } = createStorageRoute({
  filename: 'skills-profile.json',
  defaultSchema: DEFAULT_SKILL_PROFILE,
  logger: logger.withTag('Skills Storage API'),
  validateSchema,
});
