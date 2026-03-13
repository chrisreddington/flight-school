/**
 * History Page
 *
 * Dedicated page for browsing historical learning entries.
 * Displays the shared header with dynamic breadcrumbs based on navigation history.
 */

'use client';

import { lazy, Suspense } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import { Spinner } from '@primer/react';
import { useSearchParams } from 'next/navigation';
import styles from './history.module.css';

// PERF: Code-split LearningHistory (740-line component with activity-graph,
// insights charts, and stats tabs) — deferred until route is rendered.
const LearningHistory = lazy(() =>
  import('@/components/LearningHistory').then(mod => ({ default: mod.LearningHistory }))
);

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
