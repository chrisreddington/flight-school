import { describe, expect, it } from 'vitest';
import type { SkillProfile } from '@/lib/skills/types';
import { getNextAchievableSkills, SKILL_PREREQUISITES } from './prerequisites';

function makeProfile(skills: { skillId: string; level: 'beginner' | 'intermediate' | 'advanced' }[]): SkillProfile {
  return {
    skills: skills.map((s) => ({ ...s, source: 'manual' as const })),
    lastUpdated: '2026-01-01T00:00:00.000Z',
  };
}

describe('getNextAchievableSkills', () => {
  it('returns all foundation skills (no prerequisites) for an empty profile', () => {
    const result = getNextAchievableSkills(makeProfile([]));
    const foundationIds = SKILL_PREREQUISITES.filter((n) => n.prerequisites.length === 0).map((n) => n.skillId);
    const resultIds = result.map((n) => n.skillId);
    for (const id of foundationIds) {
      expect(resultIds).toContain(id);
    }
  });

  it('does not return a skill when all its prerequisites are missing', () => {
    const result = getNextAchievableSkills(makeProfile([]));
    const resultIds = result.map((n) => n.skillId);
    // react requires javascript, html, and css — none present
    expect(resultIds).not.toContain('react');
  });

  it('returns a skill once its single prerequisite is present at any level', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((n) => n.skillId);
    expect(resultIds).toContain('typescript');
  });

  it('requires ALL prerequisites for a multi-prereq skill (nextjs needs react + typescript)', () => {
    // Only react present — nextjs should NOT appear
    const partial = makeProfile([
      { skillId: 'react', level: 'beginner' },
    ]);
    expect(getNextAchievableSkills(partial).map((n) => n.skillId)).not.toContain('nextjs');

    // Both react and typescript present — nextjs SHOULD appear
    const full = makeProfile([
      { skillId: 'react', level: 'beginner' },
      { skillId: 'typescript', level: 'beginner' },
    ]);
    expect(getNextAchievableSkills(full).map((n) => n.skillId)).toContain('nextjs');
  });

  it('excludes skills already at intermediate level from results', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'intermediate' }]);
    const resultIds = getNextAchievableSkills(profile).map((n) => n.skillId);
    expect(resultIds).not.toContain('javascript');
  });

  it('excludes skills already at advanced level from results', () => {
    const profile = makeProfile([{ skillId: 'python', level: 'advanced' }]);
    const resultIds = getNextAchievableSkills(profile).map((n) => n.skillId);
    expect(resultIds).not.toContain('python');
  });

  it('includes skills at beginner level (they are still achievable)', () => {
    // A skill at beginner level is still "achievable" (can advance further)
    // and should appear in the result if prerequisites are met
    const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
    const resultIds = getNextAchievableSkills(profile).map((n) => n.skillId);
    // javascript is at beginner — still achievable — should appear
    expect(resultIds).toContain('javascript');
  });

  it('uses the highest skill level when a skill appears multiple times in the profile', () => {
    // Duplicate entries: one beginner, one intermediate — should deduplicate to intermediate
    const profile: SkillProfile = {
      skills: [
        { skillId: 'javascript', level: 'beginner', source: 'manual' },
        { skillId: 'javascript', level: 'intermediate', source: 'github' },
      ],
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };
    const resultIds = getNextAchievableSkills(profile).map((n) => n.skillId);
    // intermediate → should be excluded from achievable list
    expect(resultIds).not.toContain('javascript');
  });

  it('returns SkillNode objects with the expected shape', () => {
    const result = getNextAchievableSkills(makeProfile([]));
    expect(result.length).toBeGreaterThan(0);
    for (const node of result) {
      expect(node).toHaveProperty('skillId');
      expect(node).toHaveProperty('displayName');
      expect(node).toHaveProperty('prerequisites');
      expect(Array.isArray(node.prerequisites)).toBe(true);
    }
  });

  it('requires ci-cd prerequisites: git AND testing must both be present', () => {
    const onlyGit = makeProfile([{ skillId: 'git', level: 'beginner' }]);
    expect(getNextAchievableSkills(onlyGit).map((n) => n.skillId)).not.toContain('ci-cd');

    const bothMet = makeProfile([
      { skillId: 'git', level: 'beginner' },
      { skillId: 'testing', level: 'beginner' },
    ]);
    expect(getNextAchievableSkills(bothMet).map((n) => n.skillId)).toContain('ci-cd');
  });
});
