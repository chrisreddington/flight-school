import { parseJsonBodyWithFallback } from '@/lib/api';
import { generateTopicQuiz, type QuizResult } from '@/lib/copilot/quiz';
import { buildCompactContext, serializeContext } from '@/lib/github/profile';
import { logger } from '@/lib/logger';
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

  let profileContext = '';
  try {
    const compactProfile = await buildCompactContext(500);
    profileContext = serializeContext(compactProfile);
  } catch (error) {
    log.warn('Failed to build profile context for quiz generation', error);
  }

  try {
    const quiz = await generateTopicQuiz(topicTitle, topicDescription, profileContext);
    return NextResponse.json(quiz);
  } catch (error) {
    if (isAIUnavailableError(error)) {
      return NextResponse.json(getUnavailableFallbackQuiz(topicTitle));
    }
    log.error('Failed to generate quiz', error);
    return NextResponse.json({ error: 'Failed to generate quiz' }, { status: 500 });
  }
}

