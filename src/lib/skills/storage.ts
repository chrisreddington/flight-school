/**
 * Skill Profile Storage
 *
 * Provides persistent storage for user skill profiles using server-side API.
 * Data is stored in `.data/skills-profile.json`.
 *
 * @remarks
 * This module uses the `/api/skills/storage` API route for persistence.
 * All operations are async since they require network calls.
 *
 * @example
 * ```typescript
 * import { skillsStore } from '@/lib/skills';
 *
 * // Get the current skill profile
 * const profile = await skillsStore.get();
 *
 * // Update a skill
 * await skillsStore.setSkill({
 *   skillId: 'typescript',
 *   level: 'advanced',
 *   source: 'manual'
 * });
 *
 * // Save entire profile
 * await skillsStore.save(updatedProfile);
 * ```
 */

import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import { logger } from '@/lib/logger';
import { now } from '@/lib/utils/date-utils';
import type { SkillLevel, SkillProfile, UserSkill } from './types';
import { DEFAULT_SKILL_PROFILE } from './types';

const log = logger.withTag('SkillsStore');

// =============================================================================
// Skills Store Class (API-backed)
// =============================================================================

/**
 * API-backed skills profile store.
 * 
 * @remarks
 * Unlike the old localStorage-based store, all methods are async.
 * This store persists data server-side via the `/api/skills/storage` route.
 */
class SkillsStore {
  private cache: SkillProfile | null = null;

  /**
   * Gets the current skill profile.
   */
  async get(): Promise<SkillProfile> {
    if (typeof window === 'undefined') {
      return DEFAULT_SKILL_PROFILE;
    }

    try {
      const profile = await apiGet<SkillProfile>('/api/skills/storage');
      this.cache = profile;
      return profile;
    } catch (error) {
      log.error('Failed to load skill profile', { error });
      return this.cache ?? DEFAULT_SKILL_PROFILE;
    }
  }

  /**
   * Saves a skill profile.
   */
  async save(profile: SkillProfile): Promise<void> {
    if (typeof window === 'undefined') return;

    const profileWithTimestamp: SkillProfile = {
      ...profile,
      lastUpdated: now(),
    };

    try {
      await apiPost<void>('/api/skills/storage', profileWithTimestamp);
      this.cache = profileWithTimestamp;
      log.debug('Skill profile saved', { skillCount: profile.skills.length });
    } catch (error) {
      log.error('Failed to save skill profile', { error });
      throw error;
    }
  }

  /**
   * Gets a specific skill from the profile.
   */
  async getSkill(skillId: string): Promise<UserSkill | undefined> {
    const profile = await this.get();
    return profile.skills.find(s => s.skillId === skillId);
  }

  /**
   * Updates or adds a skill to the profile.
   */
  async setSkill(skill: UserSkill): Promise<void> {
    const profile = await this.get();
    const existingIndex = profile.skills.findIndex(s => s.skillId === skill.skillId);

    let updatedSkills: UserSkill[];
    if (existingIndex >= 0) {
      updatedSkills = [...profile.skills];
      updatedSkills[existingIndex] = skill;
    } else {
      updatedSkills = [...profile.skills, skill];
    }

    await this.save({ skills: updatedSkills, lastUpdated: now() });
  }

  /**
   * Removes a skill from the profile.
   */
  async removeSkill(skillId: string): Promise<void> {
    const profile = await this.get();
    const updatedSkills = profile.skills.filter(s => s.skillId !== skillId);

    if (updatedSkills.length !== profile.skills.length) {
      await this.save({ skills: updatedSkills, lastUpdated: now() });
    }
  }

  /**
   * Bulk updates multiple skills at once.
   */
  async setSkills(skills: UserSkill[]): Promise<void> {
    const profile = await this.get();
    const skillMap = new Map<string, UserSkill>();

    // Start with existing skills
    for (const skill of profile.skills) {
      skillMap.set(skill.skillId, skill);
    }

    // Overlay with new skills
    for (const skill of skills) {
      skillMap.set(skill.skillId, skill);
    }

    await this.save({ skills: Array.from(skillMap.values()), lastUpdated: now() });
  }

  /**
   * Gets skills filtered by source.
   * 
   * @param source - Source to filter by. Use 'github' to include both 'github' and 'github-confirmed'.
   */
  async getSkillsBySource(source: 'github' | 'manual'): Promise<UserSkill[]> {
    const profile = await this.get();
    if (source === 'github') {
      // Include both direct GitHub detection and GitHub-confirmed skills
      return profile.skills.filter(s => s.source === 'github' || s.source === 'github-confirmed');
    }
    return profile.skills.filter(s => s.source === source);
  }

  /**
   * Gets skills at a specific level.
   */
  async getSkillsByLevel(level: SkillLevel): Promise<UserSkill[]> {
    const profile = await this.get();
    return profile.skills.filter(s => s.level === level);
  }

  /**
   * Gets skills the user is interested in (not marked as notInterested).
   */
  async getInterestedSkills(): Promise<UserSkill[]> {
    const profile = await this.get();
    return profile.skills.filter(s => !s.notInterested);
  }

  /**
   * Gets skills marked as not interested.
   */
  async getExcludedSkills(): Promise<UserSkill[]> {
    const profile = await this.get();
    return profile.skills.filter(s => s.notInterested === true);
  }

  /**
   * Clears all skill data.
   */
  async clear(): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      await apiDelete<void>('/api/skills/storage');
      this.cache = null;
      log.debug('Skill profile cleared');
    } catch (error) {
      log.error('Failed to clear skill profile', { error });
      throw error;
    }
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

/** Singleton skills store instance */
export const skillsStore = new SkillsStore();

// =============================================================================
// Legacy Compatibility (DEPRECATED)
// =============================================================================

/**
 * @deprecated Use `await skillsStore.get()` instead. This is a sync wrapper that returns cached data.
 */
export function getSkillProfile(): SkillProfile {
  // Return cached value or default for sync compatibility
  // Callers should migrate to async skillsStore.get()
  log.warn('getSkillProfile() is deprecated - use await skillsStore.get() instead');
  return DEFAULT_SKILL_PROFILE;
}

/**
 * @deprecated Use `await skillsStore.save(profile)` instead.
 */
export function saveSkillProfile(profile: SkillProfile): void {
  log.warn('saveSkillProfile() is deprecated - use await skillsStore.save() instead');
  // Fire and forget for sync compatibility
  void skillsStore.save(profile);
}
