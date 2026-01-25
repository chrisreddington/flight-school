'use client';

/**
 * FocusHistory Component V2
 *
 * Two-column layout with:
 * - Left sidebar: 52-week activity graph, search, filters, date navigation
 * - Right main: Flat card list for selected date range
 * - Click on activity day to filter to that day
 * - Stats shown in sidebar
 */

import { ChallengeCard, GoalCard, TopicCard } from '@/components/FocusItem';
import { HabitHistoryCard } from '@/components/FocusItem/HabitHistoryCard';
import { useActiveOperations } from '@/hooks/use-active-operations';
import { useAIFocus } from '@/hooks/use-ai-focus';
import { focusStore } from '@/lib/focus';
import { habitStore } from '@/lib/habits';
import { getDateKey } from '@/lib/utils/date-utils';
import type { HabitWithHistory, DailyCheckIn } from '@/lib/habits/types';
import type {
  DailyChallenge,
  DailyFocusRecord,
  DailyGoal,
  LearningTopic,
} from '@/lib/focus/types';
import type {
  StatefulChallenge,
  StatefulGoal,
  StatefulTopic,
} from '@/lib/focus/state-machine';
import {
  BookIcon,
  CalendarIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FlameIcon,
  GraphIcon,
  RocketIcon,
  SearchIcon,
  SkipIcon,
  XIcon,
} from '@primer/octicons-react';
import {
  Button,
  Flash,
  Link,
  Spinner,
  Stack,
  TextInput,
} from '@primer/react';
import { useRouter } from 'next/navigation';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLearningChat } from '@/hooks/use-learning-chat';
import styles from './FocusHistory.module.css';

// ============================================================================
// Types
// ============================================================================

type ItemStatus = 'active' | 'completed' | 'skipped';

type HistoryItem =
  | { type: 'challenge'; data: DailyChallenge; timestamp: string; status: ItemStatus; stateHistory?: StatefulChallenge['stateHistory'] }
  | { type: 'goal'; data: DailyGoal; timestamp: string; status: ItemStatus; stateHistory?: StatefulGoal['stateHistory'] }
  | { type: 'topic'; data: LearningTopic; timestamp: string; status: ItemStatus; stateHistory?: StatefulTopic['stateHistory'] }
  | { type: 'habit'; data: HabitWithHistory; timestamp: string; status: ItemStatus };

type TypeFilter = 'all' | 'challenge' | 'goal' | 'topic' | 'habit';
type StatusFilter = 'all' | 'active' | 'completed' | 'skipped';

interface HistoryEntry {
  dateKey: string;
  displayDate: string;
  items: HistoryItem[];
  totalCount: number;
  completedCount: number;
  skippedCount: number;
}

interface ActivityDay {
  date: string;
  count: number;
  weekIndex: number;
  dayOfWeek: number;
}

interface Stats {
  total: number;
  completed: number;
  skipped: number;
  active: number;
  challenges: number;
  goals: number;
  topics: number;
  habits: number;
}

// ============================================================================
// Constants
// ============================================================================

const WEEKS_TO_SHOW = 52;
const DAYS_IN_WEEK = 7;

// ============================================================================
// Utility Functions
// ============================================================================

function formatDateForDisplay(dateKey: string): string {
  const date = new Date(dateKey + 'T12:00:00');
  const today = getDateKey();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().split('T')[0];

  if (dateKey === today) return 'Today';
  if (dateKey === yesterdayKey) return 'Yesterday';

  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getItemStatus(stateHistory?: Array<{ state: string }>): ItemStatus {
  if (!stateHistory || stateHistory.length === 0) return 'active';
  const currentState = stateHistory[stateHistory.length - 1].state;
  if (currentState === 'completed' || currentState === 'explored') return 'completed';
  if (currentState === 'skipped' || currentState === 'abandoned') return 'skipped';
  return 'active';
}

function matchesSearch(item: HistoryItem, query: string): boolean {
  if (!query.trim()) return true;
  const lowerQuery = query.toLowerCase();
  
  switch (item.type) {
    case 'challenge':
      return (
        item.data.title.toLowerCase().includes(lowerQuery) ||
        item.data.description.toLowerCase().includes(lowerQuery) ||
        item.data.language?.toLowerCase().includes(lowerQuery)
      );
    case 'goal':
      return (
        item.data.title.toLowerCase().includes(lowerQuery) ||
        item.data.description.toLowerCase().includes(lowerQuery)
      );
    case 'topic':
      return (
        item.data.title.toLowerCase().includes(lowerQuery) ||
        item.data.description.toLowerCase().includes(lowerQuery) ||
        item.data.relatedTo?.toLowerCase().includes(lowerQuery)
      );
    case 'habit':
      return (
        item.data.title.toLowerCase().includes(lowerQuery) ||
        item.data.description?.toLowerCase().includes(lowerQuery)
      );
  }
}

/** Generate 52-week activity data grid */
function generate52WeekActivity(entries: HistoryEntry[]): ActivityDay[] {
  const today = new Date();
  const activity: ActivityDay[] = [];
  
  // Start from the beginning of the week, 52 weeks ago
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (WEEKS_TO_SHOW * DAYS_IN_WEEK) + 1);
  // Align to start of week (Sunday)
  startDate.setDate(startDate.getDate() - startDate.getDay());
  
  for (let week = 0; week < WEEKS_TO_SHOW; week++) {
    for (let day = 0; day < DAYS_IN_WEEK; day++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + (week * DAYS_IN_WEEK) + day);
      const dateKey = date.toISOString().split('T')[0];
      
      // Don't include future dates
      if (date > today) continue;
      
      const entry = entries.find(e => e.dateKey === dateKey);
      activity.push({
        date: dateKey,
        count: entry ? entry.items.length : 0,
        weekIndex: week,
        dayOfWeek: day,
      });
    }
  }
  
  return activity;
}

/** Group entries by month for sidebar navigation */
function groupEntriesByMonth(entries: HistoryEntry[]): Map<string, HistoryEntry[]> {
  const grouped = new Map<string, HistoryEntry[]>();
  
  entries.forEach(entry => {
    const date = new Date(entry.dateKey + 'T12:00:00');
    const monthKey = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    
    if (!grouped.has(monthKey)) {
      grouped.set(monthKey, []);
    }
    grouped.get(monthKey)!.push(entry);
  });
  
  return grouped;
}

// ============================================================================
// Sub-Components
// ============================================================================

/** 52-week contribution graph */
const ActivityGraph = memo(function ActivityGraph({ 
  activity,
  selectedDate,
  onSelectDate,
}: { 
  activity: ActivityDay[];
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const maxCount = Math.max(...activity.map(d => d.count), 1);
  
  // Auto-scroll to show most recent activity (rightmost)
  useEffect(() => {
    if (wrapperRef.current) {
      wrapperRef.current.scrollLeft = wrapperRef.current.scrollWidth;
    }
  }, []);
  
  // Group by weeks for grid layout
  const weeks: ActivityDay[][] = [];
  let currentWeek: ActivityDay[] = [];
  let lastWeekIndex = -1;
  
  activity.forEach(day => {
    if (day.weekIndex !== lastWeekIndex) {
      if (currentWeek.length > 0) weeks.push(currentWeek);
      currentWeek = [];
      lastWeekIndex = day.weekIndex;
    }
    currentWeek.push(day);
  });
  if (currentWeek.length > 0) weeks.push(currentWeek);
  
  // Month labels
  const monthLabels: { label: string; weekIndex: number }[] = [];
  let lastMonth = '';
  activity.forEach(day => {
    const date = new Date(day.date + 'T12:00:00');
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    if (month !== lastMonth && day.dayOfWeek === 0) {
      monthLabels.push({ label: month, weekIndex: day.weekIndex });
      lastMonth = month;
    }
  });
  
  return (
    <div className={styles.activityGraph}>
      <div className={styles.activityGraphHeader}>
        <GraphIcon size={16} />
        <span>Activity</span>
        {selectedDate && (
          <button 
            type="button"
            className={styles.clearSelection}
            onClick={() => onSelectDate(null)}
            aria-label="Clear date selection"
          >
            <XIcon size={12} />
            <span>Clear filter</span>
          </button>
        )}
      </div>
      
      {/* Grid - clean like GitHub, no day labels */}
      <div ref={wrapperRef} className={styles.activityGridWrapper}>
        <div className={styles.activityGrid52}>
          {weeks.map((week, weekIdx) => (
            <div key={weekIdx} className={styles.activityWeek}>
              {week.map((day) => {
                const intensity = day.count === 0 ? 0 : Math.ceil((day.count / maxCount) * 4);
                const isSelected = day.date === selectedDate;
                const isToday = day.date === getDateKey();
                
                return (
                  <button
                    key={day.date}
                    type="button"
                    className={`${styles.activityCell52} ${isSelected ? styles.activityCellSelected : ''} ${isToday ? styles.activityCellToday : ''}`}
                    data-intensity={intensity}
                    onClick={() => onSelectDate(isSelected ? null : day.date)}
                    title={`${day.date}: ${day.count} item${day.count === 1 ? '' : 's'}`}
                    aria-label={`${day.date}: ${day.count} items${isSelected ? ' (selected)' : ''}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      
      {/* Legend */}
      <div className={styles.activityLegend}>
        <span>Less</span>
        <div className={styles.activityCell52} data-intensity={0} />
        <div className={styles.activityCell52} data-intensity={1} />
        <div className={styles.activityCell52} data-intensity={2} />
        <div className={styles.activityCell52} data-intensity={3} />
        <div className={styles.activityCell52} data-intensity={4} />
        <span>More</span>
      </div>
    </div>
  );
});

/** Stats summary - simpler horizontal layout */
const StatsSummary = memo(function StatsSummary({ stats }: { stats: Stats }) {
  return (
    <div className={styles.statsSection}>
      <div className={styles.statsRow}>
        <span className={styles.statPrimary}>{stats.total} items</span>
        <span className={styles.statDivider}>·</span>
        <span className={styles.statSecondary}>
          <CheckCircleIcon size={12} /> {stats.completed} done
        </span>
        <span className={styles.statDivider}>·</span>
        <span className={styles.statSecondary}>
          <SkipIcon size={12} /> {stats.skipped} skipped
        </span>
      </div>
    </div>
  );
});

/** Date navigation in sidebar */
const DateNavigation = memo(function DateNavigation({
  groupedEntries,
  expandedMonths,
  onToggleMonth,
  selectedDate,
  onSelectDate,
}: {
  groupedEntries: Map<string, HistoryEntry[]>;
  expandedMonths: Set<string>;
  onToggleMonth: (month: string) => void;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}) {
  return (
    <div className={styles.dateNav}>
      <div className={styles.dateNavHeader}>
        <CalendarIcon size={14} />
        <span>Browse by Date</span>
      </div>
      <div className={styles.dateNavList}>
        {Array.from(groupedEntries.entries()).map(([month, entries]) => {
          const isExpanded = expandedMonths.has(month);
          const totalItems = entries.reduce((sum, e) => sum + e.items.length, 0);
          
          return (
            <div key={month} className={styles.dateNavMonth}>
              <button
                type="button"
                className={styles.dateNavMonthHeader}
                onClick={() => onToggleMonth(month)}
                aria-expanded={isExpanded}
              >
                {isExpanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
                <span>{month}</span>
                <span className={styles.dateNavCount}>{totalItems}</span>
              </button>
              
              {isExpanded && (
                <div className={styles.dateNavDays}>
                  {entries.map(entry => (
                    <button
                      key={entry.dateKey}
                      type="button"
                      className={`${styles.dateNavDay} ${selectedDate === entry.dateKey ? styles.dateNavDaySelected : ''}`}
                      onClick={() => onSelectDate(entry.dateKey)}
                    >
                      <span>{entry.displayDate}</span>
                      <span className={styles.dateNavDayCount}>{entry.items.length}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

/** Individual item card (no accordion, always full content) */
const ItemCard = memo(function ItemCard({
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
}: {
  item: HistoryItem;
  dateKey: string;
  onRefresh: () => void;
  onSkipTopic?: (topicId: string, existingTitles: string[]) => void;
  onSkipChallenge?: (challengeId: string, existingTitles: string[]) => void;
  onSkipGoal?: (goalId: string, existingTitles: string[]) => void;
  onStopSkipTopic?: (topicId: string) => void;
  onStopSkipChallenge?: (challengeId: string) => void;
  onStopSkipGoal?: (goalId: string) => void;
  onExploreTopic?: (topic: LearningTopic) => void;
  isSkippingTopic?: boolean;
  isSkippingChallenge?: boolean;
  isSkippingGoal?: boolean;
}) {
  const statusIcon = item.status === 'completed' 
    ? <CheckCircleIcon size={14} className={styles.statusCompleted} />
    : item.status === 'skipped' 
    ? <SkipIcon size={14} className={styles.statusSkipped} />
    : null;

  const typeIcon = item.type === 'challenge' 
    ? <FlameIcon size={14} />
    : item.type === 'goal' 
    ? <RocketIcon size={14} />
    : item.type === 'topic' 
    ? <BookIcon size={14} />
    : <CalendarIcon size={14} />;

  const timeStr = formatTime(item.timestamp);
  const isInactive = item.status === 'skipped';
  
  // Get item ID for scroll-to functionality
  const itemId = item.type === 'habit' ? item.data.id : item.data.id;

  return (
    <div 
      className={`${styles.itemCard} ${isInactive ? styles.itemCardInactive : ''}`}
      data-item-id={itemId}
    >
      <div className={styles.itemCardHeader}>
        <div className={styles.itemCardMeta}>
          {statusIcon}
          <span className={styles.itemCardType}>{typeIcon}</span>
          <span className={styles.itemCardTime}>{timeStr}</span>
        </div>
      </div>
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
    </div>
  );
});

/** Compact generating banner with jump links */
interface GeneratingBannerProps {
  topicIds: Set<string>;
  challengeIds: Set<string>;
  goalIds: Set<string>;
}

const GeneratingBanner = memo(function GeneratingBanner({ 
  topicIds, 
  challengeIds, 
  goalIds 
}: GeneratingBannerProps) {
  const total = topicIds.size + challengeIds.size + goalIds.size;
  if (total === 0) return null;
  
  const scrollToItem = (id: string) => {
    const element = document.querySelector(`[data-item-id="${id}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Brief highlight effect
      element.classList.add(styles.highlightItem);
      setTimeout(() => element.classList.remove(styles.highlightItem), 2000);
    }
  };
  
  // Convert Sets to arrays for rendering
  const topicIdList = Array.from(topicIds);
  const challengeIdList = Array.from(challengeIds);
  const goalIdList = Array.from(goalIds);
  
  return (
    <div className={styles.generatingBanner}>
      <Spinner size="small" />
      <span className={styles.generatingText}>
        Generating {total} item{total > 1 ? 's' : ''}...
      </span>
      <span className={styles.generatingJumpLinks}>
        {topicIdList.map((id, index) => (
          <button 
            key={id}
            className={styles.jumpLink} 
            onClick={() => scrollToItem(id)}
            type="button"
          >
            Topic {topicIdList.length > 1 ? index + 1 : ''}
          </button>
        ))}
        {challengeIdList.map((id, index) => (
          <button 
            key={id}
            className={styles.jumpLink} 
            onClick={() => scrollToItem(id)}
            type="button"
          >
            Challenge {challengeIdList.length > 1 ? index + 1 : ''}
          </button>
        ))}
        {goalIdList.map((id, index) => (
          <button 
            key={id}
            className={styles.jumpLink} 
            onClick={() => scrollToItem(id)}
            type="button"
          >
            Goal {goalIdList.length > 1 ? index + 1 : ''}
          </button>
        ))}
      </span>
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

export const FocusHistory = memo(function FocusHistory() {
  const todayDateKey = getDateKey();
  const { activeTopicIds, activeChallengeIds, activeGoalIds } = useActiveOperations();
  const router = useRouter();
  
  // Use AI focus hook for skip-and-replace operations
  const { 
    skipAndReplaceTopic,
    skipAndReplaceChallenge,
    skipAndReplaceGoal,
    skippingTopicIds,
    skippingChallengeIds,
    skippingGoalIds,
    stopTopicSkip,
    stopChallengeSkip,
    stopGoalSkip,
  } = useAIFocus();

  // Use learning chat for "Explore from History" feature
  const { createThread, sendMessage } = useLearningChat();

  // State
  const [allEntries, setAllEntries] = useState<HistoryEntry[]>([]);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  const prevActiveCountRef = useRef(activeTopicIds.size + activeChallengeIds.size + activeGoalIds.size);
  const [isLoading, setIsLoading] = useState(true);
  
  // Toast for "Explore started" notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const forceRefresh = useCallback(() => setRefreshKey(prev => prev + 1), []);
  
  // Handle "Explore" from history - creates thread, starts streaming, navigates
  const handleExploreTopic = useCallback(async (topic: LearningTopic) => {
    // Create a new thread for this topic
    const thread = await createThread({ 
      title: `Learning: ${topic.title}`,
      context: {
        learningFocus: topic.title,
      },
    }, true);
    
    // Prepare the initial explore message
    const exploreMessage = `I'd like to learn about "${topic.title}". ${topic.description} This is related to ${topic.relatedTo}. Can you help me understand this better and suggest some practical ways to learn it?`;
    
    // Start the chat (this will stream in the background)
    await sendMessage(exploreMessage, { threadId: thread.id, useGitHubTools: true });
    
    // Show toast notification
    setToastMessage(`Chat started: "${topic.title}" - View it on Dashboard`);
    
    // Auto-dismiss toast after 3 seconds
    setTimeout(() => setToastMessage(null), 3000);
    
    // Navigate to dashboard after a short delay to let the stream start
    setTimeout(() => router.push('/'), 500);
  }, [createThread, sendMessage, router]);

  // Auto-expand current month on load
  useEffect(() => {
    const currentMonth = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    setExpandedMonths(new Set([currentMonth]));
  }, []);

  // Auto-refresh when operations complete
  useEffect(() => {
    const activeCount = activeTopicIds.size + activeChallengeIds.size + activeGoalIds.size;
    if (activeCount < prevActiveCountRef.current) {
      const timer = setTimeout(forceRefresh, 500);
      prevActiveCountRef.current = activeCount;
      return () => clearTimeout(timer);
    }
    prevActiveCountRef.current = activeCount;
  }, [activeTopicIds.size, activeChallengeIds.size, activeGoalIds.size, forceRefresh]);

  // Load data
  useEffect(() => {
    let cancelled = false;
    
    const loadData = async () => {
      const rawHistory = await focusStore.getHistory();
      const habitsCollection = await habitStore.load();
      
      if (cancelled) return;

      const entries = Object.entries(rawHistory)
        .map(([dateKey, record]) => {
          const items: HistoryItem[] = [];
          const r = record as DailyFocusRecord;
          let completedCount = 0;
          let skippedCount = 0;

          // Challenges
          if (r.challenges) {
            r.challenges.forEach(c => {
              if (c.stateHistory && c.stateHistory.length > 0) {
                const status = getItemStatus(c.stateHistory);
                items.push({
                  type: 'challenge',
                  data: c.data,
                  timestamp: c.stateHistory[0].timestamp,
                  status,
                  stateHistory: c.stateHistory,
                });
                if (status === 'completed') completedCount++;
                if (status === 'skipped') skippedCount++;
              }
            });
          }

          // Goals
          if (r.goals) {
            r.goals.forEach(g => {
              if (g.stateHistory && g.stateHistory.length > 0) {
                const status = getItemStatus(g.stateHistory);
                items.push({
                  type: 'goal',
                  data: g.data,
                  timestamp: g.stateHistory[0].timestamp,
                  status,
                  stateHistory: g.stateHistory,
                });
                if (status === 'completed') completedCount++;
                if (status === 'skipped') skippedCount++;
              }
            });
          }

          // Topics
          if (r.learningTopics) {
            r.learningTopics.forEach(topicArray => {
              topicArray.forEach(t => {
                if (t.stateHistory && t.stateHistory.length > 0) {
                  const status = getItemStatus(t.stateHistory);
                  items.push({
                    type: 'topic',
                    data: t.data,
                    timestamp: t.stateHistory[0].timestamp,
                    status,
                    stateHistory: t.stateHistory,
                  });
                  if (status === 'completed') completedCount++;
                  if (status === 'skipped') skippedCount++;
                }
              });
            });
          }

          // Habits
          habitsCollection.habits.forEach((habit: HabitWithHistory) => {
            const checkInForDate = habit.checkIns.find((c: DailyCheckIn) => c.date === dateKey);
            const isActiveHabit = habit.state === 'active' || habit.state === 'not-started';

            if (checkInForDate) {
              const status: ItemStatus = checkInForDate.completed ? 'completed' : 'active';
              items.push({
                type: 'habit',
                data: habit,
                timestamp: checkInForDate.timestamp,
                status,
              });
              if (status === 'completed') completedCount++;
            } else if (dateKey === todayDateKey && isActiveHabit) {
              items.push({
                type: 'habit',
                data: habit,
                timestamp: new Date().toISOString(),
                status: 'active',
              });
            }
          });

          items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

          return {
            dateKey,
            displayDate: formatDateForDisplay(dateKey),
            items,
            totalCount: items.length,
            completedCount,
            skippedCount,
          };
        })
        .filter(entry => entry.items.length > 0)
        .sort((a, b) => b.dateKey.localeCompare(a.dateKey));

      setAllEntries(entries);
      setIsLoading(false);
    };
    
    loadData();
    return () => { cancelled = true; };
  }, [refreshKey, todayDateKey]);

  // Filter entries
  const filteredEntries = useMemo(() => {
    return allEntries
      .filter(entry => {
        // Date filter from graph or sidebar
        if (selectedDate && entry.dateKey !== selectedDate) return false;
        return true;
      })
      .map(entry => ({
        ...entry,
        items: entry.items.filter(item => {
          if (typeFilter !== 'all' && item.type !== typeFilter) return false;
          if (statusFilter !== 'all' && item.status !== statusFilter) return false;
          if (!matchesSearch(item, searchQuery)) return false;
          return true;
        }),
      }))
      .filter(entry => entry.items.length > 0 || (entry.dateKey === todayDateKey && activeTopicIds.size > 0));
  }, [allEntries, selectedDate, typeFilter, statusFilter, searchQuery, todayDateKey, activeTopicIds.size]);

  // Activity data for 52-week graph
  const activityData = useMemo(() => generate52WeekActivity(allEntries), [allEntries]);

  // Group entries by month for sidebar nav
  const groupedEntries = useMemo(() => groupEntriesByMonth(allEntries), [allEntries]);

  // Compute stats
  const stats = useMemo((): Stats => {
    const relevantEntries = selectedDate 
      ? allEntries.filter(e => e.dateKey === selectedDate)
      : allEntries;
    
    let total = 0, completed = 0, skipped = 0, active = 0;
    let challenges = 0, goals = 0, topics = 0, habits = 0;
    
    relevantEntries.forEach(entry => {
      entry.items.forEach(item => {
        total++;
        if (item.status === 'completed') completed++;
        if (item.status === 'skipped') skipped++;
        if (item.status === 'active') active++;
        if (item.type === 'challenge') challenges++;
        if (item.type === 'goal') goals++;
        if (item.type === 'topic') topics++;
        if (item.type === 'habit') habits++;
      });
    });
    
    return { total, completed, skipped, active, challenges, goals, topics, habits };
  }, [allEntries, selectedDate]);

  // Handlers
  const toggleMonth = useCallback((month: string) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  }, []);

  const handleSelectDate = useCallback((date: string | null) => {
    setSelectedDate(date);
  }, []);

  // Empty state
  if (!isLoading && allEntries.length === 0) {
    return (
      <div className={styles.containerV2}>
        <div className={styles.headerV2}>
          <CalendarIcon size={20} className={styles.headerIcon} />
          <div className={styles.headerTitleGroup}>
            <h2 className={styles.headerTitle}>Focus History</h2>
            <p className={styles.headerDescription}>Your learning journey over time</p>
          </div>
        </div>
        <div className={styles.emptyState}>
          <Flash variant="default">
            <CalendarIcon size={16} />
            <span>No focus history yet. Your daily focus will be saved here as you use the app.</span>
          </Flash>
          <div className={styles.backLink}>
            <Link href="/">← Back to Dashboard</Link>
          </div>
        </div>
      </div>
    );
  }

  const hasGenerating = (activeTopicIds.size + activeChallengeIds.size + activeGoalIds.size) > 0 
    && (!selectedDate || selectedDate === todayDateKey);

  return (
    <div className={styles.containerV2}>
      {/* Toast notification for "Explore from History" */}
      {toastMessage && (
        <div className={styles.toast}>
          <Flash variant="success">
            <Stack direction="horizontal" align="center" gap="condensed">
              <BookIcon size={16} />
              <span>{toastMessage}</span>
            </Stack>
          </Flash>
        </div>
      )}
      
      {/* Two-column layout */}
      <div className={styles.layoutV2}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          {/* Title in sidebar */}
          <div className={styles.sidebarHeader}>
            <CalendarIcon size={20} className={styles.sidebarIcon} />
            <div className={styles.sidebarTitleGroup}>
              <h2 className={styles.sidebarTitle}>Focus History</h2>
              <p className={styles.sidebarDescription}>Your learning journey</p>
            </div>
          </div>

          {/* 52-week activity graph */}
          <ActivityGraph 
            activity={activityData}
            selectedDate={selectedDate}
            onSelectDate={handleSelectDate}
          />

          {/* Stats */}
          <StatsSummary stats={stats} />

          {/* Search */}
          <div className={styles.sidebarSearch}>
            <TextInput
              leadingVisual={SearchIcon}
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              block
            />
          </div>

          {/* Filters - cleaner button group style */}
          <div className={styles.sidebarFilters}>
            <div className={styles.filterSection}>
              <span className={styles.filterLabel}>Type</span>
              <div className={styles.filterButtons}>
                <button 
                  type="button"
                  onClick={() => setTypeFilter('all')}
                  className={`${styles.filterBtn} ${typeFilter === 'all' ? styles.filterBtnActive : ''}`}
                >
                  All
                </button>
                <button 
                  type="button"
                  onClick={() => setTypeFilter('challenge')}
                  className={`${styles.filterBtn} ${typeFilter === 'challenge' ? styles.filterBtnActive : ''}`}
                >
                  <FlameIcon size={12} /> Challenges
                </button>
                <button 
                  type="button"
                  onClick={() => setTypeFilter('goal')}
                  className={`${styles.filterBtn} ${typeFilter === 'goal' ? styles.filterBtnActive : ''}`}
                >
                  <RocketIcon size={12} /> Goals
                </button>
                <button 
                  type="button"
                  onClick={() => setTypeFilter('topic')}
                  className={`${styles.filterBtn} ${typeFilter === 'topic' ? styles.filterBtnActive : ''}`}
                >
                  <BookIcon size={12} /> Topics
                </button>
                <button 
                  type="button"
                  onClick={() => setTypeFilter('habit')}
                  className={`${styles.filterBtn} ${typeFilter === 'habit' ? styles.filterBtnActive : ''}`}
                >
                  <CalendarIcon size={12} /> Habits
                </button>
              </div>
            </div>

            <div className={styles.filterSection}>
              <span className={styles.filterLabel}>Status</span>
              <div className={styles.filterButtons}>
                <button 
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={`${styles.filterBtn} ${statusFilter === 'all' ? styles.filterBtnActive : ''}`}
                >
                  All
                </button>
                <button 
                  type="button"
                  onClick={() => setStatusFilter('active')}
                  className={`${styles.filterBtn} ${statusFilter === 'active' ? styles.filterBtnActive : ''}`}
                >
                  Active
                </button>
                <button 
                  type="button"
                  onClick={() => setStatusFilter('completed')}
                  className={`${styles.filterBtn} ${statusFilter === 'completed' ? styles.filterBtnActive : ''}`}
                >
                  <CheckCircleIcon size={12} /> Done
                </button>
                <button 
                  type="button"
                  onClick={() => setStatusFilter('skipped')}
                  className={`${styles.filterBtn} ${statusFilter === 'skipped' ? styles.filterBtnActive : ''}`}
                >
                  <SkipIcon size={12} /> Skipped
                </button>
              </div>
            </div>
          </div>

          {/* Date navigation */}
          <DateNavigation
            groupedEntries={groupedEntries}
            expandedMonths={expandedMonths}
            onToggleMonth={toggleMonth}
            selectedDate={selectedDate}
            onSelectDate={(date) => setSelectedDate(date)}
          />
        </aside>

        {/* Main content */}
        <main className={styles.mainContent}>
          {isLoading ? (
            <div className={styles.loadingState}>
              <Spinner size="medium" />
              <span>Loading history...</span>
            </div>
          ) : (
            <Stack direction="vertical" gap="normal">
              {/* Selected date indicator */}
              {selectedDate && (
                <div className={styles.selectedDateBanner}>
                  <span>Showing: {formatDateForDisplay(selectedDate)}</span>
                  <Button variant="invisible" size="small" onClick={() => setSelectedDate(null)}>
                    Show all
                  </Button>
                </div>
              )}

              {/* Generating banner at top */}
              {hasGenerating && (
                <GeneratingBanner 
                  topicIds={activeTopicIds}
                  challengeIds={activeChallengeIds}
                  goalIds={activeGoalIds}
                />
              )}

              {/* Items */}
              {filteredEntries.map(entry => {
                const isToday = entry.dateKey === todayDateKey;
                return (
                  <div key={entry.dateKey} className={styles.dateSection}>
                    <div className={styles.dateSectionHeader}>
                      {isToday ? (
                        <span className={styles.todayBadge}>Today</span>
                      ) : (
                        <span className={styles.dateSectionTitle}>{entry.displayDate}</span>
                      )}
                      <span className={styles.dateSectionCount}>
                        {entry.items.length} item{entry.items.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <Stack direction="vertical" gap="condensed">
                      {entry.items.map((item, index) => (
                        <ItemCard
                          key={`${entry.dateKey}-${item.type}-${item.timestamp}-${index}`}
                          item={item}
                          dateKey={entry.dateKey}
                          onRefresh={forceRefresh}
                          onSkipTopic={skipAndReplaceTopic}
                          onSkipChallenge={skipAndReplaceChallenge}
                          onSkipGoal={skipAndReplaceGoal}
                          onStopSkipTopic={stopTopicSkip}
                          onStopSkipChallenge={stopChallengeSkip}
                          onStopSkipGoal={stopGoalSkip}
                          onExploreTopic={handleExploreTopic}
                          isSkippingTopic={item.type === 'topic' && (skippingTopicIds.has(item.data.id) || activeTopicIds.has(item.data.id))}
                          isSkippingChallenge={item.type === 'challenge' && (skippingChallengeIds.has(item.data.id) || activeChallengeIds.has(item.data.id))}
                          isSkippingGoal={item.type === 'goal' && (skippingGoalIds.has(item.data.id) || activeGoalIds.has(item.data.id))}
                        />
                      ))}
                    </Stack>
                  </div>
                );
              })}

              {/* No results */}
              {filteredEntries.length === 0 && !hasGenerating && (
                <Flash variant="default">
                  <SearchIcon size={16} />
                  <span>
                    No items match your filters.
                    {searchQuery && ` Try a different search term.`}
                  </span>
                </Flash>
              )}
            </Stack>
          )}
        </main>
      </div>
    </div>
  );
});
