/**
 * Sidebar Components
 *
 * StatsSummary and DateNavigation components for the LearningHistory sidebar.
 */

'use client';

import {
  CalendarIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  SkipIcon,
} from '@primer/octicons-react';
import { memo } from 'react';
import type { HistoryEntry, Stats } from './types';
import styles from './LearningHistory.module.css';

interface StatsSummaryProps {
  stats: Stats;
}

/** Stats summary - simpler horizontal layout */
export const StatsSummary = memo(function StatsSummary({ stats }: StatsSummaryProps) {
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

interface DateNavigationProps {
  groupedEntries: Map<string, HistoryEntry[]>;
  expandedMonths: Set<string>;
  onToggleMonth: (month: string) => void;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}

/** Date navigation in sidebar */
export const DateNavigation = memo(function DateNavigation({
  groupedEntries,
  expandedMonths,
  onToggleMonth,
  selectedDate,
  onSelectDate,
}: DateNavigationProps) {
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
