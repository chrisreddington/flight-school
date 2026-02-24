/**
 * History Page
 *
 * Dedicated page for browsing historical learning entries.
 * Displays the shared header with dynamic breadcrumbs based on navigation history.
 */

'use client';

import { Suspense } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { LearningHistory } from '@/components/LearningHistory';
import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import { Spinner } from '@primer/react';
import { useSearchParams } from 'next/navigation';
import styles from './history.module.css';

function HistoryPageContent() {
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') === 'stats' ? 'stats' : 'history';

  return <LearningHistory activeTab={activeTab} />;
}

export default function HistoryPage() {
  // Register this page in breadcrumb history
  useBreadcrumb('/history', 'History', '/history');

  return (
    <div className={styles.root}>
      <AppHeader />

      <main className={styles.main}>
        <Suspense
          fallback={(
            <div className={styles.loadingState}>
              <Spinner size="large" />
            </div>
          )}
        >
          <HistoryPageContent />
        </Suspense>
      </main>
    </div>
  );
}
