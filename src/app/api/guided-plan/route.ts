import { knownApiErrorResponse, parseJsonBodyWithFallback } from '@/lib/api';
import { generateGuidedPlan, getGuidedPlanFallback } from '@/lib/copilot/guided-mode';
import { createSessionIdentity } from '@/lib/copilot/server';
import { getOctokitForRequest } from '@/lib/github/client';
import { buildCompactContext, serializeContext } from '@/lib/github/profile';
import { logger } from '@/lib/logger';
import { withUserGuards } from '@/lib/security/guard';
import { guardErrorResponse } from '@/lib/security/http';
import { PLAN_GUARD } from '@/lib/security/route-defaults';
import { NextRequest, NextResponse } from 'next/server';

const log = logger.withTag('Guided Plan API');

interface GuidedPlanRequestBody {
  challengeTitle: string;
  challengeDescription: string;
  challengeLanguage: string;
  challengeDifficulty: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
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

  try {
    return await withUserGuards(
      { ...PLAN_GUARD, eventType: 'copilot.session.create', auditMetadata: { route: '/api/guided-plan' } },
      async (ctx) => {
        let profileContext = '';
        try {
          const octokit = await getOctokitForRequest();
          const compactContext = await buildCompactContext(octokit, 1000);
          profileContext = serializeContext(compactContext);
        } catch (error) {
          log.warn('Failed to build profile context for guided plan', error);
        }

        try {
          const plan = await generateGuidedPlan(
            createSessionIdentity(ctx),
            challenge,
            profileContext,
          );
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
  } catch (error) {
    const guardResponse = guardErrorResponse(error);
    if (guardResponse) return guardResponse;
    const knownResponse = knownApiErrorResponse(error);
    if (knownResponse) return knownResponse;
    throw error;
  }
}
