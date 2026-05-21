import { describe, it, expect } from 'vitest';
import { getNextAchievableSkills, SKILL_PREREQUISITES } from './prerequisites';
import type { SkillProfile } from './types';

function makeProfile(skills: Array<{ skillId: string; level: 'beginner' | 'intermediate' | 'advanced' }>): SkillProfile {
  return {
    skills: skills.map((s) => ({ ...s, source: 'manual' as const })),
    lastUpdated: new Date().toISOString(),
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

  it('does not include skills whose prerequisites are not met', () => {
    // typescript requires javascript — profile has no javascript
    const profile = makeProfile([]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);
    expect(resultIds).not.toContain('typescript');
  });

  it('includes a skill once its prerequisites are met', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);
    expect(resultIds).toContain('typescript');
    expect(resultIds).toContain('nodejs');
    expect(resultIds).toContain('testing');
  });

  it('excludes skills already at intermediate or above', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'intermediate' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);
    // javascript at intermediate — should not be suggested
    expect(resultIds).not.toContain('javascript');
  });

  it('still shows a skill if user is only at beginner level (not intermediate+)', () => {
    const profile = makeProfile([{ skillId: 'javascript', level: 'beginner' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);
    // javascript beginner — still recommended
    expect(resultIds).toContain('javascript');
  });

  it('excludes skills already at advanced', () => {
    const profile = makeProfile([{ skillId: 'python', level: 'advanced' }]);
    const result = getNextAchievableSkills(profile);
    const resultIds = result.map((s) => s.skillId);
    expect(resultIds).not.toContain('python');
  });

  it('unlocks react only when all three prerequisites (javascript, html, css) are present', () => {
    // Missing css
    const partialProfile = makeProfile([
      { skillId: 'javascript', level: 'beginner' },
      { skillId: 'html', level: 'beginner' },
    ]);
    const partial = getNextAchievableSkills(partialProfile);
    expect(partial.map((s) => s.skillId)).not.toContain('react');

    // All prerequisites met
    const fullProfile = makeProfile([
      { skillId: 'javascript', level: 'beginner' },
      { skillId: 'html', level: 'beginner' },
      { skillId: 'css', level: 'beginner' },
    ]);
    const full = getNextAchievableSkills(fullProfile);
    expect(full.map((s) => s.skillId)).toContain('react');
  });

  it('unlocks nextjs only when react and typescript are present', () => {
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

  it('handles duplicate skills by using the highest level', () => {
    // If javascript appears twice, the highest level should win
    const profile: SkillProfile = {
      skills: [
        { skillId: 'javascript', level: 'beginner', source: 'manual' },
        { skillId: 'javascript', level: 'intermediate', source: 'github' },
      ],
      lastUpdated: new Date().toISOString(),
    };
    const result = getNextAchievableSkills(profile);
    // intermediate level → should be excluded
    expect(result.map((s) => s.skillId)).not.toContain('javascript');
    // prerequisites are met for typescript
    expect(result.map((s) => s.skillId)).toContain('typescript');
  });

  it('returns SkillNode objects with correct shape', () => {
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

  it('unlocks ci-cd only when both git and testing prerequisites are present', () => {
    const profile = makeProfile([
      { skillId: 'git', level: 'beginner' },
      // testing NOT present
    ]);
    const partial = getNextAchievableSkills(profile);
    expect(partial.map((s) => s.skillId)).not.toContain('ci-cd');

    const fullProfile = makeProfile([
      { skillId: 'git', level: 'beginner' },
      { skillId: 'javascript', level: 'beginner' },
      { skillId: 'testing', level: 'beginner' },
    ]);
    const full = getNextAchievableSkills(fullProfile);
    expect(full.map((s) => s.skillId)).toContain('ci-cd');
  });
});
