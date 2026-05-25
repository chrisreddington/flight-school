/**
 * Copilot System Prompts
 *
 * Centralized system prompts for coach and focus sessions.
 * Uses terse, token-efficient rules format.
 */

import type { SkillProfile } from '@/lib/skills/types';
import type { InterleavingHint } from '@/lib/focus/interleaving';

/**
 * Capability-neutral base prompt for the coach profile.
 *
 * Voice and rules only. Capability-specific guidance (e.g. "use
 * `list_user_repositories` to ground suggestions") lives on the active
 * capability addendum — see {@link COACH_GITHUB_PROMPT_ADDENDUM} — and
 * is composed in by `resolveProfile` when the caller passes
 * `capabilities: ['github']`. The lightweight coach is the same voice
 * with `capabilities: []`; there is no separate prompt.
 */
export const COACH_BASE_PROMPT = `You are a developer growth coach.

RULES:
1. Target Zone of Proximal Development: not too easy, not too hard
2. Suggest actionable, achievable challenges for 15-30 min sessions
3. Growth mindset framing: celebrate effort and strategy, not just outcomes
4. NEVER suggest reimplementing what user already does well
5. Focus on gaps: missing skills, underused tools, growth areas
6. Use "not yet" framing: "you haven't explored X yet" not "you're missing X"`;

/**
 * Capability-neutral base prompt for general chat surfaces.
 *
 * Voice and tone only — capability-specific instructions (e.g. "use the
 * GitHub MCP tools") live on the capability `promptAddendum` in
 * `./capabilities` and are composed in by `resolveProfile`.
 */
export const CHAT_BASE_PROMPT = `You are a helpful developer assistant.

Be conversational, helpful, and concise.`;

/**
 * Capability-neutral base prompt for learning chat surfaces.
 *
 * See {@link CHAT_BASE_PROMPT} for the composition contract.
 */
export const LEARNING_LENS_PROMPT = `You are a developer learning companion.

When responding:
1. Explain your reasoning step-by-step
2. Suggest 2-3 follow-up questions or experiments
3. Reference the user's code when relevant
4. Be conversational but focused

If user wants a quick answer, skip the explanations.`;

/**
 * Coach-scoped GitHub MCP addendum. The coach profile restricts the
 * github capability's tool surface to `get_me` + `list_user_repositories`
 * (see `profiles.ts` `capabilityDefaults`), so the general addendum
 * (which mentions `search_code` / `get_file_contents`) would lie about
 * available tools. This addendum mentions only the two tools coach
 * actually exposes.
 */
export const COACH_GITHUB_PROMPT_ADDENDUM = `You have access to two GitHub MCP tools: \
\`get_me\` (the authenticated user's profile) and \`list_user_repositories\` \
(repos the user owns or collaborates on). Use them to ground suggestions in \
real profile data; do not attempt to read file contents or search code.`;

/**
 * Builds a minimal challenge prompt.
 */
export function buildChallengePrompt(
  profileContext: string,
  skillProfile?: SkillProfile,
  interleavingHint?: InterleavingHint,
  options?: { forceDebug?: boolean },
): string {
  const skillSections = buildSkillProfileSections(skillProfile);
  const interleavingSection = buildInterleavingSection(interleavingHint);
  const issueContextNote = profileContext.includes('issues:[')
    ? '\nConsider drawing inspiration from the developer\'s open issues when relevant.\nKeep it authentic and practical to their current work context.\nSet contextSource to "issue" when challenge is inspired by open issues, "skills" when driven by skill gaps, "activity" otherwise.'
    : '';
  const challengeTypeInstruction = options?.forceDebug
    ? 'REQUIRED: Generate a debug challenge. Set type: "debug", include brokenCode with 1-3 intentional bugs, and describe what bugs to find in the description.'
    : 'Optionally, if appropriate for the developer\'s skill level, you may generate a debug challenge.\nFor debug challenges, set type: "debug", include brokenCode with 1-3 intentional bugs, and mention bugs to find.\nOtherwise use type: "implement".';
  return `Developer profile: ${profileContext}${skillSections}${interleavingSection}

Generate ONE coding challenge (15-30 min, ZPD-appropriate).
${skillProfile?.skills.length ? 'Prioritize SK: skills, exclude EX: skills.' : ''}
${issueContextNote}
${challengeTypeInstruction}

JSON only:
{"challenge":{"id":"","title":"","description":"","type":"implement|debug","brokenCode":"","contextSource":"activity|issue|skills","difficulty":"beginner|intermediate|advanced","language":"","estimatedTime":"","whyThisChallenge":[""]}}`;
}

/**
 * Builds a minimal goal prompt.
 */
export function buildGoalPrompt(profileContext: string, skillProfile?: SkillProfile): string {
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
  skillProfile?: SkillProfile,
  reviewTopics?: string[],
): string {
  const skillSections = buildSkillProfileSections(skillProfile);
  const reviewSection =
    reviewTopics && reviewTopics.length > 0
      ? `\nRT:${reviewTopics.join(',')}` // RT = Review Topics (spaced repetition candidates)
      : '';
  return `Developer profile: ${profileContext}${skillSections}${reviewSection}

Generate THREE learning topics for growth areas.
${skillProfile?.skills.length ? 'Exclude EX: skills.' : ''}
${reviewTopics?.length ? 'PRIORITIZE any RT: topics (spaced repetition — learner explored them before and needs review).' : ''}

JSON only:
{"learningTopics":[{"id":"","title":"","description":"","type":"concept|pattern|best-practice","relatedTo":""}]}`;
}

/**
 * Builds a prompt for generating a single replacement learning topic.
 */
export function buildSingleTopicPrompt(
  profileContext: string,
  existingTopicTitles: string[],
  skillProfile?: SkillProfile,
): string {
  const skillSections = buildSkillProfileSections(skillProfile);
  const excludeList =
    existingTopicTitles.length > 0
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
  skillProfile?: SkillProfile,
  interleavingHint?: InterleavingHint,
): string {
  const skillSections = buildSkillProfileSections(skillProfile);
  const interleavingSection = buildInterleavingSection(interleavingHint);
  const excludeList =
    existingChallengeTitles.length > 0
      ? `\nDo NOT suggest these challenges (already shown): ${existingChallengeTitles.join(', ')}`
      : '';

  return `Developer profile: ${profileContext}${skillSections}${interleavingSection}${excludeList}

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
  skillProfile?: SkillProfile,
): string {
  const skillSections = buildSkillProfileSections(skillProfile);
  const excludeList =
    existingGoalTitles.length > 0
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

function buildInterleavingSection(interleavingHint?: InterleavingHint): string {
  if (!interleavingHint) {
    return '';
  }

  return `\nIX:${interleavingHint.day}|${interleavingHint.label}`;
}
