import { describe, expect, it } from 'vitest';
import { getNextAchievableSkills, SKILL_PREREQUISITES } from './prerequisites';
import type { SkillProfile } from './types';

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

describe('getNextAchievableSkills', () => {
  it('should return foundation skills (no prerequisites) for empty profile', () => {
    const profile = makeProfile([]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    // All skills with no prerequisites should be achievable
    const foundationSkills = SKILL_PREREQUISITES.filter((s) => s.prerequisites.length === 0);
    for (const skill of foundationSkills) {
      expect(resultIds).toContain(skill.skillId);
    }
  });

  it('should NOT include skills whose prerequisites are not met', () => {
    const profile = makeProfile([]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    // typescript requires javascript — not achievable without it
    expect(resultIds).not.toContain('typescript');
    // react requires javascript, html, css — not achievable
    expect(resultIds).not.toContain('react');
    // nextjs requires react and typescript — not achievable
    expect(resultIds).not.toContain('nextjs');
  });

  it('should unlock prerequisite-gated skills when prerequisites are met at beginner level', () => {
    // typescript requires javascript (any level)
    const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).toContain('typescript');
    expect(resultIds).toContain('nodejs');
    expect(resultIds).toContain('testing');
  });

  it('should exclude skills the user already has at intermediate level', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'intermediate' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).not.toContain('javascript');
  });

  it('should exclude skills the user already has at advanced level', () => {
    const profile = makeProfile([{ skillId: 'python', level: 'advanced' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).not.toContain('python');
  });

  it('should still include a skill the user has at beginner level (not yet intermediate)', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    // javascript is still achievable since they're only beginner
    expect(resultIds).toContain('javascript');
  });

  it('should unlock multi-prerequisite skills when all prerequisites are present', () => {
    // react requires javascript + html + css
    const profile = makeProfile([
      { skillId: 'javascript', level: 'beginner' },
      { skillId: 'html', level: 'beginner' },
      { skillId: 'css', level: 'beginner' },
    ]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).toContain('react');
  });

  it('should NOT unlock multi-prerequisite skill when only some prerequisites are present', () => {
    // react requires javascript + html + css, but only javascript is present
    const profile = makeProfile([{ skillId: 'javascript', level: 'intermediate' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).not.toContain('react');
  });

  it('should handle cascading prerequisites (nextjs requires react+typescript, which themselves have prereqs)', () => {
    // nextjs requires react and typescript
    const profileWithoutReact = makeProfile([
      { skillId: 'typescript', level: 'beginner' },
    ]);
    expect(getNextAchievableSkills(profileWithoutReact).map((s) => s.skillId)).not.toContain('nextjs');

    const profileWithBoth = makeProfile([
      { skillId: 'react', level: 'beginner' },
      { skillId: 'typescript', level: 'beginner' },
    ]);
    expect(getNextAchievableSkills(profileWithBoth).map((s) => s.skillId)).toContain('nextjs');
  });

  it('should use highest skill level when a skill appears multiple times in profile', () => {
    // Profile with duplicate entries — highest level wins
    const profile: SkillProfile = {
      skills: [
        { skillId: 'javascript', level: 'beginner', source: 'github' },
        { skillId: 'javascript', level: 'intermediate', source: 'manual' },
      ],
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    // intermediate+ means javascript is excluded
    expect(resultIds).not.toContain('javascript');
    // but typescript (requires javascript) should be unlocked
    expect(resultIds).toContain('typescript');
  });

  it('should unlock ci-cd when both git and testing prerequisites are met', () => {
    const profile = makeProfile([
      { skillId: 'git', level: 'beginner' },
      { skillId: 'testing', level: 'beginner' },
    ]);
    const result = getNextAchievableSkills(profile);
    expect(result.map((s) => s.skillId)).toContain('ci-cd');
  });

  it('should handle a fully advanced profile with no achievable new foundation skills', () => {
    // Mark all foundation skills as advanced
    const foundationSkills = SKILL_PREREQUISITES.filter((s) => s.prerequisites.length === 0);
    const profile = makeProfile(
      foundationSkills.map(({ skillId }) => ({ skillId, level: 'advanced' as const }))
    );
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    for (const skill of foundationSkills) {
      expect(resultIds).not.toContain(skill.skillId);
    }
  });

  it('should return SkillNode objects with expected shape', () => {
    const profile = makeProfile([]);
    const result = getNextAchievableSkills(profile);

    expect(result.length).toBeGreaterThan(0);
    for (const node of result) {
      expect(node).toHaveProperty('skillId');
      expect(node).toHaveProperty('displayName');
      expect(node).toHaveProperty('prerequisites');
      expect(Array.isArray(node.prerequisites)).toBe(true);
    }
  });
});
