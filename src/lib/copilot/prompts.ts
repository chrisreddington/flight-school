/**
 * Copilot System Prompts
 *
 * Centralized system prompts for coach and focus sessions.
 * Uses terse, token-efficient rules format.
 */

import type { SkillProfile } from '@/lib/skills/types';

/**
 * System prompt for coach sessions with MCP tools.
 *
 * @remarks
 * Uses numbered rules for token efficiency.
 * Includes ZPD (Zone of Proximal Development) targeting.
 */
export const COACH_SYSTEM_PROMPT = `You are a developer growth coach.

RULES:
1. Analyze user profile (languages, repos, activity) before suggesting
2. Target Zone of Proximal Development: not too easy, not too hard
3. Suggest actionable, achievable challenges for 15-30 min sessions
4. Be encouraging and specific
5. NEVER suggest reimplementing what user already does well
6. Focus on gaps: missing skills, underused tools, growth areas

When generating personalized content:
- Consider user's primary languages and experience
- Reference specific repos when relevant
- Build on existing strengths to expand skills`;

/**
 * System prompt for lightweight coach sessions (no MCP).
 */
export const COACH_LIGHTWEIGHT_PROMPT = `You are a developer growth coach.

RULES:
1. Consider provided profile context for personalization
2. Target Zone of Proximal Development: not too easy, not too hard
3. Suggest actionable challenges for 15-30 min sessions
4. Be encouraging and specific
5. NEVER suggest reimplementing existing skills
6. Focus on gaps identified in profile`;

/**
 * System prompt for learning chat sessions.
 */
export const CHAT_SYSTEM_PROMPT = `You are a helpful developer assistant.

Be conversational, helpful, and concise. Mention GitHub tools only when asked.`;

/**
 * System prompt for GitHub-enabled chat sessions.
 */
export const GITHUB_CHAT_SYSTEM_PROMPT = `You are a helpful developer assistant with access to GitHub tools.

Be conversational, helpful, and concise. Reference specific repos when relevant.`;

/**
 * Builds a focus generation prompt with compact profile context.
 *
 * @param profileContext - Serialized compact profile (from serializeContext)
 * @param requestedComponents - Which components to generate
 * @param skillProfile - Optional user skill profile for calibration
 * @returns Full prompt for focus generation
 *
 * @remarks
 * When a skill profile is provided, additional sections are added:
 * - SK: skill levels in format `skillId:level` (e.g., `typescript:advanced`)
 * - EX: skills marked as not interested (exclude from suggestions)
 *
 * The key insight: if a user took time to configure a skill, that's a
 * STRONG SIGNAL of interest. Challenges/goals should prioritize these.
 *
 * @example
 * ```typescript
 * const prompt = buildFocusPrompt(profileContext, ['challenge'], {
 *   skills: [
 *     { skillId: 'typescript', level: 'advanced', source: 'manual' },
 *     { skillId: 'kubernetes', level: 'beginner', source: 'manual' },
 *     { skillId: 'docker', level: 'beginner', source: 'manual', notInterested: true }
 *   ],
 *   lastUpdated: '2026-01-21T10:00:00.000Z'
 * });
 * // Prompt includes: SK:typescript:advanced,kubernetes:beginner
 * // Prompt includes: EX:docker
 * ```
 */
/**
 * Builds a minimal challenge prompt.
 */
export function buildChallengePrompt(
  profileContext: string,
  skillProfile?: SkillProfile
): string {
  const skillSections = buildSkillProfileSections(skillProfile);
  return `Developer profile: ${profileContext}${skillSections}

Generate ONE coding challenge (15-30 min, ZPD-appropriate).
${skillProfile?.skills.length ? 'Prioritize SK: skills, exclude EX: skills.' : ''}

JSON only:
{"challenge":{"id":"","title":"","description":"","difficulty":"beginner|intermediate|advanced","language":"","estimatedTime":"","whyThisChallenge":[""]}}`;
}

/**
 * Builds a minimal goal prompt.
 */
export function buildGoalPrompt(
  profileContext: string,
  skillProfile?: SkillProfile
): string {
  const skillSections = buildSkillProfileSections(skillProfile);
  return `Developer profile: ${profileContext}${skillSections}

Generate ONE daily goal (20-30 min, completable TODAY).
Pattern: Fix X, Review N PRs, Add N tests, Refactor Y.

JSON only:
{"goal":{"id":"","title":"","description":"","progress":0,"target":"1 task","reasoning":""}}`;
}

/**
 * Builds a minimal learning topics prompt.
 */
export function buildLearningTopicsPrompt(
  profileContext: string,
  skillProfile?: SkillProfile
): string {
  const skillSections = buildSkillProfileSections(skillProfile);
  return `Developer profile: ${profileContext}${skillSections}

Generate THREE learning topics for growth areas.
${skillProfile?.skills.length ? 'Exclude EX: skills.' : ''}

JSON only:
{"learningTopics":[{"id":"","title":"","description":"","type":"concept|pattern|best-practice","relatedTo":""}]}`;
}

/**
 * Builds a prompt for generating a single replacement learning topic.
 */
export function buildSingleTopicPrompt(
  profileContext: string,
  existingTopicTitles: string[],
  skillProfile?: SkillProfile
): string {
  const skillSections = buildSkillProfileSections(skillProfile);
  const excludeList = existingTopicTitles.length > 0 
    ? `\nDo NOT suggest these topics (already shown): ${existingTopicTitles.join(', ')}`
    : '';
  
  return `Developer profile: ${profileContext}${skillSections}${excludeList}

Generate ONE learning topic for a growth area.
${skillProfile?.skills.length ? 'Exclude EX: skills.' : ''}

JSON only:
{"learningTopic":{"id":"","title":"","description":"","type":"concept|pattern|best-practice","relatedTo":""}}`;
}

/**
 * Builds a prompt for generating a single replacement challenge.
 */
export function buildSingleChallengePrompt(
  profileContext: string,
  existingChallengeTitles: string[],
  skillProfile?: SkillProfile
): string {
  const skillSections = buildSkillProfileSections(skillProfile);
  const excludeList = existingChallengeTitles.length > 0 
    ? `\nDo NOT suggest these challenges (already shown): ${existingChallengeTitles.join(', ')}`
    : '';
  
  return `Developer profile: ${profileContext}${skillSections}${excludeList}

Generate ONE coding challenge (15-30 min, ZPD-appropriate).
${skillProfile?.skills.length ? 'Prioritize SK: skills, exclude EX: skills.' : ''}

JSON only:
{"challenge":{"id":"","title":"","description":"","difficulty":"beginner|intermediate|advanced","language":"","estimatedTime":"","whyThisChallenge":[""]}}`;
}

/**
 * Builds a prompt for generating a single replacement goal.
 */
export function buildSingleGoalPrompt(
  profileContext: string,
  existingGoalTitles: string[],
  skillProfile?: SkillProfile
): string {
  const skillSections = buildSkillProfileSections(skillProfile);
  const excludeList = existingGoalTitles.length > 0 
    ? `\nDo NOT suggest these goals (already shown): ${existingGoalTitles.join(', ')}`
    : '';
  
  return `Developer profile: ${profileContext}${skillSections}${excludeList}

Generate ONE daily goal (20-30 min, completable TODAY).
Pattern: Fix X, Review N PRs, Add N tests, Refactor Y.

JSON only:
{"goal":{"id":"","title":"","description":"","progress":0,"target":"1 task","reasoning":""}}`;
}

/**
 * Builds SK: and EX: sections from a skill profile.
 *
 * @param skillProfile - User skill profile (optional)
 * @returns Formatted string with SK: and EX: lines, or empty string if no profile
 *
 * @remarks
 * - SK: User-configured skills with levels - prioritize these for challenges/goals
 * - EX: Excluded skills - user marked "not interested" (never suggest)
 *
 * The key insight: a user taking time to configure skills shows intent.
 * These are much stronger signals than auto-detected GitHub languages.
 */
function buildSkillProfileSections(skillProfile?: SkillProfile): string {
  if (!skillProfile || skillProfile.skills.length === 0) {
    return '';
  }

  const sections: string[] = [];

  // Build SK: section - skills with levels (excluding notInterested)
  // These are HIGH-PRIORITY because user took time to configure them
  const calibratedSkills = skillProfile.skills
    .filter((s) => !s.notInterested)
    .map((s) => `${s.skillId}:${s.level}`)
    .join(',');

  if (calibratedSkills) {
    sections.push(`SK:${calibratedSkills}`);
  }

  // Build EX: section - skills user is not interested in
  // These should NEVER appear in suggestions
  const excludedSkills = skillProfile.skills
    .filter((s) => s.notInterested === true)
    .map((s) => s.skillId)
    .join(',');

  if (excludedSkills) {
    sections.push(`EX:${excludedSkills}`);
  }

  return sections.length > 0 ? '\n' + sections.join('\n') : '';
}
