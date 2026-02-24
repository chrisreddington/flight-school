import { parseJsonBodyWithFallback } from '@/lib/api';
import { generateWhatsNext, getWhatsNextFallback, type WhatsNextResult } from '@/lib/copilot/suggestions';
import { buildCompactContext, serializeContext } from '@/lib/github/profile';
import { logger } from '@/lib/logger';
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

  let profileContext = '';
  try {
    const compactContext = await buildCompactContext(1000);
    profileContext = serializeContext(compactContext);
  } catch (error) {
    log.warn('Failed to build profile context for suggestions', error);
  }

  try {
    const result: WhatsNextResult = await generateWhatsNext(completedChallenge, profileContext);
    return NextResponse.json(result);
  } catch (error) {
    log.error('Failed to generate suggestions', error);
    return NextResponse.json(getWhatsNextFallback(completedChallenge));
  }
}
