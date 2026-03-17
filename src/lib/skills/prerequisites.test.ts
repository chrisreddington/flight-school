/**
 * Tests for skill prerequisite logic.
 *
 * Covers getNextAchievableSkills based on Knowledge Space Theory.
 */

import { describe, expect, it } from 'vitest';
import type { SkillProfile } from '@/lib/skills/types';
import { getNextAchievableSkills } from './prerequisites';

/** Helper: build a minimal SkillProfile from a map of skillId → level. */
function makeProfile(skills: Record<string, 'beginner' | 'intermediate' | 'advanced'>): SkillProfile {
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
  it('should return foundation skills for an empty profile', () => {
    const result = getNextAchievableSkills({ skills: [], lastUpdated: '' });
    const ids = result.map((n) => n.skillId);
    // Foundation skills have no prerequisites
    expect(ids).toContain('javascript');
    expect(ids).toContain('html');
    expect(ids).toContain('python');
    expect(ids).toContain('sql');
    expect(ids).toContain('git');
  });

  it('should not return skills already at intermediate level', () => {
    const profile = makeProfile({ javascript: 'intermediate' });
    const result = getNextAchievableSkills(profile);
    const ids = result.map((n) => n.skillId);
    expect(ids).not.toContain('javascript');
  });

  it('should not return skills already at advanced level', () => {
    const profile = makeProfile({ javascript: 'advanced' });
    const result = getNextAchievableSkills(profile);
    const ids = result.map((n) => n.skillId);
    expect(ids).not.toContain('javascript');
  });

  it('should include skills at beginner level (still achievable)', () => {
    const profile = makeProfile({ javascript: 'beginner' });
    const result = getNextAchievableSkills(profile);
    const ids = result.map((n) => n.skillId);
    expect(ids).toContain('javascript');
  });

  it('should unlock typescript when javascript is present', () => {
    const profile = makeProfile({ javascript: 'beginner' });
    const result = getNextAchievableSkills(profile);
    const ids = result.map((n) => n.skillId);
    expect(ids).toContain('typescript');
  });

  it('should not unlock react when only one of three prereqs is met', () => {
    // react requires javascript, html, css
    const profile = makeProfile({ javascript: 'beginner' });
    const result = getNextAchievableSkills(profile);
    const ids = result.map((n) => n.skillId);
    expect(ids).not.toContain('react');
  });

  it('should unlock react when all prereqs (javascript, html, css) are present', () => {
    const profile = makeProfile({
      javascript: 'beginner',
      html: 'beginner',
      css: 'beginner',
    });
    const result = getNextAchievableSkills(profile);
    const ids = result.map((n) => n.skillId);
    expect(ids).toContain('react');
  });

  it('should not return nextjs until react AND typescript are present', () => {
    // Only typescript present
    const profile1 = makeProfile({ javascript: 'beginner', typescript: 'beginner' });
    const ids1 = getNextAchievableSkills(profile1).map((n) => n.skillId);
    expect(ids1).not.toContain('nextjs');

    // Both present
    const profile2 = makeProfile({
      javascript: 'beginner',
      html: 'beginner',
      css: 'beginner',
      typescript: 'beginner',
      react: 'beginner',
    });
    const ids2 = getNextAchievableSkills(profile2).map((n) => n.skillId);
    expect(ids2).toContain('nextjs');
  });

  it('should deduplicate and use the highest level when skill appears multiple times', () => {
    // Duplicate with beginner listed after intermediate — should treat as intermediate (excluded)
    const profile: SkillProfile = {
      skills: [
        { skillId: 'javascript', level: 'intermediate', source: 'github' },
        { skillId: 'javascript', level: 'beginner', source: 'manual' },
      ],
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };
    const result = getNextAchievableSkills(profile);
    const ids = result.map((n) => n.skillId);
    expect(ids).not.toContain('javascript');
  });

  it('should return SkillNode objects with the expected shape', () => {
    const profile = makeProfile({ javascript: 'beginner' });
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
