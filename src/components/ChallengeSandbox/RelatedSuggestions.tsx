'use client';

import type { RelatedSuggestion, WhatsNextResult } from '@/lib/copilot/suggestions';
import { Button, Label, Spinner, Stack, Text } from '@primer/react';
import { useEffect, useState } from 'react';

import styles from './ChallengeSandbox.module.css';

interface RelatedSuggestionsProps {
  completedChallenge: { title: string; language: string; difficulty: string };
  onSelectSuggestion?: (suggestion: RelatedSuggestion) => void;
}

function getDifficultyVariant(difficulty: RelatedSuggestion['difficulty']): 'success' | 'attention' | 'danger' {
  if (difficulty === 'beginner') {
    return 'success';
  }
  if (difficulty === 'intermediate') {
    return 'attention';
  }
  return 'danger';
}

function getFallbackSuggestions(
  completedChallenge: { title: string; language: string; difficulty: string }
): RelatedSuggestion[] {
  return [
    {
      id: 'fallback-suggestion-1',
      title: `Extend "${completedChallenge.title}" with additional test cases`,
      reason: `Building on your ${completedChallenge.difficulty} ${completedChallenge.language} work, this next step will strengthen confidence and edge-case thinking.`,
      difficulty: completedChallenge.difficulty === 'beginner' ? 'intermediate' : 'advanced',
      language: completedChallenge.language,
    },
    {
      id: 'fallback-suggestion-2',
      title: `Solve a related ${completedChallenge.language} refactoring challenge`,
      reason: `Building on your ${completedChallenge.difficulty} ${completedChallenge.language} work, this adjacent challenge will help you apply the same concept in a different form.`,
      difficulty: completedChallenge.difficulty === 'advanced' ? 'advanced' : 'intermediate',
      language: completedChallenge.language,
    },
  ];
}

export function RelatedSuggestions({
  completedChallenge,
  onSelectSuggestion,
}: RelatedSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<RelatedSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    const loadSuggestions = async () => {
      setIsLoading(true);
      try {
        const response = await fetch('/api/suggestions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify({
            challengeTitle: completedChallenge.title,
            challengeLanguage: completedChallenge.language,
            challengeDifficulty: completedChallenge.difficulty,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to load suggestions');
        }

        const data = (await response.json()) as WhatsNextResult;
        setSuggestions(data.suggestions.slice(0, 2));
      } catch {
        if (!controller.signal.aborted) {
          setSuggestions(getFallbackSuggestions(completedChallenge));
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void loadSuggestions();

    return () => {
      controller.abort();
    };
  }, [completedChallenge]);

  return (
    <div className={styles.relatedSuggestions}>
      <h4 className={styles.relatedSuggestionsHeading}>What to try next</h4>

      {isLoading ? (
        <div className={styles.loading} role="status" aria-live="polite">
          <Spinner size="small" />
          <span>Finding next challenges...</span>
        </div>
      ) : (
        <Stack direction="vertical" gap="condensed">
          {suggestions.slice(0, 2).map((suggestion) => (
            <div key={suggestion.id} className={styles.relatedSuggestionCard}>
              <Stack direction="vertical" gap="condensed">
                <Stack direction="horizontal" justify="space-between" align="center">
                  <Text className={styles.suggestionTitle}>{suggestion.title}</Text>
                  <Label variant={getDifficultyVariant(suggestion.difficulty)} size="small">
                    {suggestion.difficulty}
                  </Label>
                </Stack>
                <Text className={styles.suggestionReason}>
                  {suggestion.reason}
                </Text>
                <div>
                  <Button
                    variant="default"
                    size="small"
                    onClick={() => onSelectSuggestion?.(suggestion)}
                  >
                    Try this →
                  </Button>
                </div>
              </Stack>
            </div>
          ))}
        </Stack>
      )}
    </div>
  );
}
