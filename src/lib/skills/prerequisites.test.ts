/**
 * Tests for Skill Prerequisites Module
 *
 * Tests the Knowledge Space Theory–based "next achievable skills" logic.
 */

import { describe, expect, it } from 'vitest';
import {
  getNextAchievableSkills,
  SKILL_PREREQUISITES,
} from './prerequisites';
import type { SkillProfile } from './types';

// =============================================================================
// Helpers
// =============================================================================

function makeProfile(skills: Array<{ skillId: string; level: 'beginner' | 'intermediate' | 'advanced' }>): SkillProfile {
  return {
    skills: skills.map(({ skillId, level }) => ({
      skillId,
      level,
      source: 'manual' as const,
    })),
    lastUpdated: '2026-01-01T00:00:00.000Z',
  };
}

// =============================================================================
// getNextAchievableSkills Tests
// =============================================================================

describe('getNextAchievableSkills', () => {
  it('should return all foundation skills (no prerequisites) for an empty profile', () => {
    const profile = makeProfile([]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    // Foundation skills have empty prerequisites arrays
    const foundations = SKILL_PREREQUISITES.filter((s) => s.prerequisites.length === 0);
    for (const found of foundations) {
      expect(resultIds).toContain(found.skillId);
    }
  });

  it('should not return a skill already at intermediate level', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'intermediate' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);
    expect(resultIds).not.toContain('javascript');
  });

  it('should not return a skill already at advanced level', () => {
    const profile = makeProfile([{ skillId: 'python', level: 'advanced' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);
    expect(resultIds).not.toContain('python');
  });

  it('should still include a skill at beginner level (not yet intermediate)', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);
    expect(resultIds).toContain('javascript');
  });

  it('should unlock typescript when javascript is in the profile', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);
    expect(resultIds).toContain('typescript');
  });

  it('should not unlock react when only one of its prerequisites (javascript) is met', () => {
    // react requires javascript, html, and css
    const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);
    expect(resultIds).not.toContain('react');
  });

  it('should unlock react when all its prerequisites are met', () => {
    const profile = makeProfile([
      { skillId: 'javascript', level: 'beginner' },
      { skillId: 'html', level: 'beginner' },
      { skillId: 'css', level: 'beginner' },
    ]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);
    expect(resultIds).toContain('react');
  });

  it('should unlock css when html is in the profile', () => {
    const profile = makeProfile([{ skillId: 'html', level: 'beginner' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);
    expect(resultIds).toContain('css');
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

  it('should not return nextjs if react is intermediate+ (already mastered) but typescript is missing', () => {
    const profile = makeProfile([
      { skillId: 'react', level: 'intermediate' },
    ]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);
    expect(resultIds).not.toContain('nextjs');
  });

  it('should unlock kubernetes when docker is in the profile', () => {
    const profile = makeProfile([{ skillId: 'docker', level: 'beginner' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);
    expect(resultIds).toContain('kubernetes');
  });

  it('should unlock ci-cd when both git and testing are in the profile', () => {
    const profile = makeProfile([
      { skillId: 'git', level: 'beginner' },
      { skillId: 'testing', level: 'beginner' },
    ]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);
    expect(resultIds).toContain('ci-cd');
  });

  it('should not unlock ci-cd when only git is present (testing missing)', () => {
    const profile = makeProfile([{ skillId: 'git', level: 'beginner' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);
    expect(resultIds).not.toContain('ci-cd');
  });

  it('should use the highest level when a skill is listed multiple times', () => {
    // Simulate a profile with the same skillId duplicated at different levels
    const profile: SkillProfile = {
      skills: [
        { skillId: 'javascript', level: 'beginner', source: 'github' },
        { skillId: 'javascript', level: 'intermediate', source: 'manual' },
      ],
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };
    // javascript is at intermediate (highest), so it should NOT be in results
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);
    expect(resultIds).not.toContain('javascript');
  });

  it('should return SkillNode objects with expected shape', () => {
    const profile = makeProfile([]);
    const result = getNextAchievableSkills(profile);
    for (const node of result) {
      expect(node).toHaveProperty('skillId');
      expect(node).toHaveProperty('displayName');
      expect(node).toHaveProperty('prerequisites');
      expect(Array.isArray(node.prerequisites)).toBe(true);
    }
  });

  it('should unlock machine-learning when python is in the profile', () => {
    const profile = makeProfile([{ skillId: 'python', level: 'beginner' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);
    expect(resultIds).toContain('machine-learning');
  });
});

// =============================================================================
// SKILL_PREREQUISITES constant Tests
// =============================================================================

describe('SKILL_PREREQUISITES', () => {
  it('should be a non-empty array', () => {
    expect(Array.isArray(SKILL_PREREQUISITES)).toBe(true);
    expect(SKILL_PREREQUISITES.length).toBeGreaterThan(0);
  });

  it('every node should have a non-empty skillId', () => {
    for (const node of SKILL_PREREQUISITES) {
      expect(typeof node.skillId).toBe('string');
      expect(node.skillId.length).toBeGreaterThan(0);
    }
  });

  it('every prerequisite should reference a valid skillId in the map', () => {
    const allIds = new Set(SKILL_PREREQUISITES.map((n) => n.skillId));
    for (const node of SKILL_PREREQUISITES) {
      for (const prereq of node.prerequisites) {
        expect(allIds.has(prereq), `Unknown prereq "${prereq}" in node "${node.skillId}"`).toBe(true);
      }
    }
  });

  it('should contain foundation skills (no prerequisites) like javascript, html, python, sql, git', () => {
    const foundations = SKILL_PREREQUISITES
      .filter((n) => n.prerequisites.length === 0)
      .map((n) => n.skillId);
    expect(foundations).toContain('javascript');
    expect(foundations).toContain('html');
    expect(foundations).toContain('python');
    expect(foundations).toContain('sql');
    expect(foundations).toContain('git');
  });
});
