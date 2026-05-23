import { ProfileNav } from '@/components/ProfileNav';
import { CalendarIcon } from '@primer/octicons-react';
import { memo } from 'react';
import { ActivityGraph } from './activity-graph';
import { HistoryFilters } from './history-filters';
import { DateNavigation, StatsSummary } from './sidebar-components';
import type { ActivityDay, HistoryEntry, Stats, StatusFilter, TypeFilter } from './types';
import styles from './LearningHistory.module.css';

interface LearningHistorySidebarProps {
  activityData: ActivityDay[];
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  stats: Stats;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  typeFilter: TypeFilter;
  onTypeFilterChange: (filter: TypeFilter) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (filter: StatusFilter) => void;
  groupedEntries: Map<string, HistoryEntry[]>;
  expandedMonths: Set<string>;
  onToggleMonth: (month: string) => void;
}

export const LearningHistorySidebar = memo(function LearningHistorySidebar({
  activityData,
  selectedDate,
  onSelectDate,
  stats,
  searchQuery,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  statusFilter,
  onStatusFilterChange,
  groupedEntries,
  expandedMonths,
  onToggleMonth,
}: LearningHistorySidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <ProfileNav />

      <div className={styles.sidebarCard}>
        <div className={styles.sidebarHeader}>
          <CalendarIcon size={20} className={styles.sidebarIcon} />
          <div className={styles.sidebarTitleGroup}>
            <h2 className={styles.sidebarTitle}>Activity</h2>
            <p className={styles.sidebarDescription}>Your learning journey</p>
          </div>
        </div>

        <ActivityGraph
          activity={activityData}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
        />
        <StatsSummary stats={stats} />
      </div>

      <HistoryFilters
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        typeFilter={typeFilter}
        onTypeFilterChange={onTypeFilterChange}
        statusFilter={statusFilter}
        onStatusFilterChange={onStatusFilterChange}
      />

      <div className={styles.sidebarCard}>
        <DateNavigation
          groupedEntries={groupedEntries}
          expandedMonths={expandedMonths}
          onToggleMonth={onToggleMonth}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
        />
      </div>
    </aside>
  );
});
