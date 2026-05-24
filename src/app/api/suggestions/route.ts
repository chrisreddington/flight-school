import { parseJsonBodyWithFallback } from '@/lib/api';
import { createSessionIdentity } from '@/lib/copilot/server';
import { generateWhatsNext, getWhatsNextFallback, type WhatsNextResult } from '@/lib/copilot/suggestions';
import { isCopilotEntitlementError } from '@/lib/copilot/entitlement';
import { buildProfileContext } from '@/lib/github/profile-context';
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
        const { context: profileContext } = await buildProfileContext({
          maxChars: 1000,
          logger: log,
          context: 'suggestions',
        });

        try {
          const result: WhatsNextResult = await generateWhatsNext(
            createSessionIdentity(ctx),
            completedChallenge,
            profileContext
          );
          return NextResponse.json(result);
        } catch (error) {
          // D2: Re-throw entitlement errors so the outer guardErrorResponse
          // maps them to 402. Static fallback is only for unrelated failures.
          if (isCopilotEntitlementError(error)) {
            throw error;
          }
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
