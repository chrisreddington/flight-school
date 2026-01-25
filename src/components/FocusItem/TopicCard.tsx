/**
 * Shared Topic Card Component
 * 
 * Displays a learning topic with consistent styling across Dashboard and History.
 */

import { focusStore } from '@/lib/focus';
import type { TopicState } from '@/lib/focus/state-machine';
import type { LearningTopic } from '@/lib/focus/types';
import { getDateKey, isTodayDateKey } from '@/lib/utils/date-utils';
import { BookIcon, CheckIcon, PlusIcon, SkipIcon, StopIcon } from '@primer/octicons-react';
import { Button, Heading, Label, SkeletonBox, Spinner, Stack } from '@primer/react';
import { useCallback, useEffect, useState } from 'react';
import styles from './FocusItem.module.css';

interface TopicCardProps {
  topic: LearningTopic;
  /** Optional date key for history items (defaults to today) */
  dateKey?: string;
  /** Show history-specific actions (shows skipped state in history) */
  showHistoryActions?: boolean;
  /** Callback when topic is explored */
  onExplore?: (topic: LearningTopic) => void;
  /** Callback when topic is skipped/replaced - receives the topic for replacement */
  onSkip?: (skippedTopic: LearningTopic) => void;
  /** Callback to skip and replace topic (alternative to onSkip, matches challenge/goal pattern) */
  onSkipAndReplace?: (topicId: string, existingTopicTitles: string[]) => void;
  /** Callback to stop the skip/regeneration in progress */
  onStopSkip?: () => void;
  /** Callback after state transition */
  onStateChange?: () => void;
  /** Whether skip/new is in progress (loading state) */
  isSkipping?: boolean;
}

export function TopicCard({
  topic,
  dateKey = getDateKey(),
  showHistoryActions = false,
  onExplore,
  onSkip,
  onSkipAndReplace,
  onStopSkip,
  onStateChange,
  isSkipping = false,
}: TopicCardProps) {
  const [currentState, setCurrentState] = useState<TopicState>('not-explored');

  // Load current state from storage
  useEffect(() => {
    (async () => {
      const history = await focusStore.getHistory();
      const record = history[dateKey];
      if (record?.learningTopics) {
        // Topics are arrays of arrays
        for (const topicArray of record.learningTopics) {
          const item = topicArray.find(t => t.data.id === topic.id);
          if (item && item.stateHistory.length > 0) {
            setCurrentState(item.stateHistory[item.stateHistory.length - 1].state);
            break;
          }
        }
      }
    })();
  }, [dateKey, topic.id]);

  const handleExplore = useCallback(async () => {
    await focusStore.transitionTopic(dateKey, topic.id, 'explored', showHistoryActions ? 'history' : 'dashboard');
    setCurrentState('explored');
    if (onStateChange) onStateChange();
    if (onExplore) onExplore(topic);
  }, [dateKey, topic, showHistoryActions, onStateChange, onExplore]);

  const handleSkip = useCallback(async () => {
    // Don't mark as skipped yet - wait for replacement to succeed
    // The parent will mark it as skipped only after successful replacement
    // Support both callback patterns
    if (onSkipAndReplace) {
      onSkipAndReplace(topic.id, [topic.title]);
    } else if (onSkip) {
      onSkip(topic);
    }
  }, [topic, onSkip, onSkipAndReplace]);

  const isExplored = currentState === 'explored';
  const isSkipped = currentState === 'skipped';
  const isToday = isTodayDateKey(dateKey);

  // Show loading state while regenerating (with stop button on dashboard)
  if (isSkipping) {
    return (
      <div className={styles.card}>
        <Stack direction="vertical" gap="normal">
          <Stack direction="horizontal" align="center" justify="space-between">
            <Stack direction="horizontal" align="center" gap="condensed">
              <Spinner size="small" />
              <span className={styles.loadingText}>Generating new topic...</span>
            </Stack>
            {onStopSkip && (
              <Button
                variant="danger"
                size="small"
                onClick={onStopSkip}
                leadingVisual={StopIcon}
                aria-label="Stop generating topic"
              >
                Stop
              </Button>
            )}
          </Stack>
          <SkeletonBox height="24px" width="70%" />
          <SkeletonBox height="16px" width="100%" />
          <SkeletonBox height="16px" width="90%" />
        </Stack>
      </div>
    );
  }

  // Don't render skipped topics on dashboard (they've been replaced)
  // Only show them in history view
  if (isSkipped && !showHistoryActions) {
    return null;
  }

  return (
    <div className={styles.card}>
      <Stack direction="vertical" gap="normal">
        <Stack direction="horizontal" justify="space-between" align="center">
          <Label size="small" variant="accent">
            <span style={{ marginRight: '4px', display: 'inline-flex' }}><BookIcon size={12} /></span>
            {topic.type === 'best-practice' ? 'Best Practice' : topic.type === 'concept' ? 'Concept' : 'Pattern'}
          </Label>
          {isSkipped && showHistoryActions && (
            <Label variant="secondary">Skipped</Label>
          )}
        </Stack>

        <Heading as="h3">{topic.title}</Heading>
        <p className={styles.description}>{topic.description}</p>

        {topic.relatedTo && (
          <p className={styles.relatedTo}>
            <strong>Related to:</strong> {topic.relatedTo}
          </p>
        )}

        <Stack direction="horizontal" gap="condensed">
          <Button
            variant="primary"
            leadingVisual={isExplored ? CheckIcon : BookIcon}
            onClick={handleExplore}
            disabled={isExplored || isSkipped}
          >
            {isExplored ? 'Explored' : 'Explore Topic'}
          </Button>
          {/* Show Skip for unexplored topics, New for explored topics - only on today's items */}
          {!isSkipped && isToday && (
            <Button
              variant="invisible"
              leadingVisual={isExplored ? PlusIcon : SkipIcon}
              onClick={handleSkip}
            >
              {isExplored ? 'New' : 'Skip'}
            </Button>
          )}
        </Stack>
      </Stack>
    </div>
  );
}
