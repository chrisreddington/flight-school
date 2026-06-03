/**
 * ItemCard Component
 *
 * Individual item card with collapsible support for completed/skipped items.
 */

'use client';

import { ChallengeCard, GoalCard, HabitHistoryCard, TopicCard } from '@/components/FocusItem';
import { getDateKey } from '@/lib/utils/date-utils';
import type { LearningTopic } from '@/lib/focus/types';
import {
  BookIcon,
  CalendarIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
  SkipIcon,
} from '@primer/octicons-react';
import { memo, useCallback, useState } from 'react';
import type { HistoryItem } from './types';
import { formatTime } from './utils';
import styles from './LearningHistory.module.css';

interface ItemCardProps {
  item: HistoryItem;
  dateKey: string;
  onRefresh: () => void;
  onSkipTopic?: (topicId: string, existingTitles: string[]) => void;
  onSkipChallenge?: (challengeId: string, existingTitles: string[]) => void;
  onSkipGoal?: (goalId: string, existingTitles: string[]) => void;
  onStopSkipTopic?: (topicId: string) => void;
  onStopSkipChallenge?: (challengeId: string) => void;
  onStopSkipGoal?: (goalId: string) => void;
  onExploreTopic?: (topic: LearningTopic) => Promise<void>;
  isSkippingTopic?: boolean;
  isSkippingChallenge?: boolean;
  isSkippingGoal?: boolean;
}

/** Individual item card with collapsible support for completed/skipped items */
export const ItemCard = memo(function ItemCard({
  item,
  dateKey,
  onRefresh,
  onSkipTopic,
  onSkipChallenge,
  onSkipGoal,
  onStopSkipTopic,
  onStopSkipChallenge,
  onStopSkipGoal,
  onExploreTopic,
  isSkippingTopic = false,
  isSkippingChallenge = false,
  isSkippingGoal = false,
}: ItemCardProps) {
  // Every history item starts collapsed to a one-line summary (status/type
  // icon + title + time) so the timeline stays scannable instead of rendering
  // a wall of full focus cards. Expanding reveals the full card and its
  // actions; the choice is per-item and resets on remount.
  const [isExpanded, setIsExpanded] = useState(false);
  const isCollapsed = !isExpanded;

  const statusIcon =
    item.status === 'completed' ? (
      <CheckCircleIcon size={14} className={styles.statusCompleted} />
    ) : item.status === 'skipped' ? (
      <SkipIcon size={14} className={styles.statusSkipped} />
    ) : null;

  const typeIcon =
    item.type === 'challenge' ? (
      <CodeIcon size={14} />
    ) : item.type === 'goal' ? (
      <CheckIcon size={14} />
    ) : item.type === 'topic' ? (
      <BookIcon size={14} />
    ) : (
      <CalendarIcon size={14} />
    );

  const timeStr = formatTime(item.timestamp);
  const isInactive = item.status === 'skipped';

  // Get item title and ID
  const itemTitle = item.data.title;
  const itemId = item.data.id;

  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <div
      className={`${styles.itemCard} ${isInactive ? styles.itemCardInactive : ''} ${isCollapsed ? styles.itemCardCollapsed : ''}`}
      data-item-id={itemId}
    >
      <button
        type="button"
        className={`${styles.itemCardHeader} ${styles.itemCardHeaderClickable}`}
        onClick={handleToggle}
        aria-expanded={!isCollapsed}
      >
        <div className={styles.itemCardMeta}>
          <span className={styles.itemCardChevron}>
            {isCollapsed ? <ChevronRightIcon size={14} /> : <ChevronDownIcon size={14} />}
          </span>
          {statusIcon}
          <span className={styles.itemCardType}>{typeIcon}</span>
          {isCollapsed && <span className={styles.itemCardTitle}>{itemTitle}</span>}
        </div>
        <span className={styles.itemCardTime}>{timeStr}</span>
      </button>
      {!isCollapsed && (
        <div className={styles.itemCardContent}>
          {item.type === 'challenge' && (
            <ChallengeCard
              challenge={item.data}
              dateKey={dateKey}
              showHistoryActions
              onRefresh={onRefresh}
              onStateChange={onRefresh}
              onSkipAndReplace={onSkipChallenge}
              onStopSkip={onStopSkipChallenge}
              isSkipping={isSkippingChallenge}
            />
          )}
          {item.type === 'goal' && (
            <GoalCard
              goal={item.data}
              dateKey={dateKey}
              showHistoryActions
              onRefresh={onRefresh}
              onStateChange={onRefresh}
              onSkipAndReplace={onSkipGoal}
              onStopSkip={onStopSkipGoal}
              isSkipping={isSkippingGoal}
            />
          )}
          {item.type === 'topic' && (
            <TopicCard
              topic={item.data}
              dateKey={dateKey}
              showHistoryActions
              onStateChange={onRefresh}
              onSkipAndReplace={onSkipTopic}
              onStopSkip={onStopSkipTopic}
              onExplore={onExploreTopic}
              isSkipping={isSkippingTopic}
            />
          )}
          {item.type === 'habit' && (
            <HabitHistoryCard
              habit={item.data}
              dateKey={dateKey}
              isToday={dateKey === getDateKey()}
              onUpdate={onRefresh}
            />
          )}
        </div>
      )}
    </div>
  );
});
