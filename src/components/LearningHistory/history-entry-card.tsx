/**
 * HistoryEntryCard Component
 *
 * Displays a collapsible date section with history items.
 * Shows a date header with item count and renders individual ItemCards.
 */

import type { LearningTopic } from '@/lib/focus/types';
import { ChevronDownIcon, ChevronRightIcon } from '@primer/octicons-react';
import { Stack } from '@primer/react';
import { ItemCard } from './item-card';
import styles from './LearningHistory.module.css';
import type { HistoryEntry } from './types';

interface HistoryEntryCardProps {
  entry: HistoryEntry;
  isToday: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onRefresh: () => void;
  onSkipTopic: (topicId: string, existingTitles: string[]) => Promise<void>;
  onSkipChallenge: (challengeId: string, existingTitles: string[]) => Promise<void>;
  onSkipGoal: (goalId: string, existingTitles: string[]) => Promise<void>;
  onStopSkipTopic: (topicId: string) => void;
  onStopSkipChallenge: (challengeId: string) => void;
  onStopSkipGoal: (goalId: string) => void;
  onExploreTopic: (topic: LearningTopic) => Promise<void>;
  skippingTopicIds: Set<string>;
  skippingChallengeIds: Set<string>;
  skippingGoalIds: Set<string>;
  activeTopicIds: Set<string>;
  activeChallengeIds: Set<string>;
  activeGoalIds: Set<string>;
}

export function HistoryEntryCard({
  entry,
  isToday,
  isCollapsed,
  onToggleCollapse,
  onRefresh,
  onSkipTopic,
  onSkipChallenge,
  onSkipGoal,
  onStopSkipTopic,
  onStopSkipChallenge,
  onStopSkipGoal,
  onExploreTopic,
  skippingTopicIds,
  skippingChallengeIds,
  skippingGoalIds,
  activeTopicIds,
  activeChallengeIds,
  activeGoalIds,
}: HistoryEntryCardProps) {
  return (
    <div className={styles.dateSection}>
      <button
        type="button"
        className={styles.dateSectionHeader}
        onClick={onToggleCollapse}
        aria-expanded={!isCollapsed}
      >
        <div className={styles.dateSectionLeft}>
          <span className={styles.dateSectionChevron}>
            {isCollapsed ? <ChevronRightIcon size={16} /> : <ChevronDownIcon size={16} />}
          </span>
          {isToday ? (
            <span className={styles.todayBadge}>Today</span>
          ) : (
            <span className={styles.dateSectionTitle}>{entry.displayDate}</span>
          )}
        </div>
        <span className={styles.dateSectionCount}>
          {entry.items.length} item{entry.items.length !== 1 ? 's' : ''}
        </span>
      </button>
      {!isCollapsed && (
        <Stack direction="vertical" gap="condensed">
          {entry.items.map((item, index) => (
            <div key={`${entry.dateKey}-${item.type}-${item.timestamp}-${index}`} className={styles.historyItemGroup}>
              <ItemCard
                item={item}
                dateKey={entry.dateKey}
                onRefresh={onRefresh}
                onSkipTopic={onSkipTopic}
                onSkipChallenge={onSkipChallenge}
                onSkipGoal={onSkipGoal}
                onStopSkipTopic={onStopSkipTopic}
                onStopSkipChallenge={onStopSkipChallenge}
                onStopSkipGoal={onStopSkipGoal}
                onExploreTopic={onExploreTopic}
                isSkippingTopic={item.type === 'topic' && (skippingTopicIds.has(item.data.id) || activeTopicIds.has(item.data.id))}
                isSkippingChallenge={item.type === 'challenge' && (skippingChallengeIds.has(item.data.id) || activeChallengeIds.has(item.data.id))}
                isSkippingGoal={item.type === 'goal' && (skippingGoalIds.has(item.data.id) || activeGoalIds.has(item.data.id))}
              />
              {item.type === 'challenge' && item.data.selfExplanation && (
                <details className={styles.selfExplanationDetails}>
                  <summary className={styles.selfExplanationSummary}>💬 Your note</summary>
                  <p className={styles.selfExplanationText}>{item.data.selfExplanation}</p>
                </details>
              )}
            </div>
          ))}
        </Stack>
      )}
    </div>
  );
}
