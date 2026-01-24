/**
 * Shared Topic Card Component
 * 
 * Displays a learning topic with consistent styling across Dashboard and History.
 */

import { focusStore } from '@/lib/focus';
import type { TopicState } from '@/lib/focus/state-machine';
import type { LearningTopic } from '@/lib/focus/types';
import { getDateKey } from '@/lib/utils/date-utils';
import { BookIcon, CheckIcon } from '@primer/octicons-react';
import { Button, Heading, Label, Stack } from '@primer/react';
import { useCallback, useEffect, useState } from 'react';
import styles from './FocusItem.module.css';

interface TopicCardProps {
  topic: LearningTopic;
  /** Optional date key for history items (defaults to today) */
  dateKey?: string;
  /** Show history-specific actions (Explore) */
  showHistoryActions?: boolean;
  /** Callback when topic is explored */
  onExplore?: (topic: LearningTopic) => void;
  /** Callback after state transition */
  onStateChange?: () => void;
}

export function TopicCard({
  topic,
  dateKey = getDateKey(),
  showHistoryActions = false,
  onExplore,
  onStateChange,
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
    await focusStore.markTopicExplored(dateKey, topic.id, showHistoryActions ? 'history' : 'dashboard');
    setCurrentState('explored');
    if (onStateChange) onStateChange();
    if (onExplore) onExplore(topic);
  }, [dateKey, topic, showHistoryActions, onStateChange, onExplore]);

  const isExplored = currentState === 'explored';
  const isSkipped = currentState === 'skipped';

  return (
    <div className={styles.card}>
      <Stack direction="vertical" gap="normal">
        <Stack direction="horizontal" justify="space-between" align="center">
          <Label size="small" variant="accent">
            <span style={{ marginRight: '4px', display: 'inline-flex' }}><BookIcon size={12} /></span>
            {topic.type === 'best-practice' ? 'Best Practice' : topic.type === 'concept' ? 'Concept' : 'Pattern'}
          </Label>
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
          {isExplored && (
            <Label variant="success">✓ Explored</Label>
          )}
        </Stack>
      </Stack>
    </div>
  );
}
