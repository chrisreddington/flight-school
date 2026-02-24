/**
 * Recent Activity List Component
 * 
 * Displays the most recent 7 learning activities with date and type.
 * Shows challenges completed, topics explored, and goals completed.
 */

'use client';

import { CheckIcon, BookIcon, GoalIcon } from '@primer/octicons-react';
import { Label } from '@primer/react';
import type { ActivityItem } from '@/lib/focus/analytics';
import styles from './Insights.module.css';

interface RecentActivityListProps {
  activities: ActivityItem[];
}

export function RecentActivityList({ activities }: RecentActivityListProps) {
  if (activities.length === 0) {
    return (
      <div className={styles.card}>
        <h2 className={styles.activityHeading}>Recent Activity</h2>
        <p className={styles.emptyMessage}>
          No recent activity yet. Start exploring topics and completing challenges!
        </p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <h2 className={styles.activityHeading}>Recent Activity</h2>

      <div className={styles.activityList}>
        {activities.map((activity, index) => (
          <ActivityRow key={`${activity.date}-${activity.type}-${index}`} activity={activity} />
        ))}
      </div>
    </div>
  );
}

function ActivityRow({ activity }: { activity: ActivityItem }) {
  const icon = getIconForType(activity.type);
  const typeLabel = getTypeLabelForType(activity.type);
  const formattedDate = formatDate(activity.date);

  return (
    <div className={styles.activityRow}>
      <div className={styles.activityIconWrapper}>
        {icon}
      </div>

      <div className={styles.activityContent}>
        <span className={styles.activityTitle}>{activity.title}</span>
        <div className={styles.activityMeta}>
          <Label size="small" variant={getLabelVariant(activity.type)}>
            {typeLabel}
          </Label>
          <span className={styles.activityDate}>{formattedDate}</span>
        </div>
      </div>
    </div>
  );
}

function getIconForType(type: ActivityItem['type']) {
  switch (type) {
    case 'challenge':
      return <CheckIcon size={16} />;
    case 'topic':
      return <BookIcon size={16} />;
    case 'goal':
      return <GoalIcon size={16} />;
  }
}

function getTypeLabelForType(type: ActivityItem['type']): string {
  switch (type) {
    case 'challenge':
      return 'Challenge';
    case 'topic':
      return 'Topic';
    case 'goal':
      return 'Goal';
  }
}

function getLabelVariant(type: ActivityItem['type']): 'default' | 'primary' | 'secondary' | 'accent' | 'success' | 'attention' | 'severe' | 'danger' | 'done' | 'sponsors' {
  switch (type) {
    case 'challenge':
      return 'success';
    case 'topic':
      return 'accent';
    case 'goal':
      return 'attention';
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString + 'T00:00:00');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (dateOnly.getTime() === today.getTime()) {
    return 'Today';
  } else if (dateOnly.getTime() === yesterday.getTime()) {
    return 'Yesterday';
  } else {
    // Format as "Jan 15"
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}
