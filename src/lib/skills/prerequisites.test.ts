import { describe, expect, it } from 'vitest';
import type { SkillProfile } from '@/lib/skills/types';
import { getNextAchievableSkills, SKILL_PREREQUISITES } from './prerequisites';

/** Helper to build a minimal SkillProfile. */
function makeProfile(skills: Array<{ skillId: string; level: 'beginner' | 'intermediate' | 'advanced' }>): SkillProfile {
  return {
    skills: skills.map((s) => ({ ...s, source: 'manual' as const })),
    lastUpdated: '2026-01-01T00:00:00.000Z',
  };
}

describe('getNextAchievableSkills', () => {
  it('should return all foundation skills (no prerequisites) for an empty profile', () => {
    const profile = makeProfile([]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    // All nodes with no prerequisites should be achievable
    const foundationIds = SKILL_PREREQUISITES.filter((n) => n.prerequisites.length === 0).map((n) => n.skillId);
    for (const id of foundationIds) {
      expect(resultIds).toContain(id);
    }
  });

  it('should not return skills that have unmet prerequisites', () => {
    const profile = makeProfile([]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    // nextjs requires react + typescript, neither of which is in the empty profile
    expect(resultIds).not.toContain('nextjs');
    // react requires javascript, html, css
    expect(resultIds).not.toContain('react');
  });

  it('should unlock skills when their prerequisites are met at beginner level', () => {
    // typescript requires javascript
    const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).toContain('typescript');
  });

  it('should not include skills already at intermediate level in results', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'intermediate' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    // javascript is already intermediate, so it should NOT be suggested
    expect(resultIds).not.toContain('javascript');
  });

  it('should not include skills already at advanced level in results', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'advanced' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).not.toContain('javascript');
  });

  it('should include skills at beginner level since they are below the intermediate threshold', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    // javascript is beginner — below threshold — so it CAN appear
    expect(resultIds).toContain('javascript');
  });

  it('should unlock nextjs when both react and typescript prerequisites are met', () => {
    const profile = makeProfile([
      { skillId: 'javascript', level: 'beginner' },
      { skillId: 'html', level: 'beginner' },
      { skillId: 'css', level: 'beginner' },
      { skillId: 'react', level: 'beginner' },
      { skillId: 'typescript', level: 'beginner' },
    ]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).toContain('nextjs');
  });

  it('should not unlock nextjs when only one of its prerequisites is met', () => {
    // only typescript, react is missing
    const profile = makeProfile([
      { skillId: 'javascript', level: 'beginner' },
      { skillId: 'typescript', level: 'beginner' },
    ]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).not.toContain('nextjs');
  });

  it('should unlock ci-cd only when both git and testing prerequisites are met', () => {
    const profile = makeProfile([
      { skillId: 'git', level: 'beginner' },
      { skillId: 'javascript', level: 'beginner' },
      { skillId: 'testing', level: 'beginner' },
    ]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    expect(resultIds).toContain('ci-cd');
  });

  it('should keep the highest level when the same skill appears multiple times in profile', () => {
    // Provide javascript twice: once beginner, once advanced — the advanced entry should win
    const profile: SkillProfile = {
      skills: [
        { skillId: 'javascript', level: 'beginner', source: 'github' },
        { skillId: 'javascript', level: 'advanced', source: 'manual' },
      ],
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);

    // advanced takes precedence — javascript should be excluded (already advanced)
    expect(resultIds).not.toContain('javascript');
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
