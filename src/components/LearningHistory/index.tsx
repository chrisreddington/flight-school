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
import { useActiveOperations } from '@/hooks/use-active-operations';
import { useAIFocus } from '@/hooks/use-ai-focus';
import { computeInsights, type LearningInsights } from '@/lib/focus/analytics';
import { focusStore } from '@/lib/focus';
import { habitStore } from '@/lib/habits';
import { getDateKey } from '@/lib/utils/date-utils';
import type { LearningTopic } from '@/lib/focus/types';
import {
  CalendarIcon,
} from '@primer/octicons-react';
import {
  Banner,
  Link,
} from '@primer/react';
import { UnderlinePanels } from '@primer/react/experimental';
import { useRouter } from 'next/navigation';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLearningChat } from '@/hooks/use-learning-chat';
import { logger } from '@/lib/logger';
import styles from './LearningHistory.module.css';

import { HistoryPanel } from './history-panel';
import { LearningHistorySidebar } from './learning-history-sidebar';
import { StatsPanel } from './stats-panel';
import type { HistoryEntry, StatusFilter, TypeFilter } from './types';
import {
  buildHistoryEntries,
  buildLearningHistoryViewModel,
  countCompletedGoals,
} from './use-learning-history-view-model';

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
  const [loadError, setLoadError] = useState<string | null>(null);
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
    try {
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
    } catch {
      setToastMessage('Failed to start chat. Please try again.');
    }
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
      try {
        setLoadError(null);
        const rawHistory = await focusStore.getHistory();
        const habitsCollection = await habitStore.load();
        
        if (cancelled) return;

        const entries = buildHistoryEntries(rawHistory, habitsCollection, todayDateKey);
        const computedInsights = computeInsights(rawHistory);
        const goalsCount = countCompletedGoals(rawHistory);

        setAllEntries(entries);
        setInsights(computedInsights);
        setTotalGoalsCompleted(goalsCount);
      } catch (error) {
        logger.error('Failed to load learning history', { error });
        setLoadError('Failed to load your learning history. Please refresh to try again.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    
    loadData();
    return () => { cancelled = true; };
  }, [refreshKey, todayDateKey]);

  const {
    activityData,
    filteredEntries,
    groupedEntries,
    hasNoInsightsHistory,
    stats,
  } = useMemo(() => buildLearningHistoryViewModel({
    entries: allEntries,
    selectedDate,
    typeFilter,
    statusFilter,
    searchQuery,
    todayDateKey,
    activeTopicCount: activeTopicIds.size,
    insights,
    totalGoalsCompleted,
  }), [
    allEntries,
    selectedDate,
    typeFilter,
    statusFilter,
    searchQuery,
    todayDateKey,
    activeTopicIds.size,
    insights,
    totalGoalsCompleted,
  ]);

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
                {loadError && (
                  <Banner
                    title="Failed to load history"
                    description={loadError}
                    variant="critical"
                  />
                )}
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
                {loadError && (
                  <Banner
                    title="Failed to load history"
                    description={loadError}
                    variant="critical"
                  />
                )}
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
        <LearningHistorySidebar
          activityData={activityData}
          selectedDate={selectedDate}
          onSelectDate={handleSelectDate}
          stats={stats}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          groupedEntries={groupedEntries}
          expandedMonths={expandedMonths}
          onToggleMonth={toggleMonth}
        />

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
              <HistoryPanel
                loadError={loadError}
                isLoading={isLoading}
                selectedDate={selectedDate}
                onClearSelectedDate={() => setSelectedDate(null)}
                hasGenerating={hasGenerating}
                activeTopicIds={activeTopicIds}
                activeChallengeIds={activeChallengeIds}
                activeGoalIds={activeGoalIds}
                filteredEntries={filteredEntries}
                todayDateKey={todayDateKey}
                collapsedDays={collapsedDays}
                onToggleDayCollapse={toggleDayCollapse}
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
                searchQuery={searchQuery}
              />
            </UnderlinePanels.Panel>
            <UnderlinePanels.Panel>
              <StatsPanel
                loadError={loadError}
                isLoading={isLoading}
                hasNoInsightsHistory={hasNoInsightsHistory}
                insights={insights}
                totalGoalsCompleted={totalGoalsCompleted}
              />
            </UnderlinePanels.Panel>
          </UnderlinePanels>
        </main>
      </div>
    </div>
  );
});
