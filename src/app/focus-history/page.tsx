/**
 * Focus History Page
 *
 * Dedicated page for browsing historical Daily Focus entries.
 * Displays the shared header with dynamic breadcrumbs based on navigation history.
 */

'use client';

import { AppHeader } from '@/components/AppHeader';
import { FocusHistory } from '@/components/FocusHistory';
import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import styles from './focus-history.module.css';

export default function FocusHistoryPage() {
  // Register this page in breadcrumb history
  useBreadcrumb('/focus-history', 'Focus History', '/focus-history');

  return (
    <div className={styles.root}>
      <AppHeader />

      <main className={styles.main}>
        <FocusHistory />
      </main>
    </div>
  );
}
