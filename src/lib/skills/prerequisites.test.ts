/**
 * Tests for skill prerequisites logic.
 *
 * Covers getNextAchievableSkills with various profile configurations.
 */

import { describe, it, expect } from 'vitest';
import { getNextAchievableSkills, SKILL_PREREQUISITES } from './prerequisites';
import type { SkillProfile } from '@/lib/skills/types';

/** Create a minimal SkillProfile for tests */
function makeProfile(
  skills: Array<{ skillId: string; level: 'beginner' | 'intermediate' | 'advanced' }>
): SkillProfile {
  return {
    skills: skills.map((s) => ({ ...s, source: 'manual' as const })),
    lastUpdated: '2026-01-01T00:00:00.000Z',
  };
}

describe('getNextAchievableSkills', () => {
  describe('empty profile', () => {
    it('should return all foundation skills (no prerequisites)', () => {
      const profile = makeProfile([]);
      const result = getNextAchievableSkills(profile);

      const foundationSkillIds = SKILL_PREREQUISITES.filter(
        (s) => s.prerequisites.length === 0
      ).map((s) => s.skillId);

      const resultIds = result.map((s) => s.skillId);
      for (const id of foundationSkillIds) {
        expect(resultIds).toContain(id);
      }
    });

    it('should not return skills with prerequisites when profile is empty', () => {
      const profile = makeProfile([]);
      const result = getNextAchievableSkills(profile);

      const skillsWithPrereqs = SKILL_PREREQUISITES.filter(
        (s) => s.prerequisites.length > 0
      ).map((s) => s.skillId);

      const resultIds = result.map((s) => s.skillId);
      for (const id of skillsWithPrereqs) {
        expect(resultIds).not.toContain(id);
      }
    });
  });

  describe('single prerequisite met', () => {
    it('should unlock typescript when javascript is at beginner level', () => {
      const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);
      expect(ids).toContain('typescript');
    });

    it('should unlock nodejs when javascript is present', () => {
      const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);
      expect(ids).toContain('nodejs');
    });

    it('should not unlock react without all 3 prerequisites', () => {
      // react requires: javascript, html, css
      const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);
      expect(ids).not.toContain('react');
    });
  });

  describe('skill already at intermediate+ level excluded', () => {
    it('should exclude javascript (foundation) when already intermediate', () => {
      const profile = makeProfile([{ skillId: 'javascript', level: 'intermediate' }]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);
      expect(ids).not.toContain('javascript');
    });

    it('should exclude skill when already advanced', () => {
      const profile = makeProfile([{ skillId: 'javascript', level: 'advanced' }]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);
      expect(ids).not.toContain('javascript');
    });

    it('should still include skill when only at beginner level', () => {
      const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);
      // javascript has no prereqs and is at beginner — still "achievable" (not yet intermediate+)
      expect(ids).toContain('javascript');
    });
  });

  describe('cascading prerequisites', () => {
    it('should unlock nextjs when react and typescript prerequisites are both present', () => {
      // nextjs requires react and typescript; react requires javascript, html, css
      const profile = makeProfile([
        { skillId: 'react', level: 'beginner' },
        { skillId: 'typescript', level: 'beginner' },
      ]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);
      expect(ids).toContain('nextjs');
    });

    it('should not unlock nextjs when only one prerequisite is present', () => {
      const profile = makeProfile([{ skillId: 'react', level: 'intermediate' }]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);
      expect(ids).not.toContain('nextjs');
    });

    it('should unlock ci-cd only when both git and testing are present', () => {
      const profile = makeProfile([
        { skillId: 'git', level: 'beginner' },
        { skillId: 'testing', level: 'beginner' },
      ]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);
      expect(ids).toContain('ci-cd');
    });

    it('should not unlock ci-cd with only git', () => {
      const profile = makeProfile([{ skillId: 'git', level: 'beginner' }]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);
      expect(ids).not.toContain('ci-cd');
    });

    it('should unlock kubernetes when docker is present', () => {
      const profile = makeProfile([{ skillId: 'docker', level: 'beginner' }]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);
      expect(ids).toContain('kubernetes');
    });
  });

  describe('duplicate skills — highest level wins', () => {
    it('should use highest level when skill appears multiple times', () => {
      // If javascript appears at beginner and intermediate, intermediate should apply
      // so javascript should be excluded (intermediate+)
      const profile: SkillProfile = {
        skills: [
          { skillId: 'javascript', level: 'beginner', source: 'github' },
          { skillId: 'javascript', level: 'intermediate', source: 'manual' },
        ],
        lastUpdated: '2026-01-01T00:00:00.000Z',
      };
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);
      expect(ids).not.toContain('javascript');
    });
  });

  describe('fully advanced profile', () => {
    it('should return empty list when all skills are at intermediate+', () => {
      const profile = makeProfile(
        SKILL_PREREQUISITES.map((s) => ({
          skillId: s.skillId,
          level: 'advanced' as const,
        }))
      );
      const result = getNextAchievableSkills(profile);
      expect(result).toHaveLength(0);
    });
  });

  describe('result structure', () => {
    it('should return SkillNode objects with expected properties', () => {
      const profile = makeProfile([]);
      const result = getNextAchievableSkills(profile);
      expect(result.length).toBeGreaterThan(0);

      for (const node of result) {
        expect(node).toHaveProperty('skillId');
        expect(node).toHaveProperty('displayName');
        expect(node).toHaveProperty('prerequisites');
        expect(typeof node.skillId).toBe('string');
        expect(typeof node.displayName).toBe('string');
        expect(Array.isArray(node.prerequisites)).toBe(true);
      }
    });
  });
});
