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
  it('returns all foundation skills (no prerequisites) for an empty profile', () => {
    const profile = makeProfile([]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    const foundations = SKILL_PREREQUISITES.filter((s) => s.prerequisites.length === 0).map((s) => s.skillId);
    for (const id of foundations) {
      expect(resultIds).toContain(id);
    }
  });

  it('excludes skills where prerequisites are missing', () => {
    const profile = makeProfile([]); // no skills at all
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    // typescript requires javascript - should not appear without javascript
    expect(resultIds).not.toContain('typescript');
    // nextjs requires react + typescript - should not appear
    expect(resultIds).not.toContain('nextjs');
  });

  it('unlocks typescript when javascript is in the profile (any level)', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
    const result = getNextAchievableSkills(profile);
    expect(result.map((s) => s.skillId)).toContain('typescript');
  });

  it('excludes already intermediate+ skills from next-achievable list', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'intermediate' }]);
    const result = getNextAchievableSkills(profile);
    expect(result.map((s) => s.skillId)).not.toContain('javascript');
  });

  it('includes beginner-level skills as still achievable', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
    const result = getNextAchievableSkills(profile);
    // javascript is beginner, so it should still appear (not yet intermediate+)
    expect(result.map((s) => s.skillId)).toContain('javascript');
  });

  it('unlocks react when javascript, html, and css are all in profile', () => {
    const profile = makeProfile([
      { skillId: 'javascript', level: 'beginner' },
      { skillId: 'html', level: 'beginner' },
      { skillId: 'css', level: 'beginner' },
    ]);
    const result = getNextAchievableSkills(profile);
    expect(result.map((s) => s.skillId)).toContain('react');
  });

  it('does not unlock react when only javascript and html present (missing css)', () => {
    const profile = makeProfile([
      { skillId: 'javascript', level: 'beginner' },
      { skillId: 'html', level: 'beginner' },
    ]);
    const result = getNextAchievableSkills(profile);
    expect(result.map((s) => s.skillId)).not.toContain('react');
  });

  it('unlocks nextjs when react and typescript are both in profile', () => {
    const profile = makeProfile([
      { skillId: 'javascript', level: 'beginner' },
      { skillId: 'html', level: 'beginner' },
      { skillId: 'css', level: 'beginner' },
      { skillId: 'react', level: 'beginner' },
      { skillId: 'typescript', level: 'beginner' },
    ]);
    const result = getNextAchievableSkills(profile);
    expect(result.map((s) => s.skillId)).toContain('nextjs');
  });

  it('excludes nextjs if already intermediate+', () => {
    const profile = makeProfile([
      { skillId: 'react', level: 'beginner' },
      { skillId: 'typescript', level: 'beginner' },
      { skillId: 'nextjs', level: 'intermediate' },
    ]);
    const result = getNextAchievableSkills(profile);
    expect(result.map((s) => s.skillId)).not.toContain('nextjs');
  });

  it('uses the highest level when a skill appears multiple times in profile', () => {
    const profile: SkillProfile = {
      skills: [
        { skillId: 'javascript', level: 'beginner', source: 'github' },
        { skillId: 'javascript', level: 'intermediate', source: 'manual' },
      ],
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };
    const result = getNextAchievableSkills(profile);
    // intermediate+ so should be excluded
    expect(result.map((s) => s.skillId)).not.toContain('javascript');
  });

  it('returns empty array when all skills are advanced', () => {
    const allAdvanced = SKILL_PREREQUISITES.map((s) => ({
      skillId: s.skillId,
      level: 'advanced' as const,
    }));
    const profile = makeProfile(allAdvanced);
    expect(getNextAchievableSkills(profile)).toHaveLength(0);
  });

  it('unlocks ci-cd only when both git and testing prerequisites are present', () => {
    const onlyGit = makeProfile([{ skillId: 'git', level: 'beginner' }]);
    expect(getNextAchievableSkills(onlyGit).map((s) => s.skillId)).not.toContain('ci-cd');

    const withJavascript = makeProfile([
      { skillId: 'javascript', level: 'beginner' },
      { skillId: 'git', level: 'beginner' },
      { skillId: 'testing', level: 'beginner' },
    ]);
    expect(getNextAchievableSkills(withJavascript).map((s) => s.skillId)).toContain('ci-cd');
  });
});
