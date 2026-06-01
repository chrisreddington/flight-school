/**
 * LearningHistory Types
 *
 * Type definitions for the LearningHistory component and its sub-components.
 */

import type { HabitWithHistory } from '@/lib/habits/types';
import type { DailyChallenge, DailyGoal, LearningTopic } from '@/lib/focus/types';
import type { StatefulChallenge, StatefulGoal, StatefulTopic } from '@/lib/focus/state-machine';

export type ItemStatus = 'active' | 'completed' | 'skipped';

export type HistoryItem =
  | {
      type: 'challenge';
      data: DailyChallenge;
      timestamp: string;
      status: ItemStatus;
      stateHistory?: StatefulChallenge['stateHistory'];
    }
  | {
      type: 'goal';
      data: DailyGoal;
      timestamp: string;
      status: ItemStatus;
      stateHistory?: StatefulGoal['stateHistory'];
    }
  | {
      type: 'topic';
      data: LearningTopic;
      timestamp: string;
      status: ItemStatus;
      stateHistory?: StatefulTopic['stateHistory'];
    }
  | { type: 'habit'; data: HabitWithHistory; timestamp: string; status: ItemStatus };

export type TypeFilter = 'all' | 'challenge' | 'goal' | 'topic' | 'habit';
export type StatusFilter = 'all' | 'active' | 'completed' | 'skipped';

export interface HistoryEntry {
  dateKey: string;
  displayDate: string;
  items: HistoryItem[];
  totalCount: number;
  completedCount: number;
  skippedCount: number;
}

/**
 * Per-entry handlers and live-operation sets shared by every day in the feed.
 * Owning this contract in one neutral module lets the panel, the Timeline
 * wrapper, and the day card extend a single prop shape, so adding a handler is
 * a one-line change here instead of three parallel edits.
 */
export interface HistoryEntryHandlers {
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

export interface ActivityDay {
  date: string;
  count: number;
  weekIndex: number;
  dayOfWeek: number;
}

export interface Stats {
  total: number;
  completed: number;
  skipped: number;
  active: number;
  challenges: number;
  goals: number;
  topics: number;
  habits: number;
}
