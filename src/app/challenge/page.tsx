/**
 * Challenge Page
 *
 * Dedicated page for the challenge sandbox experience.
 * Displays the shared header with dynamic breadcrumbs based on navigation history.
 */

'use client';

import { AppHeader } from '@/components/AppHeader';
import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import type { ChallengeDef } from '@/lib/copilot/types';
import { useSearchParams } from 'next/navigation';
import { lazy, Suspense, useEffect, useMemo } from 'react';
import styles from './challenge.module.css';

// PERF: Code split ChallengeSandbox (includes Monaco Editor ~200KB)
const ChallengeSandbox = lazy(() => 
  import('@/components/ChallengeSandbox').then(mod => ({ default: mod.ChallengeSandbox }))
);

/** Default challenge when none provided */
const DEFAULT_CHALLENGE: ChallengeDef = {
  title: 'Practice Challenge',
  description: 'Write a solution to the coding challenge.',
  language: 'TypeScript',
  difficulty: 'beginner',
  testCases: [],
};

/**
 * PERF: Preload Monaco Editor during idle time to reduce perceived load
 * This kicks off the ~2MB download before user interacts with editor
 */
function useMonacoPreload() {
  useEffect(() => {
    // Use requestIdleCallback to avoid blocking initial render
    const preload = () => {
      // Dynamically import Monaco to warm the cache
      import('@monaco-editor/react').catch(() => {
        // Silently fail - editor will load on demand anyway
      });
    };

    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(preload, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    } else {
      // Fallback for browsers without requestIdleCallback
      const id = setTimeout(preload, 100);
      return () => clearTimeout(id);
    }
  }, []);
}

/**
 * Inner component that uses useSearchParams (must be wrapped in Suspense)
 */
function ChallengePageContent() {
  const searchParams = useSearchParams();
  
  // PERF: Start loading Monaco early during idle time
  useMonacoPreload();

  // Parse challenge from URL params
  const { challengeId, challenge } = useMemo((): { challengeId: string; challenge: ChallengeDef } => {
    const title = searchParams.get('title');
    const description = searchParams.get('description');
    const language = searchParams.get('language');
    const difficulty = searchParams.get('difficulty') as ChallengeDef['difficulty'];

    if (!title) {
      return {
        challengeId: 'default-challenge',
        challenge: DEFAULT_CHALLENGE,
      };
    }

    // Generate a stable ID from the challenge parameters
    const id = `challenge-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)}`;

    return {
      challengeId: id,
      challenge: {
        title: decodeURIComponent(title),
        description: description ? decodeURIComponent(description) : '',
        language: language ? decodeURIComponent(language) : 'TypeScript',
        difficulty: difficulty || 'beginner',
        testCases: [],
      },
    };
  }, [searchParams]);

  // Register this page in breadcrumb history
  // Memoize the href to avoid re-registrations on unrelated changes
  const breadcrumbHref = useMemo(() => {
    const params = new URLSearchParams();
    searchParams.forEach((value, key) => {
      params.set(key, value);
    });
    return `/challenge?${params.toString()}`;
  }, [searchParams]);

  useBreadcrumb('/challenge', challenge.title, breadcrumbHref);

  // Handle completion
  const handleComplete = () => {
    // Challenge completion handling
    // User will be redirected to dashboard to see completion status
  };

  return (
    <div className={styles.root}>
      <AppHeader />

      <main className={styles.main}>
        <ChallengeSandbox
          challengeId={challengeId}
          challenge={challenge}
          onComplete={handleComplete}
          autoFocus
        />
      </main>
    </div>
  );
}

/**
 * Challenge page component.
 *
 * Reads challenge details from URL search params and renders
 * the full-page sandbox experience.
 */
export default function ChallengePage() {
  return (
    <Suspense fallback={<ChallengePageLoading />}>
      <ChallengePageContent />
    </Suspense>
  );
}

/** Loading state while params are being read */
function ChallengePageLoading() {
  return (
    <div className={styles.root}>
      <AppHeader />
      <div className={styles.loading}>
        Loading challenge...
      </div>
    </div>
  );
}
