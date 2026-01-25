/**
 * ActivityGraph Component
 *
 * 52-week contribution graph similar to GitHub's activity graph.
 */

'use client';

import { getDateKey } from '@/lib/utils/date-utils';
import { GraphIcon, XIcon } from '@primer/octicons-react';
import { memo, useEffect, useRef } from 'react';
import type { ActivityDay } from './types';
import styles from './LearningHistory.module.css';

interface ActivityGraphProps {
  activity: ActivityDay[];
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
}

/** 52-week contribution graph */
export const ActivityGraph = memo(function ActivityGraph({ 
  activity,
  selectedDate,
  onSelectDate,
}: ActivityGraphProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const maxCount = Math.max(...activity.map(d => d.count), 1);
  
  // Auto-scroll to show most recent activity (rightmost)
  useEffect(() => {
    if (wrapperRef.current) {
      wrapperRef.current.scrollLeft = wrapperRef.current.scrollWidth;
    }
  }, []);
  
  // Group by weeks for grid layout
  const weeks: ActivityDay[][] = [];
  let currentWeek: ActivityDay[] = [];
  let lastWeekIndex = -1;
  
  activity.forEach(day => {
    if (day.weekIndex !== lastWeekIndex) {
      if (currentWeek.length > 0) weeks.push(currentWeek);
      currentWeek = [];
      lastWeekIndex = day.weekIndex;
    }
    currentWeek.push(day);
  });
  if (currentWeek.length > 0) weeks.push(currentWeek);
  
  return (
    <div className={styles.activityGraph}>
      <div className={styles.activityGraphHeader}>
        <GraphIcon size={16} />
        <span>Activity</span>
        {selectedDate && (
          <button 
            type="button"
            className={styles.clearSelection}
            onClick={() => onSelectDate(null)}
            aria-label="Clear date selection"
          >
            <XIcon size={12} />
            <span>Clear filter</span>
          </button>
        )}
      </div>
      
      {/* Grid - clean like GitHub, no day labels */}
      <div ref={wrapperRef} className={styles.activityGridWrapper}>
        <div className={styles.activityGrid52}>
          {weeks.map((week, weekIdx) => (
            <div key={weekIdx} className={styles.activityWeek}>
              {week.map((day) => {
                const intensity = day.count === 0 ? 0 : Math.ceil((day.count / maxCount) * 4);
                const isSelected = day.date === selectedDate;
                const isToday = day.date === getDateKey();
                
                return (
                  <button
                    key={day.date}
                    type="button"
                    className={`${styles.activityCell52} ${isSelected ? styles.activityCellSelected : ''} ${isToday ? styles.activityCellToday : ''}`}
                    data-intensity={intensity}
                    onClick={() => onSelectDate(isSelected ? null : day.date)}
                    title={`${day.date}: ${day.count} item${day.count === 1 ? '' : 's'}`}
                    aria-label={`${day.date}: ${day.count} items${isSelected ? ' (selected)' : ''}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      
      {/* Legend */}
      <div className={styles.activityLegend}>
        <span>Less</span>
        <div className={styles.activityCell52} data-intensity={0} />
        <div className={styles.activityCell52} data-intensity={1} />
        <div className={styles.activityCell52} data-intensity={2} />
        <div className={styles.activityCell52} data-intensity={3} />
        <div className={styles.activityCell52} data-intensity={4} />
        <span>More</span>
      </div>
    </div>
  );
});
