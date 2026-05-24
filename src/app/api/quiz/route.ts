import { knownApiErrorResponse, parseJsonBodyWithFallback } from '@/lib/api';
import { generateTopicQuiz, type QuizResult } from '@/lib/copilot/quiz';
import { createSessionIdentity } from '@/lib/copilot/server';
import { buildProfileContext } from '@/lib/github/profile-context';
import { logger } from '@/lib/logger';
import { withUserGuards } from '@/lib/security/guard';
import { guardErrorResponse } from '@/lib/security/http';
import { QUIZ_GUARD } from '@/lib/security/route-defaults';
import { NextRequest, NextResponse } from 'next/server';

const log = logger.withTag('Quiz API');

interface QuizRequestBody {
  topicTitle: string;
  topicDescription: string;
}

function getUnavailableFallbackQuiz(topicTitle: string): QuizResult {
  return {
    topicTitle,
    questions: [
      {
        id: 'q1',
        question: 'Practice Quiz is currently unavailable.',
        options: [
          'A. Please try again in a moment',
          'B. Please try again in a moment',
          'C. Please try again in a moment',
          'D. Please try again in a moment',
        ],
        correctIndex: 0,
        explanation: `Here's what's happening: AI generation is not configured right now, so this is a placeholder practice question for "${topicTitle}".`,
        concept: 'Practice setup',
      },
    ],
  };
}

function isAIUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return (
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('authentication') ||
    message.includes('auth') ||
    message.includes('token') ||
    message.includes('copilot') ||
    message.includes('not configured')
  );
}

export async function POST(request: NextRequest) {
  const body = await parseJsonBodyWithFallback<QuizRequestBody>(request, {
    topicTitle: '',
    topicDescription: '',
  });

  const topicTitle = body.topicTitle?.trim() || 'This topic';
  const topicDescription = body.topicDescription?.trim() || '';

  try {
    return await withUserGuards(
      { ...QUIZ_GUARD, eventType: 'copilot.session.create', auditMetadata: { route: '/api/quiz' } },
      async (ctx) => {
        const { context: profileContext } = await buildProfileContext({
          maxChars: 500,
          logger: log,
          context: 'quiz generation',
        });

        try {
          const quiz = await generateTopicQuiz(
            createSessionIdentity(ctx),
            topicTitle,
            topicDescription,
            profileContext,
          );
          return NextResponse.json(quiz);
        } catch (error) {
          // Map known errors (entitlement → 402, etc.) before the
          // generic AI-unavailable fallback so paying-customer signals
          // are never silently swallowed by the static placeholder.
          const knownResponse = knownApiErrorResponse(error);
          if (knownResponse) return knownResponse;
          if (isAIUnavailableError(error)) {
            return NextResponse.json(getUnavailableFallbackQuiz(topicTitle));
          }
          log.error('Failed to generate quiz', error);
          return NextResponse.json({ error: 'Failed to generate quiz' }, { status: 500 });
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
