import type { LearningTopic } from '@/lib/focus/types';
import { SearchIcon } from '@primer/octicons-react';
import { Banner, Button, Spinner, Stack } from '@primer/react';
import { Blankslate } from '@primer/react/experimental';
import { GeneratingBanner } from './generating-banner';
import { HistoryEntryCard } from './history-entry-card';
import type { HistoryEntry } from './types';
import { formatDateForDisplay } from './utils';
import styles from './LearningHistory.module.css';

interface HistoryPanelProps {
  loadError: string | null;
  isLoading: boolean;
  selectedDate: string | null;
  onClearSelectedDate: () => void;
  hasGenerating: boolean;
  activeTopicIds: Set<string>;
  activeChallengeIds: Set<string>;
  activeGoalIds: Set<string>;
  filteredEntries: HistoryEntry[];
  todayDateKey: string;
  collapsedDays: Set<string>;
  onToggleDayCollapse: (dateKey: string) => void;
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
  searchQuery: string;
}

export function HistoryPanel({
  loadError,
  isLoading,
  selectedDate,
  onClearSelectedDate,
  hasGenerating,
  activeTopicIds,
  activeChallengeIds,
  activeGoalIds,
  filteredEntries,
  todayDateKey,
  collapsedDays,
  onToggleDayCollapse,
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
  searchQuery,
}: HistoryPanelProps) {
  if (isLoading) {
    return (
      <div className={styles.loadingState}>
        <Spinner size="medium" />
        <span>Loading history...</span>
      </div>
    );
  }

  return (
    <>
      {loadError && <Banner title="Failed to load history" description={loadError} variant="critical" />}
      <Stack direction="vertical" gap="normal">
        {selectedDate && (
          <div className={styles.selectedDateBanner}>
            <span>Showing: {formatDateForDisplay(selectedDate)}</span>
            <Button variant="invisible" size="small" onClick={onClearSelectedDate}>
              Show all
            </Button>
          </div>
        )}

        {hasGenerating && (
          <GeneratingBanner topicIds={activeTopicIds} challengeIds={activeChallengeIds} goalIds={activeGoalIds} />
        )}

        {filteredEntries.map((entry) => (
          <HistoryEntryCard
            key={entry.dateKey}
            entry={entry}
            isToday={entry.dateKey === todayDateKey}
            isCollapsed={collapsedDays.has(entry.dateKey)}
            onToggleCollapse={() => onToggleDayCollapse(entry.dateKey)}
            onRefresh={onRefresh}
            onSkipTopic={onSkipTopic}
            onSkipChallenge={onSkipChallenge}
            onSkipGoal={onSkipGoal}
            onStopSkipTopic={onStopSkipTopic}
            onStopSkipChallenge={onStopSkipChallenge}
            onStopSkipGoal={onStopSkipGoal}
            onExploreTopic={onExploreTopic}
            skippingTopicIds={skippingTopicIds}
            skippingChallengeIds={skippingChallengeIds}
            skippingGoalIds={skippingGoalIds}
            activeTopicIds={activeTopicIds}
            activeChallengeIds={activeChallengeIds}
            activeGoalIds={activeGoalIds}
          />
        ))}

        {filteredEntries.length === 0 && !hasGenerating && (
          <Blankslate>
            <Blankslate.Visual>
              <SearchIcon size={24} />
            </Blankslate.Visual>
            <Blankslate.Heading>No results</Blankslate.Heading>
            <Blankslate.Description>
              No items match your filters.{searchQuery ? ' Try a different search term.' : ''}
            </Blankslate.Description>
          </Blankslate>
        )}
      </Stack>
    </>
  );
}
