/**
 * Tests for skill prerequisite utilities.
 *
 * Covers getNextAchievableSkills across empty profiles,
 * foundation skills, cascading prerequisites, and already-mastered skills.
 */

import { describe, it, expect } from 'vitest';
import { getNextAchievableSkills, SKILL_PREREQUISITES } from './prerequisites';
import type { SkillProfile } from './types';

function makeProfile(skills: Array<{ skillId: string; level: 'beginner' | 'intermediate' | 'advanced' }>): SkillProfile {
  return {
    skills: skills.map((s) => ({ ...s, source: 'manual' as const })),
    lastUpdated: '2026-01-01T00:00:00.000Z',
  };
}

describe('getNextAchievableSkills', () => {
  describe('empty profile', () => {
    it('should return only foundation skills (no prerequisites)', () => {
      const result = getNextAchievableSkills(makeProfile([]));
      const ids = result.map((s) => s.skillId);

      // Foundation skills have empty prerequisites
      const foundations = SKILL_PREREQUISITES
        .filter((s) => s.prerequisites.length === 0)
        .map((s) => s.skillId);

      expect(ids.sort()).toEqual(foundations.sort());
    });

    it('should not include skills that have prerequisites', () => {
      const result = getNextAchievableSkills(makeProfile([]));
      for (const skill of result) {
        expect(skill.prerequisites).toHaveLength(0);
      }
    });
  });

  describe('skills already at intermediate or advanced are excluded', () => {
    it('should exclude a skill the user already has at intermediate', () => {
      const profile = makeProfile([{ skillId: 'javascript', level: 'intermediate' }]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);

      expect(ids).not.toContain('javascript');
    });

    it('should exclude a skill the user already has at advanced', () => {
      const profile = makeProfile([{ skillId: 'python', level: 'advanced' }]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);

      expect(ids).not.toContain('python');
    });

    it('should keep a skill the user has at beginner level (still achievable)', () => {
      const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);

      expect(ids).toContain('javascript');
    });
  });

  describe('prerequisite resolution', () => {
    it('should unlock typescript when javascript is in the profile', () => {
      const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);

      expect(ids).toContain('typescript');
    });

    it('should not include typescript when javascript is not in the profile', () => {
      const result = getNextAchievableSkills(makeProfile([]));
      const ids = result.map((s) => s.skillId);

      expect(ids).not.toContain('typescript');
    });

    it('should unlock react when javascript, html, and css are all in the profile', () => {
      const profile = makeProfile([
        { skillId: 'javascript', level: 'beginner' },
        { skillId: 'html', level: 'beginner' },
        { skillId: 'css', level: 'beginner' },
      ]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);

      expect(ids).toContain('react');
    });

    it('should not unlock react when only javascript is present (missing html and css)', () => {
      const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);

      expect(ids).not.toContain('react');
    });

    it('should not unlock react when only html is present (missing javascript and css)', () => {
      const profile = makeProfile([{ skillId: 'html', level: 'beginner' }]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);

      expect(ids).not.toContain('react');
    });
  });

  describe('cascading prerequisites (nextjs requires react + typescript)', () => {
    it('should not unlock nextjs without react and typescript', () => {
      const profile = makeProfile([
        { skillId: 'javascript', level: 'beginner' },
        { skillId: 'html', level: 'beginner' },
        { skillId: 'css', level: 'beginner' },
      ]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);

      expect(ids).not.toContain('nextjs');
    });

    it('should unlock nextjs when react and typescript are both in profile', () => {
      const profile = makeProfile([
        { skillId: 'react', level: 'beginner' },
        { skillId: 'typescript', level: 'beginner' },
      ]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);

      expect(ids).toContain('nextjs');
    });

    it('should exclude nextjs once user reaches intermediate nextjs', () => {
      const profile = makeProfile([
        { skillId: 'react', level: 'beginner' },
        { skillId: 'typescript', level: 'beginner' },
        { skillId: 'nextjs', level: 'intermediate' },
      ]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);

      expect(ids).not.toContain('nextjs');
    });
  });

  describe('duplicate skills in profile', () => {
    it('should use the highest level when a skillId appears multiple times', () => {
      // User has javascript at beginner AND intermediate — should use intermediate
      const profile = makeProfile([
        { skillId: 'javascript', level: 'beginner' },
        { skillId: 'javascript', level: 'intermediate' },
      ]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);

      // At intermediate, javascript itself is excluded
      expect(ids).not.toContain('javascript');
      // But its dependents should be unlocked
      expect(ids).toContain('typescript');
    });
  });

  describe('ci-cd requires both git and testing', () => {
    it('should not unlock ci-cd without both git and testing', () => {
      const profile = makeProfile([{ skillId: 'git', level: 'beginner' }]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);

      expect(ids).not.toContain('ci-cd');
    });

    it('should unlock ci-cd when both git and testing are present', () => {
      const profile = makeProfile([
        { skillId: 'git', level: 'beginner' },
        { skillId: 'testing', level: 'beginner' },
      ]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);

      expect(ids).toContain('ci-cd');
    });
  });
});
