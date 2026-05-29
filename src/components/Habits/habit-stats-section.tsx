/**
 * Habit Stats Section Component
 *
 * Displays habit statistics in the sidebar including:
 * - Active habits count
 * - Total check-ins
 * - Current streaks
 * - Completed habits count
 */

import { FlameIcon, PlusIcon } from '@primer/octicons-react';
import { Button } from '@primer/react';
import styles from '@/app/habits/habits.module.css';
import layoutStyles from '@/styles/two-column-layout.module.css';

interface HabitStatsSectionProps {
  activeHabitsCount: number;
  totalCheckIns: number;
  currentStreaks: number;
  totalCompletions: number;
  onNewHabitClick: () => void;
}

export function HabitStatsSection({
  activeHabitsCount,
  totalCheckIns,
  currentStreaks,
  totalCompletions,
  onNewHabitClick,
}: HabitStatsSectionProps) {
  return (
    <div className={layoutStyles.sidebarCard}>
      <div className={layoutStyles.sidebarHeader}>
        <FlameIcon size={20} className={layoutStyles.sidebarIcon} />
        <p className={layoutStyles.sidebarTitle}>Habit Tracker</p>
      </div>
      <p className={layoutStyles.sidebarSubtitle}>Build lasting habits</p>

      <div className={layoutStyles.statsGrid}>
        <div className={layoutStyles.statItem}>
          <span className={layoutStyles.statValue}>{activeHabitsCount}</span>
          <span className={layoutStyles.statLabel}>Active</span>
        </div>
        <div className={layoutStyles.statItem}>
          <span className={layoutStyles.statValue}>{totalCheckIns}</span>
          <span className={layoutStyles.statLabel}>Check-ins</span>
        </div>
        <div className={layoutStyles.statItem}>
          <span className={layoutStyles.statValue}>{currentStreaks}</span>
          <span className={layoutStyles.statLabel}>Streaks</span>
        </div>
        <div className={layoutStyles.statItem}>
          <span className={layoutStyles.statValue}>{totalCompletions}</span>
          <span className={layoutStyles.statLabel}>Completed</span>
        </div>
      </div>

      {activeHabitsCount > 0 && (
        <Button
          variant="primary"
          leadingVisual={PlusIcon}
          onClick={onNewHabitClick}
          block
          className={styles.newHabitButton}
        >
          New Habit
        </Button>
      )}
    </div>
  );
}
