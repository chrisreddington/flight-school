import { knownApiErrorResponse, parseJsonBodyWithFallback } from '@/lib/api';
import { generateGuidedPlan, getGuidedPlanFallback } from '@/lib/copilot/guided-mode';
import { createSessionIdentity } from '@/lib/copilot/session-identity';
import { buildProfileContext } from '@/lib/github/profile-context';
import { logger } from '@/lib/logger';
import { withGuardedRoute } from '@/lib/security/guard';
import { PLAN_GUARD } from '@/lib/security/route-defaults';
import { NextRequest, NextResponse } from 'next/server';

const log = logger.withTag('Guided Plan API');

interface GuidedPlanRequestBody {
  challengeTitle: string;
  challengeDescription: string;
  challengeLanguage: string;
  challengeDifficulty: string;
}

export async function POST(request: NextRequest): Promise<Response> {
  const body = await parseJsonBodyWithFallback<GuidedPlanRequestBody>(request, {
    challengeTitle: '',
    challengeDescription: '',
    challengeLanguage: '',
    challengeDifficulty: '',
  });

  const challenge = {
    title: body.challengeTitle?.trim() || 'Coding challenge',
    description: body.challengeDescription?.trim() || 'Implement a working solution.',
    language: body.challengeLanguage?.trim() || 'TypeScript',
    difficulty: body.challengeDifficulty?.trim() || 'beginner',
  };

  return withGuardedRoute(
    {
      ...PLAN_GUARD,
      eventType: 'copilot.session.create',
      auditMetadata: { route: '/api/guided-plan' },
    },
    async (ctx) => {
      const { context: profileContext } = await buildProfileContext({
        maxChars: 1000,
        logger: log,
        context: 'guided plan',
      });

      try {
        const plan = await generateGuidedPlan(createSessionIdentity(ctx), challenge, profileContext);
        return NextResponse.json(plan);
      } catch (error) {
        // Re-throw entitlement / known API errors so the outer guard
        // adapter maps them (e.g. 402) rather than masking them with
        // the static fallback.
        const knownResponse = knownApiErrorResponse(error);
        if (knownResponse) return knownResponse;
        log.error('Failed to generate guided plan', error);
        return NextResponse.json(getGuidedPlanFallback(challenge));
      }
    },
  );
}
