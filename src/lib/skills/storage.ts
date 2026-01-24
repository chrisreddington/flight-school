/**
 * Skill Profile Storage
 *
 * Provides persistent storage for user skill profiles using localStorage.
 * Extends the generic LocalStorageManager with skill-specific operations.
 *
 * @remarks
 * This module is client-side only - it uses localStorage which is
 * only available in the browser. Import only from hooks or components.
 *
 * @example
 * ```typescript
 * import { skillProfileStore, getSkillProfile, saveSkillProfile } from '@/lib/skills';
 *
 * // Get the current skill profile
 * const profile = getSkillProfile();
 *
 * // Update a skill
 * const updatedProfile = {
 *   ...profile,
 *   skills: [...profile.skills, { skillId: 'rust', level: 'beginner', source: 'manual' }]
 * };
 * saveSkillProfile(updatedProfile);
 *
 * // Or use the store directly
 * skillProfileStore.save(updatedProfile);
 * ```
 */

import { LocalStorageManager } from '@/lib/storage';
import { now } from '@/lib/utils/date-utils';
import type { SkillLevel, SkillProfile, UserSkill } from './types';
import {
    DEFAULT_SKILL_PROFILE,
    SKILL_PROFILE_SCHEMA_VERSION,
    SKILL_PROFILE_STORAGE_KEY,
} from './types';

// =============================================================================
// Skill Profile Store
// =============================================================================

/**
 * localStorage manager for skill profiles.
 *
 * @remarks
 * Extends LocalStorageManager to provide skill-specific CRUD operations
 * with automatic deduplication of skills by skillId.
 */
class SkillProfileStore extends LocalStorageManager<SkillProfile> {
  constructor() {
    super({
      key: SKILL_PROFILE_STORAGE_KEY,
      version: SKILL_PROFILE_SCHEMA_VERSION,
      defaultValue: DEFAULT_SKILL_PROFILE,
      validate: isValidSkillProfile,
    });
  }

  /**
   * Gets a specific skill from the profile.
   *
   * @param skillId - The skill identifier to look up
   * @returns The UserSkill if found, undefined otherwise
   */
  getSkill(skillId: string): UserSkill | undefined {
    const profile = this.get();
    return profile.skills.find(s => s.skillId === skillId);
  }

  /**
   * Updates or adds a skill to the profile.
   *
   * @remarks
   * If a skill with the same skillId exists, it will be replaced.
   * The profile's lastUpdated timestamp is automatically updated.
   *
   * @param skill - The skill to add or update
   *
   * @example
   * ```typescript
   * skillProfileStore.setSkill({
   *   skillId: 'typescript',
   *   level: 'advanced',
   *   source: 'manual'
   * });
   * ```
   */
  setSkill(skill: UserSkill): void {
    const profile = this.get();
    const existingIndex = profile.skills.findIndex(s => s.skillId === skill.skillId);

    let updatedSkills: UserSkill[];
    if (existingIndex >= 0) {
      updatedSkills = [...profile.skills];
      updatedSkills[existingIndex] = skill;
    } else {
      updatedSkills = [...profile.skills, skill];
    }

    this.save({
      skills: updatedSkills,
      lastUpdated: now(),
    });
  }

  /**
   * Removes a skill from the profile.
   *
   * @param skillId - The skill identifier to remove
   */
  removeSkill(skillId: string): void {
    const profile = this.get();
    const updatedSkills = profile.skills.filter(s => s.skillId !== skillId);

    if (updatedSkills.length !== profile.skills.length) {
      this.save({
        skills: updatedSkills,
        lastUpdated: now(),
      });
    }
  }

  /**
   * Bulk updates multiple skills at once.
   *
   * @remarks
   * Existing skills are updated, new skills are added.
   * This is more efficient than calling setSkill multiple times.
   *
   * @param skills - Array of skills to update or add
   */
  setSkills(skills: UserSkill[]): void {
    const profile = this.get();
    const skillMap = new Map<string, UserSkill>();

    // Start with existing skills
    for (const skill of profile.skills) {
      skillMap.set(skill.skillId, skill);
    }

    // Overlay with new skills
    for (const skill of skills) {
      skillMap.set(skill.skillId, skill);
    }

    this.save({
      skills: Array.from(skillMap.values()),
      lastUpdated: now(),
    });
  }

  /**
   * Gets skills filtered by source.
   *
   * @param source - Filter by 'github' or 'manual'
   * @returns Array of skills from the specified source
   */
  getSkillsBySource(source: 'github' | 'manual'): UserSkill[] {
    const profile = this.get();
    return profile.skills.filter(s => s.source === source);
  }

  /**
   * Gets skills at a specific level.
   *
   * @param level - The skill level to filter by
   * @returns Array of skills at the specified level
   */
  getSkillsByLevel(level: SkillLevel): UserSkill[] {
    const profile = this.get();
    return profile.skills.filter(s => s.level === level);
  }

  /**
   * Gets skills the user is interested in (not marked as notInterested).
   *
   * @returns Array of skills the user wants to learn about
   */
  getInterestedSkills(): UserSkill[] {
    const profile = this.get();
    return profile.skills.filter(s => !s.notInterested);
  }

  /**
   * Gets skills marked as not interested.
   *
   * @returns Array of skills to exclude from recommendations
   */
  getExcludedSkills(): UserSkill[] {
    const profile = this.get();
    return profile.skills.filter(s => s.notInterested === true);
  }
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validates that data is a valid SkillProfile structure.
 */
function isValidSkillProfile(data: unknown): data is SkillProfile {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const profile = data as SkillProfile;

  if (!Array.isArray(profile.skills)) {
    return false;
  }

  if (typeof profile.lastUpdated !== 'string') {
    return false;
  }

  // Validate each skill
  for (const skill of profile.skills) {
    if (!isValidUserSkill(skill)) {
      return false;
    }
  }

  return true;
}

/**
 * Validates that data is a valid UserSkill structure.
 */
function isValidUserSkill(data: unknown): data is UserSkill {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const skill = data as UserSkill;

  if (typeof skill.skillId !== 'string' || skill.skillId.length === 0) {
    return false;
  }

  const validLevels = ['beginner', 'intermediate', 'advanced'];
  if (!validLevels.includes(skill.level)) {
    return false;
  }

  const validSources = ['github', 'manual'];
  if (!validSources.includes(skill.source)) {
    return false;
  }

  return true;
}

// =============================================================================
// Singleton and Convenience Functions
// =============================================================================

/** Singleton skill profile store instance */
const skillProfileStore = new SkillProfileStore();

/**
 * Gets the current skill profile.
 *
 * @remarks
 * Convenience function that wraps skillProfileStore.get().
 *
 * @returns The current SkillProfile from localStorage
 */
export function getSkillProfile(): SkillProfile {
  return skillProfileStore.get();
}

/**
 * Saves a skill profile to localStorage.
 *
 * @remarks
 * Convenience function that wraps skillProfileStore.save().
 * Automatically updates the lastUpdated timestamp.
 *
 * @param profile - The profile to save
 */
export function saveSkillProfile(profile: SkillProfile): void {
  skillProfileStore.save({
    ...profile,
    lastUpdated: now(),
  });
}
