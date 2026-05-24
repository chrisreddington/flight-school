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
import { createSessionIdentity } from '@/lib/copilot/server';
import type { InterleavingHint } from '@/lib/focus/interleaving';
import { generateFocus, type FocusComponent } from '@/lib/focus/handlers';
import { withGuardedRoute } from '@/lib/security/guard';
import { FOCUS_GUARD } from '@/lib/security/route-defaults';
import type { SkillProfile } from '@/lib/skills/types';
import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  return withGuardedRoute(
    { ...FOCUS_GUARD, eventType: 'copilot.session.create', auditMetadata: { route: '/api/focus', method: 'GET' } },
    async (ctx) => NextResponse.json(await generateFocus(createSessionIdentity(ctx))),
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
    { ...FOCUS_GUARD, eventType: 'copilot.session.create', auditMetadata: { route: '/api/focus', method: 'POST', component: body.component } },
    async (ctx) => NextResponse.json(await generateFocus(createSessionIdentity(ctx), {
      component: body.component,
      skillProfile: body.skillProfile,
      existingTopicTitles: body.existingTopicTitles,
      reviewTopics: body.reviewTopics,
      interleavingHint: body.interleavingHint,
      debugMode: body.debugMode,
    })),
  );
}
