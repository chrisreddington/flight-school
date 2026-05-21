import { parseJsonBodyWithFallback } from '@/lib/api';
import { generateWhatsNext, getWhatsNextFallback, type WhatsNextResult } from '@/lib/copilot/suggestions';
import { getOctokitForRequest } from '@/lib/github/client';
import { buildCompactContext, serializeContext } from '@/lib/github/profile';
import { logger } from '@/lib/logger';
import { withUserGuards } from '@/lib/security/guard';
import { guardErrorResponse } from '@/lib/security/http';
import { SUGGESTIONS_GUARD } from '@/lib/security/route-defaults';
import { NextRequest, NextResponse } from 'next/server';

const log = logger.withTag('Suggestions API');

interface SuggestionsRequestBody {
  challengeTitle: string;
  challengeLanguage: string;
  challengeDifficulty: string;
}

export async function POST(request: NextRequest) {
  const body = await parseJsonBodyWithFallback<SuggestionsRequestBody>(request, {
    challengeTitle: '',
    challengeLanguage: '',
    challengeDifficulty: '',
  });

  const completedChallenge = {
    title: body.challengeTitle?.trim() || 'Completed challenge',
    language: body.challengeLanguage?.trim() || 'TypeScript',
    difficulty: body.challengeDifficulty?.trim() || 'beginner',
  };

  try {
    return await withUserGuards(
      { ...SUGGESTIONS_GUARD, eventType: 'copilot.session.create', auditMetadata: { route: '/api/suggestions' } },
      async (ctx) => {
        let profileContext = '';
        try {
          const octokit = await getOctokitForRequest();
          const compactContext = await buildCompactContext(octokit, 1000);
          profileContext = serializeContext(compactContext);
        } catch (error) {
          log.warn('Failed to build profile context for suggestions', error);
        }

        try {
          const result: WhatsNextResult = await generateWhatsNext(
            { userId: ctx.userId, gitHubToken: ctx.accessToken },
            completedChallenge,
            profileContext
          );
          return NextResponse.json(result);
        } catch (error) {
          log.error('Failed to generate suggestions', error);
          return NextResponse.json(getWhatsNextFallback(completedChallenge));
        }
      },
    );
  } catch (error) {
    const guardResponse = guardErrorResponse(error);
    if (guardResponse) return guardResponse;
    throw error;
  }
}
