/**
 * HistoryFilters Component
 *
 * Provides search and filter controls for the Learning History page.
 * Includes search input and type/status filter buttons.
 */

import {
  BookIcon,
  CalendarIcon,
  CheckCircleIcon,
  CheckIcon,
  CodeIcon,
  SearchIcon,
  SkipIcon,
} from '@primer/octicons-react';
import { TextInput } from '@primer/react';
import styles from './LearningHistory.module.css';
import type { StatusFilter, TypeFilter } from './types';

interface HistoryFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  typeFilter: TypeFilter;
  onTypeFilterChange: (filter: TypeFilter) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (filter: StatusFilter) => void;
}

export function HistoryFilters({
  searchQuery,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  statusFilter,
  onStatusFilterChange,
}: HistoryFiltersProps) {
  return (
    <div className={styles.sidebarCard}>
      {/* Search */}
      <div className={styles.sidebarSearch}>
        <TextInput
          leadingVisual={SearchIcon}
          placeholder="Search..."
          aria-label="Search history"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          block
        />
      </div>

      {/* Filters - cleaner button group style */}
      <div className={styles.sidebarFilters}>
        <div className={styles.filterSection}>
          <span className={styles.filterLabel}>Type</span>
          <div className={styles.filterButtons}>
            <button
              type="button"
              onClick={() => onTypeFilterChange('all')}
              className={`${styles.filterBtn} ${typeFilter === 'all' ? styles.filterBtnActive : ''}`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => onTypeFilterChange('challenge')}
              className={`${styles.filterBtn} ${typeFilter === 'challenge' ? styles.filterBtnActive : ''}`}
            >
              <CodeIcon size={12} /> Challenges
            </button>
            <button
              type="button"
              onClick={() => onTypeFilterChange('goal')}
              className={`${styles.filterBtn} ${typeFilter === 'goal' ? styles.filterBtnActive : ''}`}
            >
              <CheckIcon size={12} /> Goals
            </button>
            <button
              type="button"
              onClick={() => onTypeFilterChange('topic')}
              className={`${styles.filterBtn} ${typeFilter === 'topic' ? styles.filterBtnActive : ''}`}
            >
              <BookIcon size={12} /> Topics
            </button>
            <button
              type="button"
              onClick={() => onTypeFilterChange('habit')}
              className={`${styles.filterBtn} ${typeFilter === 'habit' ? styles.filterBtnActive : ''}`}
            >
              <CalendarIcon size={12} /> Habits
            </button>
          </div>
        </div>

        <div className={styles.filterSection}>
          <span className={styles.filterLabel}>Status</span>
          <div className={styles.filterButtons}>
            <button
              type="button"
              onClick={() => onStatusFilterChange('all')}
              className={`${styles.filterBtn} ${statusFilter === 'all' ? styles.filterBtnActive : ''}`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => onStatusFilterChange('active')}
              className={`${styles.filterBtn} ${statusFilter === 'active' ? styles.filterBtnActive : ''}`}
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => onStatusFilterChange('completed')}
              className={`${styles.filterBtn} ${statusFilter === 'completed' ? styles.filterBtnActive : ''}`}
            >
              <CheckCircleIcon size={12} /> Done
            </button>
            <button
              type="button"
              onClick={() => onStatusFilterChange('skipped')}
              className={`${styles.filterBtn} ${statusFilter === 'skipped' ? styles.filterBtnActive : ''}`}
            >
              <SkipIcon size={12} /> Skipped
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
