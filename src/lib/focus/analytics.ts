/**
 * Focus Analytics
 * 
 * Computes insights and analytics from FocusHistory stored data.
 * Provides metrics for learning journey visualization.
 * 
 * @example
 * ```typescript
 * import { computeInsights } from '@/lib/focus/analytics';
 * 
 * const history = await focusStore.getHistory();
 * const insights = computeInsights(history);
 * console.log(`Total challenges completed: ${insights.totalChallengesCompleted}`);
 * ```
 */

import { getCurrentChallengeState, getCurrentGoalState, getCurrentTopicState } from './state-machine';
import type { FocusHistory } from './types';

/**
 * Activity item for recent activity timeline.
 */
export interface ActivityItem {
  date: string;
  type: 'challenge' | 'topic' | 'goal';
  title: string;
}

/**
 * Computed insights from focus history.
 */
export interface LearningInsights {
  /** Total number of challenges marked as completed */
  totalChallengesCompleted: number;
  /** Total number of topics marked as explored */
  totalTopicsExplored: number;
  /** Current consecutive days streak (including today) */
  currentStreak: number;
  /** Longest consecutive days streak ever achieved */
  longestStreak: number;
  /** Challenges completed by difficulty level */
  challengesByDifficulty: Record<'beginner' | 'intermediate' | 'advanced', number>;
  /** Challenges completed by programming language */
  challengesByLanguage: Record<string, number>;
  /** Total unique topics explored */
  topicsExploredCount: number;
  /** Recent activity items (last 7, newest first) */
  recentActivity: ActivityItem[];
}

/**
 * Compute insights from focus history.
 * 
 * @param history - FocusHistory from storage
 * @returns Computed learning insights
 */
export function computeInsights(history: FocusHistory): LearningInsights {
  // Initialize counters
  let totalChallengesCompleted = 0;
  let totalTopicsExplored = 0;
  const challengesByDifficulty: Record<'beginner' | 'intermediate' | 'advanced', number> = {
    beginner: 0,
    intermediate: 0,
    advanced: 0,
  };
  const challengesByLanguage: Record<string, number> = {};
  const recentActivity: ActivityItem[] = [];
  
  // Get sorted date keys (newest first for recent activity, oldest first for streaks)
  const dateKeys = Object.keys(history).sort();
  const dateKeysDescending = [...dateKeys].reverse();
  
  // Track dates with activity for streak calculation
  const datesWithActivity = new Set<string>();

  // Process each day's history
  for (const dateKey of dateKeys) {
    const record = history[dateKey];
    let hasActivityThisDay = false;

    // Process challenges
    for (const statefulChallenge of record.challenges) {
      const currentState = getCurrentChallengeState(statefulChallenge);
      
      // Check if this challenge was completed
      const wasCompleted = statefulChallenge.stateHistory.some(
        transition => transition.state === 'completed'
      );
      
      if (wasCompleted) {
        totalChallengesCompleted++;
        hasActivityThisDay = true;
        
        // Count by difficulty
        const difficulty = statefulChallenge.data.difficulty;
        challengesByDifficulty[difficulty]++;
        
        // Count by language
        const language = statefulChallenge.data.language;
        challengesByLanguage[language] = (challengesByLanguage[language] || 0) + 1;
        
        // Add to recent activity
        recentActivity.push({
          date: dateKey,
          type: 'challenge',
          title: statefulChallenge.data.title,
        });
      }
    }

    // Process goals
    for (const statefulGoal of record.goals) {
      const wasCompleted = statefulGoal.stateHistory.some(
        transition => transition.state === 'completed'
      );
      
      if (wasCompleted) {
        hasActivityThisDay = true;
        
        // Add to recent activity
        recentActivity.push({
          date: dateKey,
          type: 'goal',
          title: statefulGoal.data.title,
        });
      }
    }

    // Process topics (flatten the nested arrays)
    for (const topicArray of record.learningTopics) {
      for (const statefulTopic of topicArray) {
        const wasExplored = statefulTopic.stateHistory.some(
          transition => transition.state === 'explored'
        );
        
        if (wasExplored) {
          totalTopicsExplored++;
          hasActivityThisDay = true;
          
          // Add to recent activity
          recentActivity.push({
            date: dateKey,
            type: 'topic',
            title: statefulTopic.data.title,
          });
        }
      }
    }

    // Mark this date as having activity
    if (hasActivityThisDay) {
      datesWithActivity.add(dateKey);
    }
  }

  // Calculate streaks
  const { currentStreak, longestStreak } = calculateStreaks(datesWithActivity, dateKeys);

  // Get recent activity (last 7 items, newest first)
  const sortedRecentActivity = recentActivity
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7);

  return {
    totalChallengesCompleted,
    totalTopicsExplored,
    currentStreak,
    longestStreak,
    challengesByDifficulty,
    challengesByLanguage,
    topicsExploredCount: totalTopicsExplored,
    recentActivity: sortedRecentActivity,
  };
}

/**
 * Calculate current and longest streaks from dates with activity.
 * 
 * @param datesWithActivity - Set of date keys that had activity
 * @param dateKeys - Sorted array of all date keys (oldest first)
 * @returns Current and longest streaks
 */
function calculateStreaks(
  datesWithActivity: Set<string>,
  dateKeys: string[]
): { currentStreak: number; longestStreak: number } {
  if (datesWithActivity.size === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  // Get today's date key
  const today = new Date();
  const todayKey = today.toISOString().split('T')[0];
  
  // Calculate current streak (counting backwards from today)
  let currentStreak = 0;
  const checkDate = new Date(today);
  
  while (true) {
    const dateKey = checkDate.toISOString().split('T')[0];
    
    if (datesWithActivity.has(dateKey)) {
      currentStreak++;
      // Move to previous day
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      // Streak broken
      break;
    }
  }

  // Calculate longest streak (iterate through all dates)
  let longestStreak = 0;
  let tempStreak = 0;
  let previousDate: Date | null = null;

  const sortedActivityDates = Array.from(datesWithActivity).sort();
  
  for (const dateKey of sortedActivityDates) {
    const currentDate = new Date(dateKey + 'T00:00:00');
    
    if (previousDate) {
      // Check if this date is consecutive to previous
      const daysDiff = Math.floor(
        (currentDate.getTime() - previousDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      if (daysDiff === 1) {
        // Consecutive day
        tempStreak++;
      } else {
        // Gap in streak
        longestStreak = Math.max(longestStreak, tempStreak);
        tempStreak = 1;
      }
    } else {
      // First date
      tempStreak = 1;
    }
    
    previousDate = currentDate;
  }
  
  // Check final streak
  longestStreak = Math.max(longestStreak, tempStreak);

  return { currentStreak, longestStreak };
}
