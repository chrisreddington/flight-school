/**
 * Activity Summary Component
 * 
 * Displays total counts of completed challenges, explored topics, and completed goals.
 * Uses icons to make metrics scannable.
 */

'use client';

import { CheckIcon, BookIcon, GoalIcon } from '@primer/octicons-react';
import styles from './Insights.module.css';

interface ActivitySummaryProps {
  totalChallengesCompleted: number;
  totalTopicsExplored: number;
  totalGoalsCompleted: number;
}

export function ActivitySummary({
  totalChallengesCompleted,
  totalTopicsExplored,
  totalGoalsCompleted,
}: ActivitySummaryProps) {
  return (
    <div className={styles.card}>
      <h2 className={styles.summaryHeading}>Your Progress</h2>

      <div className={styles.summaryList}>
        {/* Challenges */}
        <div className={styles.summaryItem}>
          <div className={`${styles.summaryIconWrapper} ${styles.iconWrapperSuccess}`}>
            <CheckIcon size={16} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryValue}>{totalChallengesCompleted}</span>
            <span className={styles.summaryLabel}>
              {totalChallengesCompleted === 1 ? 'Challenge Completed' : 'Challenges Completed'}
            </span>
          </div>
        </div>

        {/* Topics */}
        <div className={styles.summaryItem}>
          <div className={`${styles.summaryIconWrapper} ${styles.iconWrapperAccent}`}>
            <BookIcon size={16} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryValue}>{totalTopicsExplored}</span>
            <span className={styles.summaryLabel}>
              {totalTopicsExplored === 1 ? 'Topic Explored' : 'Topics Explored'}
            </span>
          </div>
        </div>

        {/* Goals */}
        <div className={styles.summaryItem}>
          <div className={`${styles.summaryIconWrapper} ${styles.iconWrapperAttention}`}>
            <GoalIcon size={16} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryValue}>{totalGoalsCompleted}</span>
            <span className={styles.summaryLabel}>
              {totalGoalsCompleted === 1 ? 'Goal Completed' : 'Goals Completed'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
