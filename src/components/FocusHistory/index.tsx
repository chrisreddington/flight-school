'use client';

/**
 * FocusHistory Component
 *
 * Displays a list of historical Daily Focus entries as a chronological stream.
 * Users can expand entries to see challenges, goals, and learning topics.
 *
 * @remarks
 * This component reads directly from localStorage via FocusStore.
 * It only renders on the client side.
 *
 * @example
 * ```tsx
 * <FocusHistory />
 * ```
 */

import { ChallengeCard, GoalCard, TopicCard } from '@/components/FocusItem';
import { DifficultyBadge } from '@/components/DifficultyBadge';
import { HabitHistoryCard } from '@/components/FocusItem/HabitHistoryCard';
import { focusStore } from '@/lib/focus';
import { habitStore } from '@/lib/habits';
import type { HabitWithHistory, DailyCheckIn } from '@/lib/habits/types';
import type { SkillLevel } from '@/lib/skills/types';
import type {
    DailyChallenge,
    DailyFocusRecord,
    DailyGoal,
    LearningTopic
} from '@/lib/focus/types';
import {
    BookIcon,
    CalendarIcon,
    ChevronDownIcon,
    ChevronUpIcon,
    ClockIcon,
    FlameIcon,
    RocketIcon,
} from '@primer/octicons-react';
import {
    Flash,
    Heading,
    Link,
    Stack,
    Token,
} from '@primer/react';
import { memo, useEffect, useState } from 'react';
import styles from './FocusHistory.module.css';

/**
 * Single item in the history stream.
 */
type HistoryItem =
  | { type: 'challenge'; data: DailyChallenge; timestamp: string }
  | { type: 'goal'; data: DailyGoal; timestamp: string }
  | { type: 'topics'; data: LearningTopic[]; timestamp: string }
  | { type: 'habit'; data: HabitWithHistory; timestamp: string };

type FilterType = 'all' | 'challenge' | 'goal' | 'topics' | 'habits';

/** Entry with parsed date for display */
interface HistoryEntry {
  dateKey: string;
  displayDate: string;
  items: HistoryItem[];
  versionCount: number;
  difficulty: SkillLevel; // From the most recent challenge
  language: string;   // From the most recent challenge
}

/**
 * Formats a date key (YYYY-MM-DD) for display.
 */
function formatDateForDisplay(dateKey: string): string {
  const date = new Date(dateKey + 'T12:00:00');
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Formats a timestamp to time string (e.g. "10:30 AM").
 */
function formatTime(isoString: string): string {
    return new Date(isoString).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
    });
}

// PERF: Memoize component to prevent re-renders when parent updates
export const FocusHistory = memo(function FocusHistory() {
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterType>('all');
  const [isHydrated] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Force re-render helper
  const forceRefresh = () => setRefreshKey(prev => prev + 1);

  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    if (!isHydrated) return;

    (async () => {
      const rawHistory = await focusStore.getHistory();
      const habitsCollection = await habitStore.load();
      
      const newEntries = Object.entries(rawHistory)
        .map(([dateKey, record]) => {
          // Create the stream of items
          const items: HistoryItem[] = [];
          const r = record as DailyFocusRecord;
          const versionCount = Math.max(
            r.challenges?.length ?? 0,
            r.goals?.length ?? 0,
            r.learningTopics?.length ?? 0
          );

          // 1. Challenges
          if (r.challenges) {
            r.challenges.forEach(c => {
              // Safety check for stateHistory
              if (c.stateHistory && c.stateHistory.length > 0) {
                items.push({ 
                  type: 'challenge', 
                  data: c.data, 
                  timestamp: c.stateHistory[0].timestamp 
                });
              }
            });
          }
          // 2. Goals
          if (r.goals) {
            r.goals.forEach(g => {
              // Safety check for stateHistory
              if (g.stateHistory && g.stateHistory.length > 0) {
                items.push({ 
                  type: 'goal', 
                  data: g.data, 
                  timestamp: g.stateHistory[0].timestamp 
                });
              }
            });
          }
          // 3. Topics (each array is one generation/refresh)
          if (r.learningTopics) {
            r.learningTopics.forEach(topicArray => {
              if (topicArray.length > 0 && topicArray[0].stateHistory && topicArray[0].stateHistory.length > 0) {
                items.push({ 
                  type: 'topics', 
                  data: topicArray.map(t => t.data), // Extract data from StatefulTopic[]
                  timestamp: topicArray[0].stateHistory[0].timestamp // Use first topic's timestamp
                });
              }
            });
          }

          // 4. Habits - find all habits that have check-ins on this date
          habitsCollection.habits.forEach((habit: HabitWithHistory) => {
            const checkInForDate = habit.checkIns.find((c: DailyCheckIn) => c.date === dateKey);
            if (checkInForDate) {
              items.push({
                type: 'habit',
                data: habit,
                timestamp: checkInForDate.timestamp,
              });
            }
          });

          // Sort by timestamp descending (newest first)
          items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

          // Apply filter
          const filteredItems = filter === 'all' ? items : items.filter(item => {
            if (filter === 'habits') return item.type === 'habit';
            return item.type === filter;
          });

          // Get difficulty and language from most recent challenge
          const latestChallenge = r.challenges[r.challenges.length - 1];
          const difficulty = latestChallenge?.data.difficulty || 'intermediate';
          const language = latestChallenge?.data.language || 'Mixed';

          return {
            dateKey,
            displayDate: formatDateForDisplay(dateKey),
            items: filteredItems,
            versionCount,
            difficulty,
            language,
          };
        })
        .filter(entry => entry.items.length > 0) // Omit days with no items after filtering
        .sort((a, b) => b.dateKey.localeCompare(a.dateKey)); // Sort by date descending

      setEntries(newEntries);
    })();
  }, [isHydrated, filter, refreshKey]);

  // Loading state is now derived from hydration status
  const isLoading = !isHydrated;

  /** Toggle expansion of a date entry */
  const toggleExpand = (dateKey: string) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) {
        next.delete(dateKey);
      } else {
        next.add(dateKey);
      }
      return next;
    });
  };

  if (isLoading || entries.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <CalendarIcon size={20} className={styles.headerIcon} />
            <div className={styles.headerTitleGroup}>
              <h2 className={styles.headerTitle}>Focus History</h2>
              <p className={styles.headerDescription}>
                Browse your past Daily Focus timeline
              </p>
            </div>
          </div>
        </div>

        <div className={styles.content}>
          <Flash variant="default">
            <CalendarIcon size={16} />
            <span>{isLoading ? 'Loading history...' : 'No focus history yet. Your daily focus will be saved here as you use the app.'}</span>
          </Flash>
          <div className={styles.backLink}>
            <Link href="/">← Back to Dashboard</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <CalendarIcon size={20} className={styles.headerIcon} />
          <div className={styles.headerTitleGroup}>
            <h2 className={styles.headerTitle}>Focus History</h2>
            <p className={styles.headerDescription}>
              Browse your past Daily Focus timeline
            </p>
          </div>
        </div>
        <Stack direction="horizontal" gap="condensed">
          <Token 
            text="All"
            onClick={() => setFilter('all')}
            className={filter === 'all' ? styles.activeFilter : styles.filter}
          />
          <Token 
            text="Challenges"
            leadingVisual={FlameIcon}
            onClick={() => setFilter('challenge')}
            className={filter === 'challenge' ? styles.activeFilter : styles.filter}
          />
          <Token 
            text="Goals"
            leadingVisual={RocketIcon}
            onClick={() => setFilter('goal')}
            className={filter === 'goal' ? styles.activeFilter : styles.filter}
          />
          <Token 
            text="Topics"
            leadingVisual={BookIcon}
            onClick={() => setFilter('topics')}
            className={filter === 'topics' ? styles.activeFilter : styles.filter}
          />
          <Token 
            text="Habits"
            leadingVisual={RocketIcon}
            onClick={() => setFilter('habits')}
            className={filter === 'habits' ? styles.activeFilter : styles.filter}
          />
        </Stack>
      </div>

      <div className={styles.content}>
        <Stack direction="vertical" gap="normal">
        {entries.map((entry) => {
          const isExpanded = expandedDates.has(entry.dateKey);
          const count = entry.versionCount;

          return (
            <div key={entry.dateKey} className={styles.entryCard}>
              {/* Header - always visible */}
              <button
                type="button"
                className={styles.entryHeader}
                onClick={() => toggleExpand(entry.dateKey)}
                aria-expanded={isExpanded}
                aria-controls={`entry-${entry.dateKey}`}
              >
                <Stack direction="horizontal" align="center" gap="condensed">
                  <CalendarIcon size={16} />
                  <span className={styles.dateText}>{entry.displayDate}</span>
                </Stack>
                <Stack direction="horizontal" align="center" gap="condensed">
                  <Token text={`${count} version${count === 1 ? '' : 's'}`} />
                  {entry.difficulty && (
                    <DifficultyBadge difficulty={entry.difficulty} />
                  )}
                  {entry.language !== 'Mixed' && (
                    <span className={styles.languageText}>{entry.language}</span>
                  )}
                  {isExpanded ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
                </Stack>
              </button>

              {/* Expanded content (Timeline) */}
              {isExpanded && (
                <div id={`entry-${entry.dateKey}`} className={styles.entryContent}>
                  {entry.items.map((item, index) => {
                    // Unique key combining type and timestamp
                    const key = `${item.type}-${item.timestamp}-${index}`;
                    const timeStr = formatTime(item.timestamp);
                    
                    return (
                      <div key={key} className={styles.versionBlock}>
                        <div className={styles.versionHeader}>
                             <ClockIcon size={12} /> {timeStr}
                        </div>

                        {item.type === 'challenge' && (
                          <ChallengeCard
                            challenge={item.data}
                            dateKey={entry.dateKey}
                            showHistoryActions
                            onRefresh={forceRefresh}
                            onStateChange={forceRefresh}
                          />
                        )}

                        {item.type === 'goal' && (
                          <GoalCard
                            goal={item.data}
                            dateKey={entry.dateKey}
                            showHistoryActions
                            onRefresh={forceRefresh}
                            onStateChange={forceRefresh}
                          />
                        )}

                        {item.type === 'topics' && (
                          <div className={styles.section}>
                            <Heading as="h4" className={styles.sectionTitle}>
                              <BookIcon size={16} /> Learning Topics
                            </Heading>
                            <Stack direction="vertical" gap="condensed">
                              {item.data.map((topic) => (
                                <TopicCard
                                  key={topic.id}
                                  topic={topic}
                                  dateKey={entry.dateKey}
                                  showHistoryActions
                                  onStateChange={forceRefresh}
                                />
                              ))}
                            </Stack>
                          </div>
                        )}

                        {item.type === 'habit' && (
                          <HabitHistoryCard
                            habit={item.data}
                            dateKey={entry.dateKey}
                          />
                        )}
                        
                        {index < entry.items.length - 1 && <hr className={styles.divider} />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        </Stack>
      </div>
    </div>
  );
});
