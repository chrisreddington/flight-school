/**
 * Tests for skill prerequisite utilities.
 */

import { describe, expect, it } from 'vitest';
import { getNextAchievableSkills } from './prerequisites';
import type { SkillProfile } from '@/lib/skills/types';

/** Helper to build a minimal SkillProfile. */
function makeProfile(skills: Array<{ skillId: string; level: 'beginner' | 'intermediate' | 'advanced' }>): SkillProfile {
  return {
    skills: skills.map((s) => ({ ...s, source: 'manual' as const })),
    lastUpdated: new Date().toISOString(),
  };
}

describe('getNextAchievableSkills', () => {
  it('should return all foundation skills for an empty profile', () => {
    const profile = makeProfile([]);
    const result = getNextAchievableSkills(profile);
    const ids = result.map((s) => s.skillId);

    // Foundation skills have no prerequisites — all should be in result
    expect(ids).toContain('javascript');
    expect(ids).toContain('html');
    expect(ids).toContain('python');
    expect(ids).toContain('sql');
    expect(ids).toContain('git');
  });

  it('should NOT return skills whose prerequisites are not met', () => {
    const profile = makeProfile([]);
    const result = getNextAchievableSkills(profile);
    const ids = result.map((s) => s.skillId);

    // nextjs requires react + typescript — not achievable from empty profile
    expect(ids).not.toContain('nextjs');
    // ci-cd requires git + testing
    expect(ids).not.toContain('ci-cd');
  });

  it('should unlock single-prerequisite skills when the prereq is met at any level', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
    const result = getNextAchievableSkills(profile);
    const ids = result.map((s) => s.skillId);

    expect(ids).toContain('typescript');
    expect(ids).toContain('nodejs');
    expect(ids).toContain('testing');
  });

  it('should NOT return a skill already at intermediate level', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'intermediate' }]);
    const result = getNextAchievableSkills(profile);
    const ids = result.map((s) => s.skillId);

    expect(ids).not.toContain('javascript');
  });

  it('should NOT return a skill already at advanced level', () => {
    const profile = makeProfile([{ skillId: 'python', level: 'advanced' }]);
    const result = getNextAchievableSkills(profile);
    const ids = result.map((s) => s.skillId);

    expect(ids).not.toContain('python');
  });

  it('should return a skill still at beginner level even when prerequisites are met', () => {
    // typescript has prerequisite javascript; if user is beginner at typescript, it should still be returned
    const profile = makeProfile([
      { skillId: 'javascript', level: 'beginner' },
      { skillId: 'typescript', level: 'beginner' },
    ]);
    const result = getNextAchievableSkills(profile);
    const ids = result.map((s) => s.skillId);

    expect(ids).toContain('typescript');
  });

  it('should unlock multi-prerequisite skills only when ALL prereqs are present', () => {
    // nextjs requires both react AND typescript
    const onlyReact = makeProfile([
      { skillId: 'javascript', level: 'intermediate' },
      { skillId: 'html', level: 'intermediate' },
      { skillId: 'css', level: 'intermediate' },
      { skillId: 'react', level: 'beginner' },
    ]);
    expect(getNextAchievableSkills(onlyReact).map((s) => s.skillId)).not.toContain('nextjs');

    const reactAndTypescript = makeProfile([
      { skillId: 'javascript', level: 'intermediate' },
      { skillId: 'html', level: 'intermediate' },
      { skillId: 'css', level: 'intermediate' },
      { skillId: 'react', level: 'beginner' },
      { skillId: 'typescript', level: 'beginner' },
    ]);
    expect(getNextAchievableSkills(reactAndTypescript).map((s) => s.skillId)).toContain('nextjs');
  });

  it('should deduplicate skills and use the highest level when a skill appears more than once', () => {
    // Provide javascript at beginner twice and once at intermediate
    const profile: SkillProfile = {
      skills: [
        { skillId: 'javascript', level: 'beginner', source: 'manual' },
        { skillId: 'javascript', level: 'intermediate', source: 'github' },
        { skillId: 'javascript', level: 'beginner', source: 'manual' },
      ],
      lastUpdated: '',
    };

    const result = getNextAchievableSkills(profile);
    const ids = result.map((s) => s.skillId);

    // Highest level is intermediate — should be excluded
    expect(ids).not.toContain('javascript');
  });

  it('should return nodes with the expected shape', () => {
    const profile = makeProfile([]);
    const result = getNextAchievableSkills(profile);

    for (const node of result) {
      expect(node).toHaveProperty('skillId');
      expect(node).toHaveProperty('displayName');
      expect(node).toHaveProperty('prerequisites');
      expect(Array.isArray(node.prerequisites)).toBe(true);
    }
  });

  it('should unlock ci-cd when both git and testing prerequisites are present', () => {
    const profile = makeProfile([
      { skillId: 'git', level: 'beginner' },
      { skillId: 'javascript', level: 'beginner' },
      { skillId: 'testing', level: 'beginner' },
    ]);
    const ids = getNextAchievableSkills(profile).map((s) => s.skillId);
    expect(ids).toContain('ci-cd');
  });
});
