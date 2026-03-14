/**
 * Tests for skill prerequisites logic.
 *
 * Covers getNextAchievableSkills with various skill profiles.
 */

import { describe, it, expect } from 'vitest';
import { getNextAchievableSkills, SKILL_PREREQUISITES } from './prerequisites';
import type { SkillProfile } from './types';

function makeProfile(skills: Array<{ skillId: string; level: 'beginner' | 'intermediate' | 'advanced' }>): SkillProfile {
  return {
    skills: skills.map(s => ({ ...s, source: 'manual' as const })),
    lastUpdated: '2026-01-01T00:00:00.000Z',
  };
}

describe('getNextAchievableSkills', () => {
  it('should return all foundation skills when profile is empty', () => {
    const profile = makeProfile([]);
    const result = getNextAchievableSkills(profile);

    const foundationIds = SKILL_PREREQUISITES
      .filter(n => n.prerequisites.length === 0)
      .map(n => n.skillId);

    const resultIds = result.map(n => n.skillId);
    for (const id of foundationIds) {
      expect(resultIds).toContain(id);
    }
  });

  it('should exclude skills whose prerequisites are not met', () => {
    const profile = makeProfile([]); // no skills at all
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map(n => n.skillId);

    // typescript requires javascript — should NOT appear when javascript is absent
    expect(resultIds).not.toContain('typescript');
    // react requires javascript + html + css
    expect(resultIds).not.toContain('react');
  });

  it('should include a skill once all its prerequisites are met at beginner level', () => {
    const profile = makeProfile([
      { skillId: 'javascript', level: 'beginner' },
    ]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map(n => n.skillId);

    expect(resultIds).toContain('typescript');
  });

  it('should exclude skills already at intermediate level', () => {
    const profile = makeProfile([
      { skillId: 'javascript', level: 'intermediate' },
    ]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map(n => n.skillId);

    // javascript itself should NOT be suggested again
    expect(resultIds).not.toContain('javascript');
  });

  it('should exclude skills already at advanced level', () => {
    const profile = makeProfile([
      { skillId: 'javascript', level: 'advanced' },
    ]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map(n => n.skillId);

    expect(resultIds).not.toContain('javascript');
  });

  it('should still suggest beginner-level skill (not yet intermediate)', () => {
    const profile = makeProfile([
      { skillId: 'javascript', level: 'beginner' },
    ]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map(n => n.skillId);

    // javascript is beginner — below the intermediate threshold — should appear
    expect(resultIds).toContain('javascript');
  });

  it('should require ALL prerequisites for multi-prereq skills', () => {
    // react requires javascript, html AND css
    const partialProfile = makeProfile([
      { skillId: 'javascript', level: 'beginner' },
      { skillId: 'html', level: 'beginner' },
      // css is missing
    ]);
    const result = getNextAchievableSkills(partialProfile);
    expect(result.map(n => n.skillId)).not.toContain('react');
  });

  it('should include multi-prereq skills once all prerequisites are present', () => {
    const fullProfile = makeProfile([
      { skillId: 'javascript', level: 'beginner' },
      { skillId: 'html', level: 'beginner' },
      { skillId: 'css', level: 'beginner' },
    ]);
    const result = getNextAchievableSkills(fullProfile);
    expect(result.map(n => n.skillId)).toContain('react');
  });

  it('should deduplicate skills and use highest level when duplicates exist in profile', () => {
    // Duplicate javascript entries: beginner first, then advanced
    const profile: SkillProfile = {
      skills: [
        { skillId: 'javascript', level: 'beginner', source: 'manual' },
        { skillId: 'javascript', level: 'advanced', source: 'github' },
      ],
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };
    const result = getNextAchievableSkills(profile);
    // advanced level should be used — so javascript should NOT appear
    expect(result.map(n => n.skillId)).not.toContain('javascript');
  });

  it('should return nodes with the expected shape', () => {
    const profile = makeProfile([]);
    const result = getNextAchievableSkills(profile);

    expect(result.length).toBeGreaterThan(0);
    for (const node of result) {
      expect(typeof node.skillId).toBe('string');
      expect(typeof node.displayName).toBe('string');
      expect(Array.isArray(node.prerequisites)).toBe(true);
    }
  });

  it('should not return empty results for a profile with only beginner skills', () => {
    const profile = makeProfile([
      { skillId: 'javascript', level: 'beginner' },
      { skillId: 'html', level: 'beginner' },
      { skillId: 'css', level: 'beginner' },
      { skillId: 'python', level: 'beginner' },
    ]);
    const result = getNextAchievableSkills(profile);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should include nextjs when react and typescript prerequisites are both present', () => {
    const profile = makeProfile([
      { skillId: 'react', level: 'beginner' },
      { skillId: 'typescript', level: 'beginner' },
    ]);
    const result = getNextAchievableSkills(profile);
    expect(result.map(n => n.skillId)).toContain('nextjs');
  });
});
