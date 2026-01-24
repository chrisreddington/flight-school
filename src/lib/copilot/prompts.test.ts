/**
 * Tests for Copilot prompts module
 */

import { describe, it, expect } from 'vitest';
import {
  COACH_SYSTEM_PROMPT,
  COACH_LIGHTWEIGHT_PROMPT,
  CHAT_SYSTEM_PROMPT,
  GITHUB_CHAT_SYSTEM_PROMPT,
  buildChallengePrompt,
  buildGoalPrompt,
  buildLearningTopicsPrompt,
  buildSingleTopicPrompt,
} from './prompts';
import type { SkillProfile } from '@/lib/skills/types';

// =============================================================================
// Constants Tests
// =============================================================================

describe('System Prompts', () => {
  it('should have COACH_SYSTEM_PROMPT defined', () => {
    expect(COACH_SYSTEM_PROMPT).toBeDefined();
    expect(COACH_SYSTEM_PROMPT).toContain('developer growth coach');
    expect(COACH_SYSTEM_PROMPT).toContain('Zone of Proximal Development');
  });

  it('should have COACH_LIGHTWEIGHT_PROMPT defined', () => {
    expect(COACH_LIGHTWEIGHT_PROMPT).toBeDefined();
    expect(COACH_LIGHTWEIGHT_PROMPT).toContain('developer growth coach');
  });

  it('should have CHAT_SYSTEM_PROMPT defined', () => {
    expect(CHAT_SYSTEM_PROMPT).toBeDefined();
    expect(CHAT_SYSTEM_PROMPT).toContain('developer assistant');
  });

  it('should have GITHUB_CHAT_SYSTEM_PROMPT defined', () => {
    expect(GITHUB_CHAT_SYSTEM_PROMPT).toBeDefined();
    expect(GITHUB_CHAT_SYSTEM_PROMPT).toContain('GitHub tools');
  });
});

// =============================================================================
// buildChallengePrompt Tests
// =============================================================================

describe('buildChallengePrompt', () => {
  const profileContext = 'Languages: TypeScript, Python | Repos: 5';

  it('should include profile context in prompt', () => {
    const prompt = buildChallengePrompt(profileContext);
    expect(prompt).toContain(profileContext);
  });

  it('should request JSON output format', () => {
    const prompt = buildChallengePrompt(profileContext);
    expect(prompt).toContain('JSON only');
    expect(prompt).toContain('"challenge"');
  });

  it('should include required challenge fields in schema', () => {
    const prompt = buildChallengePrompt(profileContext);
    expect(prompt).toContain('"id"');
    expect(prompt).toContain('"title"');
    expect(prompt).toContain('"description"');
    expect(prompt).toContain('"difficulty"');
    expect(prompt).toContain('"language"');
    expect(prompt).toContain('"estimatedTime"');
    expect(prompt).toContain('"whyThisChallenge"');
  });

  it('should specify time constraint (15-30 min)', () => {
    const prompt = buildChallengePrompt(profileContext);
    expect(prompt).toContain('15-30 min');
  });

  describe('with skill profile', () => {
    const skillProfile: SkillProfile = {
      skills: [
        { skillId: 'typescript', level: 'advanced', source: 'manual' },
        { skillId: 'kubernetes', level: 'beginner', source: 'manual' },
        { skillId: 'docker', level: 'beginner', source: 'manual', notInterested: true },
      ],
      lastUpdated: '2026-01-21T10:00:00.000Z',
    };

    it('should include SK: section for calibrated skills', () => {
      const prompt = buildChallengePrompt(profileContext, skillProfile);
      expect(prompt).toContain('SK:typescript:advanced,kubernetes:beginner');
    });

    it('should include EX: section for excluded skills', () => {
      const prompt = buildChallengePrompt(profileContext, skillProfile);
      expect(prompt).toContain('EX:docker');
    });

    it('should add prioritization instructions when skills present', () => {
      const prompt = buildChallengePrompt(profileContext, skillProfile);
      expect(prompt).toContain('Prioritize SK: skills, exclude EX: skills');
    });

    it('should not include skill sections when profile is empty', () => {
      const emptyProfile: SkillProfile = { skills: [], lastUpdated: '' };
      const prompt = buildChallengePrompt(profileContext, emptyProfile);
      expect(prompt).not.toContain('SK:');
      expect(prompt).not.toContain('EX:');
    });
  });
});

// =============================================================================
// buildGoalPrompt Tests
// =============================================================================

describe('buildGoalPrompt', () => {
  const profileContext = 'Languages: TypeScript | Repos: 3';

  it('should include profile context in prompt', () => {
    const prompt = buildGoalPrompt(profileContext);
    expect(prompt).toContain(profileContext);
  });

  it('should request JSON output format', () => {
    const prompt = buildGoalPrompt(profileContext);
    expect(prompt).toContain('JSON only');
    expect(prompt).toContain('"goal"');
  });

  it('should include required goal fields in schema', () => {
    const prompt = buildGoalPrompt(profileContext);
    expect(prompt).toContain('"id"');
    expect(prompt).toContain('"title"');
    expect(prompt).toContain('"description"');
    expect(prompt).toContain('"progress"');
    expect(prompt).toContain('"target"');
    expect(prompt).toContain('"reasoning"');
  });

  it('should specify time constraint (20-30 min)', () => {
    const prompt = buildGoalPrompt(profileContext);
    expect(prompt).toContain('20-30 min');
  });

  it('should suggest goal patterns', () => {
    const prompt = buildGoalPrompt(profileContext);
    expect(prompt).toContain('Fix X');
    expect(prompt).toContain('Review N PRs');
  });

  describe('with skill profile', () => {
    const skillProfile: SkillProfile = {
      skills: [{ skillId: 'react', level: 'intermediate', source: 'manual' }],
      lastUpdated: '2026-01-21T10:00:00.000Z',
    };

    it('should include SK: section', () => {
      const prompt = buildGoalPrompt(profileContext, skillProfile);
      expect(prompt).toContain('SK:react:intermediate');
    });
  });
});

// =============================================================================
// buildLearningTopicsPrompt Tests
// =============================================================================

describe('buildLearningTopicsPrompt', () => {
  const profileContext = 'Languages: Python | Repos: 2';

  it('should include profile context in prompt', () => {
    const prompt = buildLearningTopicsPrompt(profileContext);
    expect(prompt).toContain(profileContext);
  });

  it('should request JSON output format', () => {
    const prompt = buildLearningTopicsPrompt(profileContext);
    expect(prompt).toContain('JSON only');
    expect(prompt).toContain('"learningTopics"');
  });

  it('should include required topic fields in schema', () => {
    const prompt = buildLearningTopicsPrompt(profileContext);
    expect(prompt).toContain('"id"');
    expect(prompt).toContain('"title"');
    expect(prompt).toContain('"description"');
    expect(prompt).toContain('"type"');
    expect(prompt).toContain('"relatedTo"');
  });

  it('should specify topic types', () => {
    const prompt = buildLearningTopicsPrompt(profileContext);
    expect(prompt).toContain('concept|pattern|best-practice');
  });

  it('should request THREE topics', () => {
    const prompt = buildLearningTopicsPrompt(profileContext);
    expect(prompt).toContain('THREE');
  });

  describe('with skill profile', () => {
    const skillProfile: SkillProfile = {
      skills: [
        { skillId: 'java', level: 'advanced', source: 'manual' },
        { skillId: 'sql', level: 'beginner', source: 'manual', notInterested: true },
      ],
      lastUpdated: '2026-01-21T10:00:00.000Z',
    };

    it('should include EX: section for excluded skills', () => {
      const prompt = buildLearningTopicsPrompt(profileContext, skillProfile);
      expect(prompt).toContain('EX:sql');
    });

    it('should add exclusion instructions when skills present', () => {
      const prompt = buildLearningTopicsPrompt(profileContext, skillProfile);
      expect(prompt).toContain('Exclude EX: skills');
    });
  });
});

// =============================================================================
// buildSingleTopicPrompt Tests
// =============================================================================

describe('buildSingleTopicPrompt', () => {
  const profileContext = 'typescript,react,node';

  it('should request ONE topic', () => {
    const prompt = buildSingleTopicPrompt(profileContext, []);
    expect(prompt).toContain('ONE');
    expect(prompt).toContain('learningTopic');
  });

  it('should include existing topic titles to avoid duplicates', () => {
    const existingTitles = ['React Hooks', 'TypeScript Generics'];
    const prompt = buildSingleTopicPrompt(profileContext, existingTitles);
    expect(prompt).toContain('Do NOT suggest these topics');
    expect(prompt).toContain('React Hooks');
    expect(prompt).toContain('TypeScript Generics');
  });

  it('should not include exclusion notice when no existing titles', () => {
    const prompt = buildSingleTopicPrompt(profileContext, []);
    expect(prompt).not.toContain('Do NOT suggest these topics');
  });

  it('should include JSON format for single topic', () => {
    const prompt = buildSingleTopicPrompt(profileContext, []);
    expect(prompt).toContain('"learningTopic"');
    expect(prompt).toContain('"title"');
    expect(prompt).toContain('"type"');
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('Edge Cases', () => {
  it('should handle undefined skill profile', () => {
    const prompt = buildChallengePrompt('context', undefined);
    expect(prompt).not.toContain('SK:');
    expect(prompt).not.toContain('EX:');
  });

  it('should handle skills with only notInterested entries', () => {
    const profile: SkillProfile = {
      skills: [
        { skillId: 'cobol', level: 'beginner', source: 'manual', notInterested: true },
      ],
      lastUpdated: '2026-01-21T10:00:00.000Z',
    };
    const prompt = buildChallengePrompt('context', profile);
    // Should not have SK: line when all skills are excluded
    expect(prompt).not.toMatch(/^SK:/m);
    expect(prompt).toContain('EX:cobol');
  });

  it('should handle skills with only active entries (no exclusions)', () => {
    const profile: SkillProfile = {
      skills: [{ skillId: 'rust', level: 'beginner', source: 'manual' }],
      lastUpdated: '2026-01-21T10:00:00.000Z',
    };
    const prompt = buildChallengePrompt('context', profile);
    expect(prompt).toContain('SK:rust:beginner');
    // Should not have EX: line when no exclusions
    expect(prompt).not.toMatch(/^EX:/m);
  });
});
