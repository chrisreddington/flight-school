/**
 * HistoryEntryCard Component
 *
 * Displays a collapsible date section with history items.
 * Shows a date header with item count and renders individual ItemCards.
 */

import { ChevronDownIcon, ChevronRightIcon, CommentIcon } from '@primer/octicons-react';
import { Stack, VisuallyHidden } from '@primer/react';
import { useId } from 'react';
import { ItemCard } from './item-card';
import styles from './LearningHistory.module.css';
import type { HistoryEntry, HistoryEntryContext } from './types';

interface HistoryEntryCardProps extends HistoryEntryContext {
  entry: HistoryEntry;
  isToday: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
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
  // Items stay mounted and are hidden with `hidden` when the day collapses, so
  // each ItemCard keeps its local expand/collapse state across day toggles.
  // This trades a slightly larger render tree for state correctness; at the
  // feed's scale (tens of days) the prior design panel chose this over lifting
  // every item's expand state into the parent. Revisit with virtualization only
  // if the day count grows by an order of magnitude.
  //
  // The region id is prefixed with a render-unique `useId()` so two history
  // feeds mounted in one document can never produce duplicate `aria-controls`
  // targets.
  const reactId = useId();
  const itemsRegionId = `history-day-items-${reactId}-${entry.dateKey}`;

  return (
    <div className={styles.dateSection}>
      <button
        type="button"
        className={styles.dateSectionHeader}
        onClick={onToggleCollapse}
        aria-expanded={!isCollapsed}
        aria-controls={itemsRegionId}
      >
        <div className={styles.dateSectionLeft}>
          <span className={styles.dateSectionChevron}>
            {isCollapsed ? <ChevronRightIcon size={16} /> : <ChevronDownIcon size={16} />}
          </span>
          {isToday ? (
            <span className={styles.todayBadge}>
              Today
              {/* The visible "Today" label drops the date; expose the absolute
                  date to assistive tech (displayDate would just repeat "Today")
                  since the rail's calendar badge is decorative. */}
              <VisuallyHidden>, {entry.accessibleDate}</VisuallyHidden>
            </span>
          ) : (
            <span className={styles.dateSectionTitle}>
              {entry.displayDate}
              {/* "Yesterday" is the only other relative label formatDateForDisplay
                  emits; like "Today" it hides the real date, so expose the
                  absolute date to assistive tech. Absolute headers (e.g.
                  "Mon, Jan 1") already carry the date and need no suffix. */}
              {entry.displayDate === 'Yesterday' && <VisuallyHidden>, {entry.accessibleDate}</VisuallyHidden>}
            </span>
          )}
        </div>
        <span className={styles.dateSectionCount}>
          {entry.items.length} item{entry.items.length !== 1 ? 's' : ''}
        </span>
      </button>
      {/* role="group" (not "region") intentionally: a labelled group conveys
          that the day's items belong together without registering a page
          landmark. With many days expanded, named regions would flood the AT
          landmark list; the button's aria-expanded/aria-controls already
          communicates the disclosure relationship. */}
      <div id={itemsRegionId} role="group" aria-label={entry.accessibleDate} hidden={isCollapsed}>
        <Stack direction="vertical" gap="condensed">
          {entry.items.map((item) => (
            <div
              key={`${entry.dateKey}-${item.type}-${item.data.id}-${item.timestamp}`}
              className={styles.historyItemGroup}
            >
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
                isSkippingTopic={
                  item.type === 'topic' && (skippingTopicIds.has(item.data.id) || activeTopicIds.has(item.data.id))
                }
                isSkippingChallenge={
                  item.type === 'challenge' &&
                  (skippingChallengeIds.has(item.data.id) || activeChallengeIds.has(item.data.id))
                }
                isSkippingGoal={
                  item.type === 'goal' && (skippingGoalIds.has(item.data.id) || activeGoalIds.has(item.data.id))
                }
              />
              {item.type === 'challenge' && item.data.selfExplanation && (
                <details className={styles.selfExplanationDetails}>
                  <summary className={styles.selfExplanationSummary}>
                    <CommentIcon size={14} /> Your note
                  </summary>
                  <p className={styles.selfExplanationText}>{item.data.selfExplanation}</p>
                </details>
              )}
            </div>
          ))}
        </Stack>
      </div>
    </div>
  );
}
