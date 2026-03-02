'use client';

import type { QuizQuestion, QuizResult } from '@/lib/copilot/quiz';
import { CheckCircleIcon } from '@primer/octicons-react';
import { Button, FormControl, Heading, Radio, RadioGroup, Spinner, Stack, Text } from '@primer/react';
import { useEffect, useMemo, useState } from 'react';

const QUIZ_CACHE_PREFIX = 'quiz:';
const QUIZ_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedQuiz {
  quiz: QuizResult;
  cachedAt: number;
}

function readQuizCache(topicTitle: string): QuizResult | null {
  try {
    const raw = localStorage.getItem(`${QUIZ_CACHE_PREFIX}${topicTitle}`);
    if (!raw) return null;
    const cached: CachedQuiz = JSON.parse(raw);
    if (Date.now() - cached.cachedAt < QUIZ_CACHE_TTL_MS) return cached.quiz;
  } catch {
    // localStorage unavailable or corrupted
  }
  return null;
}

function writeQuizCache(topicTitle: string, quiz: QuizResult): void {
  try {
    localStorage.setItem(`${QUIZ_CACHE_PREFIX}${topicTitle}`, JSON.stringify({ quiz, cachedAt: Date.now() }));
  } catch {
    // Quota exceeded or unavailable — silently skip
  }
}

interface TopicQuizProps {
  topicTitle: string;
  topicDescription: string;
  onClose: () => void;
}

type QuizViewState = 'idle' | 'loading' | 'question' | 'answered' | 'complete';

export function TopicQuiz({ topicTitle, topicDescription, onClose }: TopicQuizProps) {
  const [viewState, setViewState] = useState<QuizViewState>('idle');
  const [quiz, setQuiz] = useState<QuizResult | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load cached quiz on mount — skip the generation step if available
  useEffect(() => {
    const cached = readQuizCache(topicTitle);
    if (cached) {
      setQuiz(cached);
      setCurrentIndex(0);
      setSelectedIndex(null);
      setViewState('question');
    }
  }, [topicTitle]);

  const currentQuestion: QuizQuestion | null = quiz?.questions[currentIndex] ?? null;
  const reinforcedConcepts = useMemo(() => {
    if (!quiz?.questions) return [];
    return Array.from(new Set(quiz.questions.map((question) => question.concept)));
  }, [quiz]);

  const startQuiz = async () => {
    setViewState('loading');
    setErrorMessage(null);
    setSelectedIndex(null);
    setCurrentIndex(0);

    try {
      const response = await fetch('/api/quiz', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          topicTitle,
          topicDescription,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate quiz');
      }

      const data = (await response.json()) as QuizResult;
      writeQuizCache(topicTitle, data);
      setQuiz(data);
      setViewState('question');
    } catch {
      setErrorMessage('Could not load practice quiz right now. Please try again.');
      setViewState('idle');
    }
  };

  const submitAnswer = () => {
    if (selectedIndex === null) return;
    setViewState('answered');
  };

  const goToNextQuestion = () => {
    if (!quiz) return;
    const nextIndex = currentIndex + 1;
    if (nextIndex >= quiz.questions.length) {
      setViewState('complete');
      return;
    }
    setCurrentIndex(nextIndex);
    setSelectedIndex(null);
    setViewState('question');
  };

  return (
    <Stack
      direction="vertical"
      gap="normal"
      padding="normal"
      style={{
        border: '1px solid var(--borderColor-default)',
        borderRadius: 'var(--borderRadius-medium)',
        background: 'var(--bgColor-muted)',
      }}
    >
      <Stack direction="horizontal" justify="space-between" align="center">
        <Heading as="h4">Practice Quiz: {topicTitle}</Heading>
        <Button variant="invisible" onClick={onClose}>
          Close
        </Button>
      </Stack>

      {viewState === 'idle' && (
        <Stack direction="vertical" gap="condensed">
          <Button variant="primary" onClick={startQuiz}>
            Start Practice Quiz
          </Button>
          {errorMessage && (
            <Text style={{ color: 'var(--fgColor-danger)' }}>{errorMessage}</Text>
          )}
        </Stack>
      )}

      {viewState === 'loading' && (
        <Stack direction="horizontal" gap="condensed" align="center">
          <Spinner size="small" />
          <Text>Generating practice quiz...</Text>
        </Stack>
      )}

      {(viewState === 'question' || viewState === 'answered') && currentQuestion && (
        <Stack direction="vertical" gap="normal">
          <Text style={{ color: 'var(--fgColor-muted)' }}>
            Question {currentIndex + 1} of {quiz?.questions.length ?? 3}
          </Text>

          <Heading as="h5">{currentQuestion.question}</Heading>

          <RadioGroup
            name={`topic-quiz-${currentQuestion.id}`}
            onChange={(value) => {
              if (viewState === 'answered') return;
              setSelectedIndex(value ? Number(value) : null);
            }}
          >
            <Stack direction="vertical" gap="condensed">
              {currentQuestion.options.map((option, index) => (
                <FormControl key={`${currentQuestion.id}-option-${index}`}>
                  <Radio
                    value={String(index)}
                    checked={selectedIndex === index}
                    disabled={viewState === 'answered'}
                  />
                  <FormControl.Label>{option}</FormControl.Label>
                </FormControl>
              ))}
            </Stack>
          </RadioGroup>

          {viewState === 'question' && (
            <Button onClick={submitAnswer} disabled={selectedIndex === null}>
              Check Answer
            </Button>
          )}

          {viewState === 'answered' && selectedIndex !== null && (
            <Stack
              direction="vertical"
              gap="condensed"
              padding="normal"
              style={{
                background: 'var(--bgColor-accent-muted)',
                border: '1px solid var(--borderColor-accent-muted)',
                borderRadius: 'var(--borderRadius-medium)',
              }}
            >
              {selectedIndex === currentQuestion.correctIndex ? (
                <Text style={{ color: 'var(--fgColor-success)' }}>That&apos;s right!</Text>
              ) : (
                <Text style={{ fontWeight: 600 }}>Not quite — here&apos;s what&apos;s happening:</Text>
              )}
              <Text>{currentQuestion.explanation}</Text>
            </Stack>
          )}

          {viewState === 'answered' && (
            <Button onClick={goToNextQuestion}>
              {currentIndex + 1 < (quiz?.questions.length ?? 0) ? 'Next Question' : 'Finish'}
            </Button>
          )}
        </Stack>
      )}

      {viewState === 'complete' && (
        <Stack direction="vertical" gap="normal">
          <Stack direction="horizontal" gap="condensed" align="center">
            <CheckCircleIcon size={16} fill="var(--fgColor-success)" />
            <Heading as="h5">{reinforcedConcepts.length} topics reinforced</Heading>
          </Stack>
          <Text>You reinforced {reinforcedConcepts.length} concepts.</Text>
          <Stack direction="vertical" gap="condensed">
            {reinforcedConcepts.map((concept) => (
              <Text key={concept}>• {concept}</Text>
            ))}
          </Stack>
          <Stack direction="horizontal" gap="condensed">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
            <Button variant="default" onClick={startQuiz}>
              New Quiz
            </Button>
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}
