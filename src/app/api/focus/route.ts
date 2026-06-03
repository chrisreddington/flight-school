/**
 * Focus API Route
 * GET/POST /api/focus
 *
 * Generates personalised daily focus components via the Copilot SDK.
 * All heavy lifting (prompt selection, parallel fan-out, fallback
 * shape) lives in `@/lib/focus/handlers` — this file is just guards,
 * request parsing, and `NextResponse.json`.
 */

import { parseJsonBodyWithFallback } from '@/lib/api';
import { writeUserChallengeSpec } from '@/lib/challenge/spec-storage';
import { createSessionIdentity } from '@/lib/copilot/session-identity';
import type { InterleavingHint } from '@/lib/focus/interleaving';
import { generateFocus, type FocusComponent } from '@/lib/focus/handlers';
import type { FocusResponse } from '@/lib/focus/types';
import { logger } from '@/lib/logger';
import { withGuardedRoute } from '@/lib/security/guard';
import { FOCUS_GUARD } from '@/lib/security/route-defaults';
import { readUserSkillsProfile } from '@/lib/skills/server';
import type { SkillProfile } from '@/lib/skills/types';
import { NextRequest, NextResponse } from 'next/server';

const log = logger.withTag('Focus API Route');
const MAX_EXISTING_TITLES = 50;
const MAX_EXISTING_TITLE_LENGTH = 200;

type FocusPostBody = {
  component?: FocusComponent;
  skillProfile?: SkillProfile;
  existingTopicTitles?: string[];
  existingChallengeTitles?: string[];
  reviewTopics?: string[];
  interleavingHint?: InterleavingHint;
  debugMode?: boolean;
};

function parseIsoTimestampMs(rawTimestamp: string | undefined): number {
  if (!rawTimestamp) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(rawTimestamp);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function hasSkills(skillProfile: SkillProfile | undefined): skillProfile is SkillProfile {
  return Boolean(skillProfile && Array.isArray(skillProfile.skills) && skillProfile.skills.length > 0);
}

function chooseNewestSkillProfile({
  clientProfile,
  serverProfile,
}: {
  clientProfile: SkillProfile | undefined;
  serverProfile: SkillProfile | undefined;
}): SkillProfile | undefined {
  if (!hasSkills(clientProfile)) return serverProfile;
  if (!serverProfile) return clientProfile;

  const clientUpdatedAtMs = parseIsoTimestampMs(clientProfile.lastUpdated);
  const serverUpdatedAtMs = parseIsoTimestampMs(serverProfile.lastUpdated);

  if (clientUpdatedAtMs >= serverUpdatedAtMs) {
    return clientProfile;
  }

  return serverProfile;
}

function validateExistingTitles(titles: unknown, fieldName: string): string | null {
  if (titles === undefined) return null;
  if (!Array.isArray(titles)) return `${fieldName} must be an array of strings`;
  if (titles.length > MAX_EXISTING_TITLES) {
    return `${fieldName} cannot contain more than ${MAX_EXISTING_TITLES} items`;
  }

  for (const title of titles) {
    if (typeof title !== 'string') return `${fieldName} must be an array of strings`;
    if (title.length > MAX_EXISTING_TITLE_LENGTH) {
      return `${fieldName} items cannot exceed ${MAX_EXISTING_TITLE_LENGTH} characters`;
    }
  }

  return null;
}

function stampSkillProfileTimestamp(
  result: Partial<FocusResponse> | { learningTopic: unknown },
  skillProfile: SkillProfile | undefined,
): void {
  if (!('meta' in result) || !result.meta || typeof result.meta !== 'object') return;
  if (result.meta.skillProfileLastUpdated) return;
  if (!skillProfile?.lastUpdated) return;
  result.meta.skillProfileLastUpdated = skillProfile.lastUpdated;
}

/**
 * Persist any `challenge` field on a fresh focus result to the per-user
 * challenge-spec store so the `/challenge?id=…` wrapper page can load it
 * without depending on URL params. Failures are logged and swallowed —
 * a spec-write failure must not break the user's focus response.
 */
async function persistGeneratedChallenge(result: Partial<FocusResponse> | { learningTopic: unknown }): Promise<void> {
  // The shape from `generateFocus` is a union; only the FocusResponse
  // branch carries a challenge. The singleTopic branch returns
  // `{ learningTopic }` with no `challenge` field.
  if (!('challenge' in result) || !result.challenge) return;
  try {
    await writeUserChallengeSpec(result.challenge.id, result.challenge);
  } catch (error) {
    log.warn('Failed to persist challenge spec', { id: result.challenge.id, error });
  }
}

export async function GET() {
  return withGuardedRoute(
    {
      ...FOCUS_GUARD,
      eventType: 'copilot.session.create',
      auditMetadata: { route: '/api/focus', method: 'GET' },
    },
    async (ctx) => {
      // M3.1: hydrate the skill profile from the per-user store so the
      // first-load focus (which has no request body) personalises to
      // confirmed/declared skills rather than running blind. If the
      // profile is missing or corrupt the reader returns the default
      // shape, which the handlers treat as "no profile".
      const skillProfile = await readUserSkillsProfile().catch((error) => {
        log.warn('Failed to read skill profile for GET focus; continuing without it', { error });
        return undefined;
      });
      const result = await generateFocus(createSessionIdentity(ctx), { skillProfile });
      await persistGeneratedChallenge(result);
      return NextResponse.json(result);
    },
  );
}

export async function POST(request: NextRequest) {
  const body = await parseJsonBodyWithFallback<FocusPostBody>(request, {});

  const topicTitlesError = validateExistingTitles(body.existingTopicTitles, 'existingTopicTitles');
  if (topicTitlesError) {
    return NextResponse.json({ error: topicTitlesError }, { status: 400 });
  }
  const challengeTitlesError = validateExistingTitles(body.existingChallengeTitles, 'existingChallengeTitles');
  if (challengeTitlesError) {
    return NextResponse.json({ error: challengeTitlesError }, { status: 400 });
  }

  return withGuardedRoute(
    {
      ...FOCUS_GUARD,
      eventType: 'copilot.session.create',
      auditMetadata: { route: '/api/focus', method: 'POST', component: body.component },
    },
    async (ctx) => {
      const serverSkillProfile = await readUserSkillsProfile().catch((error) => {
        log.warn('Failed to read skill profile for POST focus; continuing without it', { error });
        return undefined;
      });
      const skillProfile = chooseNewestSkillProfile({
        clientProfile: body.skillProfile,
        serverProfile: serverSkillProfile,
      });

      if (!body.component) {
        log.info('Running combined focus generation request', { componentCount: 3 });
      }

      const result = await generateFocus(createSessionIdentity(ctx), {
        component: body.component,
        skillProfile,
        existingTopicTitles: body.existingTopicTitles,
        existingChallengeTitles: body.existingChallengeTitles,
        reviewTopics: body.reviewTopics,
        interleavingHint: body.interleavingHint,
        debugMode: body.debugMode,
      });
      stampSkillProfileTimestamp(result, skillProfile);
      await persistGeneratedChallenge(result);
      return NextResponse.json(result);
    },
  );
}
