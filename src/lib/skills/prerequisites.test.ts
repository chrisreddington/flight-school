/**
 * Tests for skill prerequisites module.
 *
 * Covers getNextAchievableSkills and SKILL_PREREQUISITES data.
 */

import { describe, it, expect } from 'vitest';
import { getNextAchievableSkills, SKILL_PREREQUISITES } from './prerequisites';
import type { SkillProfile } from '@/lib/skills/types';

/** Build a minimal SkillProfile from a map of skillId → level. */
function makeProfile(
  skills: Record<string, 'beginner' | 'intermediate' | 'advanced'>
): SkillProfile {
  return {
    skills: Object.entries(skills).map(([skillId, level]) => ({
      skillId,
      level,
      source: 'manual' as const,
    })),
    lastUpdated: '2026-01-01T00:00:00.000Z',
  };
}

describe('getNextAchievableSkills', () => {
  it('should return only foundation skills (no prerequisites) for an empty profile', () => {
    const profile = makeProfile({});
    const result = getNextAchievableSkills(profile);
    const ids = result.map((s) => s.skillId);

    // Foundation skills with no prerequisites
    expect(ids).toContain('javascript');
    expect(ids).toContain('html');
    expect(ids).toContain('python');
    expect(ids).toContain('git');
    expect(ids).toContain('sql');

    // Skills that require prerequisites should NOT appear
    expect(ids).not.toContain('typescript'); // requires javascript
    expect(ids).not.toContain('react');      // requires javascript, html, css
    expect(ids).not.toContain('nextjs');     // requires react, typescript
  });

  it('should unlock css when html is present (at any level)', () => {
    const profile = makeProfile({ html: 'beginner' });
    const result = getNextAchievableSkills(profile);
    const ids = result.map((s) => s.skillId);
    expect(ids).toContain('css');
  });

  it('should unlock typescript and nodejs when javascript is present', () => {
    const profile = makeProfile({ javascript: 'beginner' });
    const result = getNextAchievableSkills(profile);
    const ids = result.map((s) => s.skillId);
    expect(ids).toContain('typescript');
    expect(ids).toContain('nodejs');
    expect(ids).toContain('testing');
  });

  it('should unlock react when javascript, html, and css are all present', () => {
    const profile = makeProfile({
      javascript: 'beginner',
      html: 'beginner',
      css: 'beginner',
    });
    const result = getNextAchievableSkills(profile);
    const ids = result.map((s) => s.skillId);
    expect(ids).toContain('react');
  });

  it('should NOT unlock react when only two of three prerequisites are present', () => {
    const profile = makeProfile({ javascript: 'beginner', html: 'beginner' });
    const result = getNextAchievableSkills(profile);
    const ids = result.map((s) => s.skillId);
    expect(ids).not.toContain('react'); // css is still missing
  });

  it('should exclude skills already at intermediate level', () => {
    const profile = makeProfile({ javascript: 'intermediate' });
    const result = getNextAchievableSkills(profile);
    const ids = result.map((s) => s.skillId);
    expect(ids).not.toContain('javascript');
  });

  it('should exclude skills already at advanced level', () => {
    const profile = makeProfile({ javascript: 'advanced' });
    const result = getNextAchievableSkills(profile);
    const ids = result.map((s) => s.skillId);
    expect(ids).not.toContain('javascript');
  });

  it('should include a skill still at beginner level even if prerequisites are met', () => {
    const profile = makeProfile({
      javascript: 'beginner',
      typescript: 'beginner',
      react: 'beginner',
    });
    const result = getNextAchievableSkills(profile);
    const ids = result.map((s) => s.skillId);
    // nextjs requires react + typescript — both present at beginner, nextjs is beginner so it's unlocked
    expect(ids).toContain('nextjs');
  });

  it('should unlock nextjs when react and typescript are present', () => {
    const profile = makeProfile({
      javascript: 'beginner',
      html: 'beginner',
      css: 'beginner',
      react: 'beginner',
      typescript: 'beginner',
    });
    const result = getNextAchievableSkills(profile);
    const ids = result.map((s) => s.skillId);
    expect(ids).toContain('nextjs');
  });

  it('should handle duplicate skills and use the highest level', () => {
    const profile: SkillProfile = {
      skills: [
        { skillId: 'javascript', level: 'beginner', source: 'github' },
        { skillId: 'javascript', level: 'advanced', source: 'manual' },
      ],
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };
    const result = getNextAchievableSkills(profile);
    const ids = result.map((s) => s.skillId);
    // javascript is at advanced — should NOT be in achievable list
    expect(ids).not.toContain('javascript');
    // typescript unlocked because javascript (highest = advanced) is present
    expect(ids).toContain('typescript');
  });

  it('should return an array of SkillNode objects with required fields', () => {
    const profile = makeProfile({});
    const result = getNextAchievableSkills(profile);
    for (const node of result) {
      expect(typeof node.skillId).toBe('string');
      expect(typeof node.displayName).toBe('string');
      expect(Array.isArray(node.prerequisites)).toBe(true);
    }
  });
});

describe('SKILL_PREREQUISITES', () => {
  it('should be a non-empty array', () => {
    expect(Array.isArray(SKILL_PREREQUISITES)).toBe(true);
    expect(SKILL_PREREQUISITES.length).toBeGreaterThan(0);
  });

  it('should have unique skillIds', () => {
    const ids = SKILL_PREREQUISITES.map((s) => s.skillId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('every prerequisite reference should point to a known skillId', () => {
    const knownIds = new Set(SKILL_PREREQUISITES.map((s) => s.skillId));
    for (const node of SKILL_PREREQUISITES) {
      for (const prereq of node.prerequisites) {
        expect(knownIds.has(prereq), `Unknown prereq '${prereq}' in '${node.skillId}'`).toBe(true);
      }
    }
  });
});
