

/**
 * Skill Profile Types
 *
 * Type definitions for user skill calibration and profile management.
 * Used throughout the application for personalized learning experiences.
 *
 * @remarks
 * This module defines the core skill-related types used for:
 * - Storing user skill levels in localStorage
 * - Generating personalized focus content via the Copilot SDK
 * - Displaying skill calibration UI components
 *
 * @example
 * ```typescript
 * import type { SkillProfile, UserSkill, SkillLevel } from '@/lib/skills';
 *
 * const profile: SkillProfile = {
 *   skills: [
 *     { skillId: 'typescript', level: 'intermediate', source: 'github' },
 *     { skillId: 'react', level: 'advanced', source: 'manual', notInterested: false }
 *   ],
 *   lastUpdated: now()
 * };
 * ```
 */

// =============================================================================
// Skill Level
// =============================================================================

/**
 * Skill proficiency level based on the Dreyfus model.
 *
 * @remarks
 * Levels are simplified from the full Dreyfus model (5 stages) to 3 practical
 * tiers that are easier for users to self-assess:
 *
 * - **beginner**: Novice to Advanced Beginner - Learning fundamentals,
 *   needs guidance and examples
 * - **intermediate**: Competent - Can work independently on familiar tasks,
 *   understands common patterns
 * - **advanced**: Proficient to Expert - Deep understanding, can mentor others,
 *   recognizes edge cases
 *
 * This is the SINGLE SOURCE OF TRUTH for all skill level taxonomies in the app.
 */
export type SkillLevel = 'beginner' | 'intermediate' | 'advanced';

/**
 * Overall experience level for a developer.
 * Uses the same taxonomy as SkillLevel for consistency.
 */
export type ExperienceLevel = SkillLevel;

/**
 * Display labels for skill levels.
 */
export const SKILL_LEVEL_LABELS: Record<SkillLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

/**
 * Descriptions for skill levels (for tooltips/help text).
 */
export const SKILL_LEVEL_DESCRIPTIONS: Record<SkillLevel, string> = {
  beginner: 'Learning the basics, needs guidance and examples',
  intermediate: 'Can work independently on familiar tasks',
  advanced: 'Deep understanding, can handle complex scenarios',
};

// =============================================================================
// User Skill
// =============================================================================

/**
 * Source of the skill level information.
 *
 * - **github**: Detected from GitHub repository analysis
 * - **github-confirmed**: Detected from GitHub, confirmed by user via calibration
 * - **manual**: User explicitly added via the skill profile UI
 */
export type SkillSource = 'github' | 'github-confirmed' | 'manual';

/**
 * Display labels for skill sources.
 */
export const SKILL_SOURCE_LABELS: Record<SkillSource, string> = {
  github: 'Detected from GitHub',
  'github-confirmed': 'Detected from GitHub (confirmed)',
  manual: 'Added manually',
};

/**
 * A single skill with its level and metadata.
 *
 * @example
 * ```typescript
 * const skill: UserSkill = {
 *   skillId: 'typescript',
 *   level: 'intermediate',
 *   source: 'github',
 *   notInterested: false
 * };
 * ```
 */
export interface UserSkill {
  /**
   * Unique identifier for the skill (lowercase, kebab-case).
   *
   * @example 'typescript', 'react', 'ci-cd', 'unit-testing'
   */
  skillId: string;

  /**
   * Current proficiency level.
   */
  level: SkillLevel;

  /**
   * Whether user is not interested in this skill.
   * When true, challenges/goals for this skill are de-prioritized.
   */
  notInterested?: boolean;

  /**
   * How the skill level was determined.
   */
  source: SkillSource;

  /**
   * Display name for the skill.
   * If not provided, skillId is used with formatting.
   */
  displayName?: string;
}

// =============================================================================
// Skill Profile
// =============================================================================

/**
 * Complete user skill profile for personalization.
 *
 * @remarks
 * The skill profile is stored in localStorage and used to:
 * - Generate personalized daily focus content
 * - Adjust challenge difficulty
 * - Filter out topics the user isn't interested in
 *
 * @example
 * ```typescript
 * const profile: SkillProfile = {
 *   skills: [
 *     { skillId: 'typescript', level: 'intermediate', source: 'github' },
 *     { skillId: 'docker', level: 'beginner', source: 'manual', notInterested: true }
 *   ],
 *   lastUpdated: '2026-01-21T10:30:00.000Z'
 * };
 * ```
 */
export interface SkillProfile {
  /**
   * Array of user skills with their levels.
   */
  skills: UserSkill[];

  /**
   * ISO timestamp of last profile update.
   */
  lastUpdated: string;
}

// =============================================================================
// Calibration Types
// =============================================================================

// =============================================================================
// Constants
// =============================================================================

/**
 * Default empty skill profile.
 */
export const DEFAULT_SKILL_PROFILE: SkillProfile = {
  skills: [],
  lastUpdated: '',
};
