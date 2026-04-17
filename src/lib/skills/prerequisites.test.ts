/**
 * Tests for skill prerequisite logic.
 */
import { describe, expect, it } from 'vitest';

import type { SkillLevel, SkillProfile } from '@/lib/skills/types';
import { getNextAchievableSkills } from './prerequisites';

/** Build a minimal SkillProfile for tests. */
function profile(
  skills: Array<{ skillId: string; level: SkillLevel }>,
): SkillProfile {
  return {
    skills: skills.map((s) => ({ ...s, source: 'github' as const })),
    lastUpdated: '2026-01-01T00:00:00.000Z',
  };
}

describe('getNextAchievableSkills', () => {
  it('should return all foundation skills for an empty profile', () => {
    const result = getNextAchievableSkills(profile([]));
    const ids = result.map((n) => n.skillId);

    // Foundation skills have no prerequisites and should always appear.
    expect(ids).toContain('javascript');
    expect(ids).toContain('python');
    expect(ids).toContain('html');
    expect(ids).toContain('sql');
    expect(ids).toContain('git');
  });

  it('should not return skills that are already at intermediate level', () => {
    const result = getNextAchievableSkills(
      profile([{ skillId: 'javascript', level: 'intermediate' }]),
    );
    expect(result.map((n) => n.skillId)).not.toContain('javascript');
  });

  it('should not return skills that are already at advanced level', () => {
    const result = getNextAchievableSkills(
      profile([{ skillId: 'git', level: 'advanced' }]),
    );
    expect(result.map((n) => n.skillId)).not.toContain('git');
  });

  it('should include a skill still at beginner level (prerequisites satisfied)', () => {
    // javascript at beginner level satisfies the typescript prerequisite,
    // and javascript itself is still below intermediate so it appears too.
    const result = getNextAchievableSkills(
      profile([{ skillId: 'javascript', level: 'beginner' }]),
    );
    const ids = result.map((n) => n.skillId);
    expect(ids).toContain('javascript');
    expect(ids).toContain('typescript');
  });

  it('should not return skills with unsatisfied prerequisites', () => {
    const result = getNextAchievableSkills(profile([]));
    const ids = result.map((n) => n.skillId);
    // typescript requires javascript — not in empty profile.
    expect(ids).not.toContain('typescript');
    // nextjs requires react + typescript.
    expect(ids).not.toContain('nextjs');
  });

  it('should require ALL prerequisites for multi-prerequisite skills', () => {
    // nextjs requires both react AND typescript.
    const withOnlyReact = getNextAchievableSkills(
      profile([{ skillId: 'react', level: 'intermediate' }]),
    );
    expect(withOnlyReact.map((n) => n.skillId)).not.toContain('nextjs');

    const withBoth = getNextAchievableSkills(
      profile([
        { skillId: 'react', level: 'intermediate' },
        { skillId: 'typescript', level: 'intermediate' },
      ]),
    );
    expect(withBoth.map((n) => n.skillId)).toContain('nextjs');
  });

  it('should resolve duplicate skill entries by keeping the highest level', () => {
    // javascript appears at beginner then intermediate — should be treated as intermediate.
    const result = getNextAchievableSkills(
      profile([
        { skillId: 'javascript', level: 'beginner' },
        { skillId: 'javascript', level: 'intermediate' },
      ]),
    );
    // At intermediate, javascript itself is excluded from next-achievable.
    expect(result.map((n) => n.skillId)).not.toContain('javascript');
    // But typescript should be available because javascript is in the profile.
    expect(result.map((n) => n.skillId)).toContain('typescript');
  });

  it('should return nodes with the expected shape', () => {
    const result = getNextAchievableSkills(profile([]));
    const jsNode = result.find((n) => n.skillId === 'javascript');

    expect(jsNode).toBeDefined();
    expect(jsNode?.skillId).toBe('javascript');
    expect(jsNode?.displayName).toBe('JavaScript');
    expect(Array.isArray(jsNode?.prerequisites)).toBe(true);
    expect(jsNode?.prerequisites).toHaveLength(0);
  });
});
