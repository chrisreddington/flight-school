'use client';

/**
 * Minimized floating badge showing activity count
 */

import { CounterLabel } from '@primer/react';
import styles from './AIActivityPanel.module.css';

interface ActivityBadgeProps {
  count: number;
  pendingCount: number;
  onClick: () => void;
}

export function ActivityBadge({ count, pendingCount, onClick }: ActivityBadgeProps) {
  return (
    <button onClick={onClick} className={styles.activityBadge}>
      <span>🔍</span>
      <span className={styles.activityBadgeTitle}>AI Activity</span>
      <CounterLabel>{count}</CounterLabel>
      {pendingCount > 0 && <span className={styles.pendingIndicator} />}
    </button>
  );
}
