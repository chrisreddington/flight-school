import { describe, expect, it } from 'vitest';
import { DEFAULT_SKILL_PROFILE } from '@/lib/skills/types';
import type { SkillProfile } from '@/lib/skills/types';
import { getNextAchievableSkills, SKILL_PREREQUISITES } from './prerequisites';

function makeProfile(skills: Array<{ skillId: string; level: 'beginner' | 'intermediate' | 'advanced' }>): SkillProfile {
  return {
    skills: skills.map((s) => ({ ...s, source: 'manual' as const })),
    lastUpdated: '2026-01-01T00:00:00.000Z',
  };
}

describe('getNextAchievableSkills', () => {
  it('should return all foundation skills (no prerequisites) for an empty profile', () => {
    const result = getNextAchievableSkills(DEFAULT_SKILL_PROFILE);
    const resultIds = result.map((s) => s.skillId);

    // Foundation skills have empty prerequisites
    const foundationSkills = SKILL_PREREQUISITES.filter((s) => s.prerequisites.length === 0);
    for (const foundation of foundationSkills) {
      expect(resultIds).toContain(foundation.skillId);
    }
  });

  it('should not return skills the user already has at intermediate level', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'intermediate' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).not.toContain('javascript');
  });

  it('should not return skills the user already has at advanced level', () => {
    const profile = makeProfile([{ skillId: 'python', level: 'advanced' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).not.toContain('python');
  });

  it('should return a beginner-level skill as still achievable (since it is not intermediate+)', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    // javascript at beginner is not intermediate+, so it is still "achievable"
    expect(resultIds).toContain('javascript');
  });

  it('should unlock typescript when javascript is at beginner level (prerequisite only needs to be present)', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).toContain('typescript');
  });

  it('should unlock react when javascript, html, and css are all present', () => {
    const profile = makeProfile([
      { skillId: 'javascript', level: 'intermediate' },
      { skillId: 'html', level: 'intermediate' },
      { skillId: 'css', level: 'beginner' },
    ]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).toContain('react');
  });

  it('should not unlock react when css is missing', () => {
    const profile = makeProfile([
      { skillId: 'javascript', level: 'intermediate' },
      { skillId: 'html', level: 'intermediate' },
    ]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).not.toContain('react');
  });

  it('should unlock nextjs when both react and typescript are present', () => {
    const profile = makeProfile([
      { skillId: 'javascript', level: 'intermediate' },
      { skillId: 'html', level: 'intermediate' },
      { skillId: 'css', level: 'intermediate' },
      { skillId: 'react', level: 'beginner' },
      { skillId: 'typescript', level: 'beginner' },
    ]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).toContain('nextjs');
  });

  it('should not unlock nextjs when react is missing', () => {
    const profile = makeProfile([
      { skillId: 'typescript', level: 'intermediate' },
    ]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).not.toContain('nextjs');
  });

  it('should use the highest level when a skill appears multiple times', () => {
    // If the same skillId is listed twice, the higher level should take precedence
    const profile: SkillProfile = {
      skills: [
        { skillId: 'javascript', level: 'beginner', source: 'github' },
        { skillId: 'javascript', level: 'intermediate', source: 'manual' },
      ],
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    // At intermediate level, javascript should be excluded
    expect(resultIds).not.toContain('javascript');
    // But typescript (requires javascript as prereq) should be unlocked
    expect(resultIds).toContain('typescript');
  });

  it('should unlock ci-cd only when both git and testing are present', () => {
    const profile = makeProfile([
      { skillId: 'git', level: 'beginner' },
      { skillId: 'testing', level: 'beginner' },
      { skillId: 'javascript', level: 'beginner' }, // testing prereq
    ]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).toContain('ci-cd');
  });

  it('should unlock kubernetes only when docker is present', () => {
    const profile = makeProfile([
      { skillId: 'javascript', level: 'intermediate' },
      { skillId: 'nodejs', level: 'beginner' },
      { skillId: 'docker', level: 'beginner' },
    ]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).toContain('kubernetes');
  });

  it('should return an array of SkillNode objects with correct shape', () => {
    const result = getNextAchievableSkills(DEFAULT_SKILL_PROFILE);

    expect(result.length).toBeGreaterThan(0);
    for (const node of result) {
      expect(node).toHaveProperty('skillId');
      expect(node).toHaveProperty('displayName');
      expect(node).toHaveProperty('prerequisites');
      expect(Array.isArray(node.prerequisites)).toBe(true);
    }
  });
});
