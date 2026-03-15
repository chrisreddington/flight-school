/**
 * Tests for skill prerequisites utilities.
 *
 * Covers getNextAchievableSkills logic including empty profiles,
 * foundation skills, prerequisite chains, and already-advanced skills.
 */

import { describe, it, expect } from 'vitest';
import { getNextAchievableSkills, SKILL_PREREQUISITES } from './prerequisites';
import type { SkillProfile, UserSkill } from './types';

function makeProfile(skills: Array<{ skillId: string; level: 'beginner' | 'intermediate' | 'advanced' }>): SkillProfile {
  return {
    skills: skills.map((s): UserSkill => ({
      skillId: s.skillId,
      level: s.level,
      source: 'manual',
    })),
    lastUpdated: '2026-01-01T00:00:00.000Z',
  };
}

describe('getNextAchievableSkills', () => {
  describe('empty profile', () => {
    it('should return only foundation skills (no prerequisites) for an empty profile', () => {
      const profile = makeProfile([]);
      const result = getNextAchievableSkills(profile);

      // All returned skills should have empty prerequisites
      for (const skill of result) {
        expect(skill.prerequisites).toHaveLength(0);
      }

      // Verify known foundation skills are included
      const ids = result.map((s) => s.skillId);
      expect(ids).toContain('javascript');
      expect(ids).toContain('python');
      expect(ids).toContain('html');
      expect(ids).toContain('sql');
      expect(ids).toContain('git');
    });

    it('should not include skills with prerequisites when profile is empty', () => {
      const profile = makeProfile([]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);

      // These require prerequisites
      expect(ids).not.toContain('typescript'); // requires javascript
      expect(ids).not.toContain('nextjs');     // requires react, typescript
      expect(ids).not.toContain('docker');     // requires nodejs
    });
  });

  describe('prerequisite satisfaction', () => {
    it('should unlock skills when prerequisites are present at beginner level', () => {
      // 'typescript' requires 'javascript'
      const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);

      expect(ids).toContain('typescript');
    });

    it('should unlock css when html is present', () => {
      const profile = makeProfile([{ skillId: 'html', level: 'beginner' }]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);

      expect(ids).toContain('css');
    });

    it('should unlock react only when all prerequisites (javascript, html, css) are met', () => {
      // React requires javascript, html, css — missing css
      const partialProfile = makeProfile([
        { skillId: 'javascript', level: 'beginner' },
        { skillId: 'html', level: 'beginner' },
      ]);
      const partialResult = getNextAchievableSkills(partialProfile);
      expect(partialResult.map((s) => s.skillId)).not.toContain('react');

      // All prerequisites present
      const fullProfile = makeProfile([
        { skillId: 'javascript', level: 'beginner' },
        { skillId: 'html', level: 'beginner' },
        { skillId: 'css', level: 'beginner' },
      ]);
      const fullResult = getNextAchievableSkills(fullProfile);
      expect(fullResult.map((s) => s.skillId)).toContain('react');
    });

    it('should unlock ci-cd when both git and testing are present', () => {
      // ci-cd requires git and testing
      const profile = makeProfile([
        { skillId: 'git', level: 'beginner' },
        { skillId: 'testing', level: 'beginner' },
      ]);
      const result = getNextAchievableSkills(profile);
      expect(result.map((s) => s.skillId)).toContain('ci-cd');
    });
  });

  describe('filtering already-achieved skills', () => {
    it('should exclude skills already at intermediate level', () => {
      const profile = makeProfile([
        { skillId: 'javascript', level: 'intermediate' },
      ]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);

      // javascript is already intermediate — should be excluded
      expect(ids).not.toContain('javascript');
    });

    it('should exclude skills already at advanced level', () => {
      const profile = makeProfile([
        { skillId: 'javascript', level: 'advanced' },
      ]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);

      expect(ids).not.toContain('javascript');
    });

    it('should include skills still at beginner level even if they have no unmet prerequisites', () => {
      // javascript at beginner — still "achievable" (user can work toward intermediate)
      const profile = makeProfile([
        { skillId: 'javascript', level: 'beginner' },
      ]);
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);

      expect(ids).toContain('javascript');
    });
  });

  describe('duplicate skills — takes highest level', () => {
    it('should use the highest level when a skill appears multiple times', () => {
      // If javascript appears twice with different levels, take the higher (advanced)
      const profile: SkillProfile = {
        skills: [
          { skillId: 'javascript', level: 'beginner', source: 'github' },
          { skillId: 'javascript', level: 'advanced', source: 'manual' },
        ],
        lastUpdated: '2026-01-01T00:00:00.000Z',
      };
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);

      // advanced level — should be excluded from "achievable" list
      expect(ids).not.toContain('javascript');
    });

    it('should use the highest level when duplicates keep skill below intermediate', () => {
      const profile: SkillProfile = {
        skills: [
          { skillId: 'javascript', level: 'beginner', source: 'github' },
          { skillId: 'javascript', level: 'beginner', source: 'manual' },
        ],
        lastUpdated: '2026-01-01T00:00:00.000Z',
      };
      const result = getNextAchievableSkills(profile);
      const ids = result.map((s) => s.skillId);

      // Still beginner — should remain achievable
      expect(ids).toContain('javascript');
    });
  });

  describe('SKILL_PREREQUISITES data integrity', () => {
    it('should have unique skill IDs in the prerequisites list', () => {
      const ids = SKILL_PREREQUISITES.map((s) => s.skillId);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should only reference valid skill IDs in prerequisites', () => {
      const allIds = new Set(SKILL_PREREQUISITES.map((s) => s.skillId));
      for (const skill of SKILL_PREREQUISITES) {
        for (const prereq of skill.prerequisites) {
          expect(allIds.has(prereq), `Unknown prerequisite '${prereq}' for skill '${skill.skillId}'`).toBe(true);
        }
      }
    });
  });
});
