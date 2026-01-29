/**
 * Focus Base Types
 *
 * Core type definitions for Daily Focus items.
 * These types are shared between the state machine and storage layers.
 *
 * @remarks
 * Extracted to break circular dependency between types.ts and state-machine.ts.
 */

export interface DailyChallenge {
  id: string;
  title: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  language: string;
  estimatedTime: string;
  whyThisChallenge: string[];
  /** Completion status */
  status?: 'completed' | 'skipped' | 'in-progress' | 'pending';
  /** ISO timestamp when completed/skipped */
  statusChangedAt?: string;
  /** Related thread ID if user explored this challenge */
  relatedThreadId?: string;
  /**
   * Whether this is a user-authored custom challenge.
   *
   * @remarks
   * Custom challenges take priority in the daily challenge slot.
   * When true, the challenge was created via the authoring flow
   * and is stored in the custom queue rather than generated daily.
   */
  isCustom?: boolean;
}

export interface DailyGoal {
  id: string;
  title: string;
  description: string;
  progress: number;
  target: string;
  reasoning: string;
  /** Completion status */
  status?: 'completed' | 'in-progress' | 'pending';
  /** ISO timestamp when status changed */
  statusChangedAt?: string;
  /** Related thread ID if user worked on this goal */
  relatedThreadId?: string;
  /** Whether a repo was created for this goal */
  repoCreated?: boolean;
  /** Repository name if created */
  repoName?: string;
}

export interface LearningTopic {
  id: string;
  title: string;
  description: string;
  type: 'concept' | 'pattern' | 'best-practice';
  relatedTo: string;
  /** Whether user has explored this topic */
  explored?: boolean;
  /** ISO timestamp when explored */
  exploredAt?: string;
  /** Related thread ID if user explored this topic */
  relatedThreadId?: string;
  /** ID of the topic that replaced this one (when user clicked "New" on explored topic) */
  replacedByTopicId?: string;
}
