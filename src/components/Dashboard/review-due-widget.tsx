'use client';

import { Button, Label, Stack } from '@primer/react';
import { useCallback, useEffect, useState } from 'react';

import { TopicQuiz } from '@/components/TopicQuiz';
import { useSpacedRepCandidates } from '@/hooks/use-spaced-rep-candidates';
import { focusStore } from '@/lib/focus';
import type { FocusHistory } from '@/lib/focus/types';
import { getDateKey } from '@/lib/utils/date-utils';
import type { SpacedRepCandidate } from '@/lib/focus/spaced-repetition';
import styles from './review-due-widget.module.css';

interface SelectedTopic {
  topicId: string;
  topicTitle: string;
  topicDescription: string;
  dateKey: string;
}

function findLatestTopicRecord(history: FocusHistory, topicId: string): { dateKey: string; description: string } | null {
  const sortedDateKeys = Object.keys(history).sort((a, b) => b.localeCompare(a));

  for (const dateKey of sortedDateKeys) {
    const record = history[dateKey];
    for (let topicSetIndex = record.learningTopics.length - 1; topicSetIndex >= 0; topicSetIndex--) {
      const topicSet = record.learningTopics[topicSetIndex];
      const matchedTopic = topicSet.find((statefulTopic) => statefulTopic.data.id === topicId);

      if (matchedTopic) {
        return {
          dateKey,
          description: matchedTopic.data.description,
        };
      }
    }
  }

  return null;
}

export function ReviewDueWidget() {
  const { candidates, isLoading } = useSpacedRepCandidates();
  const [selectedTopic, setSelectedTopic] = useState<SelectedTopic | null>(null);
  const [hasHistory, setHasHistory] = useState<boolean>(false);

  useEffect(() => {
    let isActive = true;

    (async () => {
      try {
        const history = await focusStore.getHistory();
        if (isActive) {
          setHasHistory(Object.keys(history).length > 0);
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      isActive = false;
    };
  }, []);

  const handleStartQuiz = useCallback(async (candidate: SpacedRepCandidate) => {
    const history = await focusStore.getHistory();
    const topicRecord = findLatestTopicRecord(history, candidate.topicId);

    setSelectedTopic({
      topicId: candidate.topicId,
      topicTitle: candidate.title,
      topicDescription: topicRecord?.description ?? `Review key concepts for ${candidate.title}.`,
      dateKey: topicRecord?.dateKey ?? getDateKey(),
    });
  }, []);

  const handleQuizClose = useCallback(() => {
    if (!selectedTopic) return;

    const topicToMarkReviewed = selectedTopic;
    setSelectedTopic(null);
    void focusStore.markTopicReviewed(topicToMarkReviewed.dateKey, topicToMarkReviewed.topicId);
  }, [selectedTopic]);

  if (isLoading) {
    return null;
  }

  if (candidates.length === 0) {
    if (!hasHistory) {
      return null;
    }

    return (
      <section className={styles.card}>
        <header className={styles.header}>
          <h3 className={styles.title}>📚 Spaced Review</h3>
          <p className={styles.subtitle}>You&apos;re all caught up! Topics will appear here when due for review.</p>
        </header>
      </section>
    );
  }

  return (
    <>
      <section className={styles.card}>
        <header className={styles.header}>
          <h3 className={styles.title}>📚 Review Due</h3>
          <p className={styles.subtitle}>Topics to revisit for better retention</p>
        </header>

        <Stack direction="vertical" gap="condensed">
          {candidates.map((candidate) => (
            <div key={candidate.topicId} className={styles.topicCard}>
              <div className={styles.topicMeta}>
                <p className={styles.topicTitle}>{candidate.title}</p>
                <Stack direction="horizontal" gap="condensed" align="center">
                  <span className={styles.topicAge}>
                    {candidate.daysSinceSeen} day{candidate.daysSinceSeen === 1 ? '' : 's'} ago
                  </span>
                  {candidate.isForgotten && (
                    <Label size="small" variant="attention">
                      Forgotten
                    </Label>
                  )}
                </Stack>
              </div>
              <Button variant="invisible" onClick={() => void handleStartQuiz(candidate)}>
                Quick Quiz →
              </Button>
            </div>
          ))}
        </Stack>
      </section>

      {selectedTopic && (
        <div className={styles.quizOverlay}>
          <div className={styles.quizPanel} role="dialog" aria-modal="true">
            <TopicQuiz
              topicTitle={selectedTopic.topicTitle}
              topicDescription={selectedTopic.topicDescription}
              onClose={handleQuizClose}
            />
          </div>
        </div>
      )}
    </>
  );
}
