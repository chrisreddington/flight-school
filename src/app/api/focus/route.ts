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
import type { SkillProfile } from '@/lib/skills/types';
import { NextRequest, NextResponse } from 'next/server';

const log = logger.withTag('Focus API Route');

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
      const result = await generateFocus(createSessionIdentity(ctx));
      await persistGeneratedChallenge(result);
      return NextResponse.json(result);
    },
  );
}

export async function POST(request: NextRequest) {
  const body = await parseJsonBodyWithFallback<{
    component?: FocusComponent;
    skillProfile?: SkillProfile;
    existingTopicTitles?: string[];
    reviewTopics?: string[];
    interleavingHint?: InterleavingHint;
    debugMode?: boolean;
  }>(request, {});

  return withGuardedRoute(
    {
      ...FOCUS_GUARD,
      eventType: 'copilot.session.create',
      auditMetadata: { route: '/api/focus', method: 'POST', component: body.component },
    },
    async (ctx) => {
      const result = await generateFocus(createSessionIdentity(ctx), {
        component: body.component,
        skillProfile: body.skillProfile,
        existingTopicTitles: body.existingTopicTitles,
        reviewTopics: body.reviewTopics,
        interleavingHint: body.interleavingHint,
        debugMode: body.debugMode,
      });
      await persistGeneratedChallenge(result);
      return NextResponse.json(result);
    },
  );
}
