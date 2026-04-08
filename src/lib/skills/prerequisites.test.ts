/**
 * Tests for Skill Prerequisites
 *
 * Covers getNextAchievableSkills and related logic.
 */

import { describe, it, expect } from 'vitest';
import { getNextAchievableSkills, SKILL_PREREQUISITES } from './prerequisites';
import type { SkillProfile } from '@/lib/skills/types';

/** Helper to build a SkillProfile from a simple map of skillId → level */
function makeProfile(
  skills: Array<{ skillId: string; level: 'beginner' | 'intermediate' | 'advanced' }>
): SkillProfile {
  return {
    skills: skills.map((s) => ({
      skillId: s.skillId,
      level: s.level,
      source: 'manual' as const,
    })),
    lastUpdated: '2026-01-01T00:00:00.000Z',
  };
}

const emptyProfile: SkillProfile = { skills: [], lastUpdated: '2026-01-01T00:00:00.000Z' };

describe('getNextAchievableSkills', () => {
  it('should return all foundation skills (no prerequisites) for an empty profile', () => {
    const result = getNextAchievableSkills(emptyProfile);
    const resultIds = result.map((s) => s.skillId);

    // Foundation skills have no prerequisites
    const foundationSkills = SKILL_PREREQUISITES.filter((s) => s.prerequisites.length === 0);
    for (const skill of foundationSkills) {
      expect(resultIds).toContain(skill.skillId);
    }
  });

  it('should not include skills with unmet prerequisites', () => {
    const result = getNextAchievableSkills(emptyProfile);
    const resultIds = result.map((s) => s.skillId);

    // typescript requires javascript — should not appear without javascript
    expect(resultIds).not.toContain('typescript');
    // nextjs requires react + typescript — should not appear
    expect(resultIds).not.toContain('nextjs');
  });

  it('should unlock dependent skills when prerequisites are met at beginner level', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    // typescript requires javascript — now achievable
    expect(resultIds).toContain('typescript');
    // testing requires javascript — now achievable
    expect(resultIds).toContain('testing');
  });

  it('should exclude skills already at intermediate level from results', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'intermediate' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    // javascript is already intermediate — shouldn't be "next achievable"
    expect(resultIds).not.toContain('javascript');
  });

  it('should exclude skills already at advanced level from results', () => {
    const profile = makeProfile([{ skillId: 'python', level: 'advanced' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).not.toContain('python');
  });

  it('should include beginner-level skills as still achievable', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    // javascript at beginner is not intermediate+, so it remains in the list
    expect(resultIds).toContain('javascript');
  });

  it('should unlock nextjs when react and typescript prerequisites are met', () => {
    const profile = makeProfile([
      { skillId: 'react', level: 'beginner' },
      { skillId: 'typescript', level: 'beginner' },
    ]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).toContain('nextjs');
  });

  it('should not unlock nextjs when only one of two prerequisites is met', () => {
    const profile = makeProfile([{ skillId: 'react', level: 'intermediate' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).not.toContain('nextjs');
  });

  it('should handle the same skill appearing multiple times — keep highest level', () => {
    // Duplicate entry: beginner then advanced for javascript
    const profile: SkillProfile = {
      skills: [
        { skillId: 'javascript', level: 'beginner', source: 'github' },
        { skillId: 'javascript', level: 'advanced', source: 'manual' },
      ],
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    // advanced javascript → excluded (intermediate+)
    expect(resultIds).not.toContain('javascript');
    // typescript dependency on javascript is met (any level)
    expect(resultIds).toContain('typescript');
  });

  it('should unlock ci-cd when both git and testing prerequisites are met', () => {
    const profile = makeProfile([
      { skillId: 'git', level: 'beginner' },
      { skillId: 'testing', level: 'beginner' },
    ]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).toContain('ci-cd');
  });

  it('should return an array of SkillNode objects with correct shape', () => {
    const result = getNextAchievableSkills(emptyProfile);

    expect(result.length).toBeGreaterThan(0);
    for (const node of result) {
      expect(node).toHaveProperty('skillId');
      expect(node).toHaveProperty('displayName');
      expect(node).toHaveProperty('prerequisites');
      expect(Array.isArray(node.prerequisites)).toBe(true);
    }
  });

  it('should return empty array when all skills are at intermediate+ and no new ones unlocked', () => {
    // Mark all SKILL_PREREQUISITES skills as advanced
    const allAdvanced = SKILL_PREREQUISITES.map((s) => ({
      skillId: s.skillId,
      level: 'advanced' as const,
    }));
    const profile = makeProfile(allAdvanced);
    const result = getNextAchievableSkills(profile);

    expect(result).toHaveLength(0);
  });
});
