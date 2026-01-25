/**
 * Learning History Page
 *
 * Dedicated page for browsing historical learning entries.
 * Displays the shared header with dynamic breadcrumbs based on navigation history.
 */

'use client';

import { AppHeader } from '@/components/AppHeader';
import { LearningHistory } from '@/components/LearningHistory';
import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import styles from './learning-history.module.css';

export default function LearningHistoryPage() {
  // Register this page in breadcrumb history
  useBreadcrumb('/learning-history', 'Learning History', '/learning-history');

  return (
    <div className={styles.root}>
      <AppHeader />

      <main className={styles.main}>
        <LearningHistory />
      </main>
    </div>
  );
}
