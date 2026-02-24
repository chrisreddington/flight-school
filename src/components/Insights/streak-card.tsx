/**
 * Streak Card Component
 * 
 * Displays current and longest learning streaks with flame icon.
 * Shows consecutive days of activity (challenges completed or topics explored).
 */

'use client';

import { FlameIcon } from '@primer/octicons-react';
import styles from './Insights.module.css';

interface StreakCardProps {
  currentStreak: number;
  longestStreak: number;
}

export function StreakCard({ currentStreak, longestStreak }: StreakCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.streakHeader}>
        <div className={styles.streakIcon}>
          <FlameIcon size={24} />
        </div>
        <h2 className={styles.streakHeading}>Learning Streak</h2>
      </div>

      <div className={styles.streakMetrics}>
        <div className={styles.streakMetric}>
          <span className={`${styles.streakValue} ${currentStreak > 0 ? styles.streakValueActive : styles.streakValueInactive}`}>
            {currentStreak}
          </span>
          <span className={styles.streakLabel}>Current Streak</span>
        </div>

        <div className={styles.streakMetric}>
          <span className={styles.streakValue}>
            {longestStreak}
          </span>
          <span className={styles.streakLabel}>Longest Streak</span>
        </div>
      </div>

      {currentStreak > 0 && (
        <p className={styles.streakMessage}>
          Keep it up! {currentStreak === 1 ? "You're building a habit" : `${currentStreak} days in a row`}
        </p>
      )}
    </div>
  );
}
