'use client';

import { CopilotIcon } from '@primer/octicons-react';
import { ActionList, Button } from '@primer/react';
import Link from 'next/link';

import type { Thread } from '@/lib/threads/types';

import styles from './continue-learning-section.module.css';

interface ContinueLearningSectionProps {
  /** All learning-chat threads, used to surface the most recent few. */
  threads: Thread[];
}

const MAX_RECENT_THREADS = 3;

/**
 * Compact dashboard entry point to the dedicated `/chat` surface.
 *
 * The full transcript now lives at `/chat`; the dashboard keeps only this
 * lightweight card — a primary "Open chat" action plus the three
 * most-recently-updated conversations as deep links. The empty state is an
 * inline line rather than a full Blankslate, per the design skill's
 * constrained-space exception for compact dashboard cards.
 */
export function ContinueLearningSection({ threads }: ContinueLearningSectionProps) {
  const recentThreads = [...threads]
    .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))
    .slice(0, MAX_RECENT_THREADS);

  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <h3 className={styles.title}>
          <CopilotIcon size={16} className={styles.titleIcon} />
          Learning chat
        </h3>
        <p className={styles.subtitle}>Pick up a conversation or start a new one with Copilot.</p>
      </header>

      {recentThreads.length === 0 ? (
        <p className={styles.empty}>No conversations yet — start your first one to explore a topic with Copilot.</p>
      ) : (
        <ActionList>
          {recentThreads.map((thread) => (
            <ActionList.LinkItem key={thread.id} as={Link} href={`/chat?thread=${thread.id}`}>
              {thread.title}
            </ActionList.LinkItem>
          ))}
        </ActionList>
      )}

      <Button as={Link} href="/chat" variant="primary" leadingVisual={CopilotIcon} className={styles.openButton}>
        Open chat
      </Button>
    </section>
  );
}
