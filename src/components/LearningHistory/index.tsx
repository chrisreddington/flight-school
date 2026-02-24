'use client';

/**
 * LearningHistory Component
 *
 * Two-column layout with:
 * - Left sidebar: 52-week activity graph, search, filters, date navigation
 * - Right main: Flat card list for selected date range
 * - Click on activity day to filter to that day
 * - Stats shown in sidebar
 */

import { ProfileNav } from '@/components/ProfileNav';
import { ActivitySummary, RecentActivityList, StreakCard } from '@/components/Insights';
import { useActiveOperations } from '@/hooks/use-active-operations';
import { useAIFocus } from '@/hooks/use-ai-focus';
import { computeInsights, type LearningInsights } from '@/lib/focus/analytics';
import { focusStore } from '@/lib/focus';
import { habitStore } from '@/lib/habits';
import { getDateKey } from '@/lib/utils/date-utils';
import type { HabitWithHistory, DailyCheckIn } from '@/lib/habits/types';
import type {
  DailyFocusRecord,
  LearningTopic,
} from '@/lib/focus/types';
import {
  CalendarIcon,
} from '@primer/octicons-react';
import {
  Banner,
  Button,
  Link,
  Spinner,
  Stack,
} from '@primer/react';
import { UnderlinePanels } from '@primer/react/experimental';
import { useRouter } from 'next/navigation';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLearningChat } from '@/hooks/use-learning-chat';
import insightsStyles from '@/components/Insights/Insights.module.css';
import styles from './LearningHistory.module.css';

// Import sub-components and utilities
import { ActivityGraph } from './activity-graph';
import { GeneratingBanner } from './generating-banner';
import { HistoryEntryCard } from './history-entry-card';
import { HistoryFilters } from './history-filters';
import { DateNavigation, StatsSummary } from './sidebar-components';
import type { HistoryEntry, HistoryItem, ItemStatus, Stats, StatusFilter, TypeFilter } from './types';
import { formatDateForDisplay, generate52WeekActivity, getItemStatus, groupEntriesByMonth, matchesSearch } from './utils';

// ============================================================================
// Main Component
// ============================================================================

interface LearningHistoryProps {
  activeTab?: 'history' | 'stats';
}

export const LearningHistory = memo(function LearningHistory({ activeTab = 'history' }: LearningHistoryProps) {
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
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  const prevActiveCountRef = useRef(activeTopicIds.size + activeChallengeIds.size + activeGoalIds.size);
  const [isLoading, setIsLoading] = useState(true);
  const [insights, setInsights] = useState<LearningInsights | null>(null);
  const [totalGoalsCompleted, setTotalGoalsCompleted] = useState(0);
  
  // Toast for "Explore started" notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const forceRefresh = useCallback(() => setRefreshKey(prev => prev + 1), []);
  
  const toggleDayCollapse = useCallback((dateKey: string) => {
    setCollapsedDays(prev => {
      const next = new Set(prev);
      if (next.has(dateKey)) {
        next.delete(dateKey);
      } else {
        next.add(dateKey);
      }
      return next;
    });
  }, []);
  
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

      const computedInsights = computeInsights(rawHistory);
      let goalsCount = 0;
      for (const dateKey of Object.keys(rawHistory)) {
        const record = rawHistory[dateKey];
        for (const goal of record.goals) {
          const wasCompleted = goal.stateHistory.some(
            transition => transition.state === 'completed',
          );
          if (wasCompleted) {
            goalsCount++;
          }
        }
      }

      setAllEntries(entries);
      setInsights(computedInsights);
      setTotalGoalsCompleted(goalsCount);
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

  const handleTabSelect = useCallback((tab: 'history' | 'stats') => {
    if (tab === activeTab) return;
    router.replace(`/history?tab=${tab}`);
  }, [activeTab, router]);

  const hasNoInsightsHistory = !insights || (
    insights.totalChallengesCompleted === 0 &&
    insights.totalTopicsExplored === 0 &&
    totalGoalsCompleted === 0
  );

  // Empty state
  if (!isLoading && allEntries.length === 0) {
    return (
      <div className={styles.containerV2}>
        <div className={styles.layoutV2}>
          <aside className={styles.sidebar}>
            <ProfileNav />
            <div className={styles.sidebarHeader}>
              <CalendarIcon size={20} className={styles.sidebarIcon} />
              <div className={styles.sidebarTitleGroup}>
                <h2 className={styles.sidebarTitle}>Learning History</h2>
                <p className={styles.sidebarDescription}>Your learning journey</p>
              </div>
            </div>
          </aside>
          <div className={styles.mainContent}>
            <div className={styles.pageHeader}>
              <h1 className={styles.pageTitle}>Learning History</h1>
              <p className={styles.pageDescription}>Browse your learning journey over time</p>
            </div>
            <UnderlinePanels aria-label="Learning history tabs" className={styles.historyTabs}>
              <UnderlinePanels.Tab
                aria-selected={activeTab === 'history'}
                onSelect={() => handleTabSelect('history')}
              >
                History
              </UnderlinePanels.Tab>
              <UnderlinePanels.Tab
                aria-selected={activeTab === 'stats'}
                onSelect={() => handleTabSelect('stats')}
              >
                Stats
              </UnderlinePanels.Tab>
              <UnderlinePanels.Panel>
                <div className={styles.emptyState}>
                  <Banner
                    title="No learning history yet"
                    description="Your daily learning will be saved here as you use the app."
                    variant="info"
                    hideTitle
                  />
                  <div className={styles.backLink}>
                    <Link href="/">← Back to Dashboard</Link>
                  </div>
                </div>
              </UnderlinePanels.Panel>
              <UnderlinePanels.Panel>
                <div className={styles.emptyState}>
                  <Banner
                    title="No learning history yet"
                    description="Start exploring topics and completing challenges to see your stats here."
                    variant="info"
                    hideTitle
                  />
                  <div className={styles.backLink}>
                    <Link href="/">← Back to Dashboard</Link>
                  </div>
                </div>
              </UnderlinePanels.Panel>
            </UnderlinePanels>
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
          <Banner
            title="Success"
            description={toastMessage}
            variant="success"
            hideTitle
          />
        </div>
      )}
      
      {/* Two-column layout */}
      <div className={styles.layoutV2}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          {/* Profile Navigation */}
          <ProfileNav />

          {/* Activity & Stats Card */}
          <div className={styles.sidebarCard}>
            {/* Title in sidebar */}
            <div className={styles.sidebarHeader}>
              <CalendarIcon size={20} className={styles.sidebarIcon} />
              <div className={styles.sidebarTitleGroup}>
                <h2 className={styles.sidebarTitle}>Activity</h2>
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
          </div>

          {/* Search & Filters Card */}
          <HistoryFilters
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
          />

          {/* Date navigation */}
          <div className={styles.sidebarCard}>
            <DateNavigation
              groupedEntries={groupedEntries}
              expandedMonths={expandedMonths}
              onToggleMonth={toggleMonth}
              selectedDate={selectedDate}
              onSelectDate={(date) => setSelectedDate(date)}
            />
          </div>
        </aside>

        {/* Main content */}
        <main className={styles.mainContent}>
          {/* Page header */}
          <div className={styles.pageHeader}>
            <h1 className={styles.pageTitle}>Learning History</h1>
            <p className={styles.pageDescription}>Browse your learning journey over time</p>
          </div>

          <UnderlinePanels aria-label="Learning history tabs" className={styles.historyTabs}>
            <UnderlinePanels.Tab
              aria-selected={activeTab === 'history'}
              onSelect={() => handleTabSelect('history')}
            >
              History
            </UnderlinePanels.Tab>
            <UnderlinePanels.Tab
              aria-selected={activeTab === 'stats'}
              onSelect={() => handleTabSelect('stats')}
            >
              Stats
            </UnderlinePanels.Tab>
            <UnderlinePanels.Panel>
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
                    const isDayCollapsed = collapsedDays.has(entry.dateKey);
                    return (
                      <HistoryEntryCard
                        key={entry.dateKey}
                        entry={entry}
                        isToday={isToday}
                        isCollapsed={isDayCollapsed}
                        onToggleCollapse={() => toggleDayCollapse(entry.dateKey)}
                        onRefresh={forceRefresh}
                        onSkipTopic={skipAndReplaceTopic}
                        onSkipChallenge={skipAndReplaceChallenge}
                        onSkipGoal={skipAndReplaceGoal}
                        onStopSkipTopic={stopTopicSkip}
                        onStopSkipChallenge={stopChallengeSkip}
                        onStopSkipGoal={stopGoalSkip}
                        onExploreTopic={handleExploreTopic}
                        skippingTopicIds={skippingTopicIds}
                        skippingChallengeIds={skippingChallengeIds}
                        skippingGoalIds={skippingGoalIds}
                        activeTopicIds={activeTopicIds}
                        activeChallengeIds={activeChallengeIds}
                        activeGoalIds={activeGoalIds}
                      />
                    );
                  })}

                  {/* No results */}
                  {filteredEntries.length === 0 && !hasGenerating && (
                    <Banner
                      title="No results"
                      description={`No items match your filters.${searchQuery ? ' Try a different search term.' : ''}`}
                      variant="info"
                      hideTitle
                    />
                  )}
                </Stack>
              )}
            </UnderlinePanels.Panel>
            <UnderlinePanels.Panel>
              {isLoading ? (
                <div className={styles.loadingState}>
                  <Spinner size="medium" />
                  <span>Loading stats...</span>
                </div>
              ) : hasNoInsightsHistory || !insights ? (
                <Banner
                  title="No stats yet"
                  description="Start exploring topics and completing challenges to see your stats here."
                  variant="info"
                  hideTitle
                />
              ) : (
                <Stack direction="vertical" gap="normal" className={styles.statsTabContent}>
                  <div className={styles.statsGrid}>
                    <StreakCard
                      currentStreak={insights.currentStreak}
                      longestStreak={insights.longestStreak}
                    />
                    <ActivitySummary
                      totalChallengesCompleted={insights.totalChallengesCompleted}
                      totalTopicsExplored={insights.totalTopicsExplored}
                      totalGoalsCompleted={totalGoalsCompleted}
                    />
                  </div>

                  {insights.totalChallengesCompleted > 0 && (
                    <div className={styles.statsCard}>
                      <h2 className={styles.statsCardHeading}>Challenges by Difficulty</h2>
                      <div className={styles.difficultyList}>
                        <DifficultyRow
                          difficulty="Beginner"
                          count={insights.challengesByDifficulty.beginner}
                          total={insights.totalChallengesCompleted}
                        />
                        <DifficultyRow
                          difficulty="Intermediate"
                          count={insights.challengesByDifficulty.intermediate}
                          total={insights.totalChallengesCompleted}
                        />
                        <DifficultyRow
                          difficulty="Advanced"
                          count={insights.challengesByDifficulty.advanced}
                          total={insights.totalChallengesCompleted}
                        />
                      </div>
                    </div>
                  )}

                  {insights.totalChallengesCompleted > 0 && Object.keys(insights.challengesByLanguage).length > 0 && (
                    <div className={styles.statsCard}>
                      <h2 className={styles.statsCardHeading}>Challenges by Language</h2>
                      <div className={styles.languageList}>
                        {Object.entries(insights.challengesByLanguage)
                          .sort(([, a], [, b]) => b - a)
                          .slice(0, 5)
                          .map(([language, count]) => (
                            <div key={language} className={styles.languageRow}>
                              <span className={styles.languageName}>{language}</span>
                              <span className={styles.languageCount}>{count}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  <RecentActivityList activities={insights.recentActivity} />
                </Stack>
              )}
            </UnderlinePanels.Panel>
          </UnderlinePanels>
        </main>
      </div>
    </div>
  );
});

function DifficultyRow({ difficulty, count, total }: { difficulty: string; count: number; total: number }) {
  const percentage = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <div className={insightsStyles.difficultyRow}>
      <div className={insightsStyles.difficultyHeader}>
        <span className={insightsStyles.difficultyName}>{difficulty}</span>
        <span className={insightsStyles.difficultyStats}>
          {count} ({percentage}%)
        </span>
      </div>
      <div className={insightsStyles.difficultyProgressBar}>
        <div
          className={`${insightsStyles.difficultyProgressFill} ${getDifficultyClass(difficulty)}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function getDifficultyClass(difficulty: string): string {
  switch (difficulty.toLowerCase()) {
    case 'beginner':
      return insightsStyles.difficultyProgressBeginner;
    case 'intermediate':
      return insightsStyles.difficultyProgressIntermediate;
    case 'advanced':
      return insightsStyles.difficultyProgressAdvanced;
    default:
      return insightsStyles.difficultyProgressBeginner;
  }
}
