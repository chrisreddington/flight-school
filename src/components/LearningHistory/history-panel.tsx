import { SearchIcon } from '@primer/octicons-react';
import { Banner, Button, Spinner, Stack } from '@primer/react';
import { Blankslate } from '@primer/react/experimental';
import { GeneratingBanner } from './generating-banner';
import { HistoryTimeline } from './history-timeline';
import type { HistoryEntry, HistoryEntryContext } from './types';
import { formatDateForDisplay } from './utils';
import styles from './LearningHistory.module.css';

interface HistoryPanelProps extends HistoryEntryContext {
  loadError: string | null;
  isLoading: boolean;
  selectedDate: string | null;
  onClearSelectedDate: () => void;
  hasGenerating: boolean;
  filteredEntries: HistoryEntry[];
  todayDateKey: string;
  collapsedDays: Set<string>;
  onToggleDayCollapse: (dateKey: string) => void;
  searchQuery: string;
}

export function HistoryPanel({
  loadError,
  isLoading,
  selectedDate,
  onClearSelectedDate,
  hasGenerating,
  filteredEntries,
  todayDateKey,
  collapsedDays,
  onToggleDayCollapse,
  searchQuery,
  ...handlers
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
          <GeneratingBanner
            topicIds={handlers.activeTopicIds}
            challengeIds={handlers.activeChallengeIds}
            goalIds={handlers.activeGoalIds}
          />
        )}

        {filteredEntries.length > 0 && (
          <HistoryTimeline
            entries={filteredEntries}
            todayDateKey={todayDateKey}
            collapsedDays={collapsedDays}
            onToggleDayCollapse={onToggleDayCollapse}
            {...handlers}
          />
        )}

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
