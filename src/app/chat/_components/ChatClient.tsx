'use client';

/**
 * ChatClient — client island hosting the full learning-chat experience.
 *
 * Lifts the chat wiring that previously lived on the dashboard: it mounts the
 * composite {@link useLearningChat} hook (threads + streaming) and renders
 * {@link LearningChat} at full height. A `?thread=<id>` deep link selects that
 * conversation once it has loaded, so "Explore" hand-offs from the dashboard
 * and history land on the seeded thread with its in-flight stream attached.
 */

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

import { LearningChat } from '@/components/LearningChat';
import { useActiveOperations } from '@/hooks/use-active-operations';
import { useLearningChat } from '@/hooks/use-learning-chat';
import { useUserProfile } from '@/hooks/use-user-profile';
import type { RepoReference } from '@/lib/threads/types';

import styles from '../chat.module.css';

export function ChatClient() {
  // Keep cross-page operation state in sync (e.g. explore jobs started elsewhere).
  useActiveOperations();

  const searchParams = useSearchParams();
  const threadParam = searchParams.get('thread');

  const { data: profile, isLoading: profileLoading } = useUserProfile();
  const {
    threads,
    activeThreadId,
    isThreadsLoading,
    isStreaming,
    streamingAssistantMessageId,
    streamingContent,
    streamingThreadIds,
    streamingToolEvents,
    sendMessage,
    stopStreaming,
    createThread,
    selectThread,
    deleteThread,
    renameThread,
    updateContext,
  } = useLearningChat();

  // Apply the `?thread=` deep link once per distinct value, and only after the
  // thread has actually loaded — threads arrive asynchronously, so we must not
  // burn the guard before the target exists, nor re-select it after the user
  // manually switches threads.
  const lastAppliedThreadParam = useRef<string | null>(null);
  useEffect(() => {
    if (!threadParam) return;
    if (lastAppliedThreadParam.current === threadParam) return;
    if (!threads.some((thread) => thread.id === threadParam)) return;

    selectThread(threadParam);
    lastAppliedThreadParam.current = threadParam;
  }, [threadParam, threads, selectThread]);

  const availableRepos =
    profile?.repos?.map((repo) => ({
      fullName: repo.fullName,
      owner: repo.owner,
      name: repo.name,
      language: repo.language ?? undefined,
    })) ?? [];

  const chatHandlers = {
    sendMessage: async (message: string, repos?: RepoReference[]) => {
      await sendMessage(message, { profile: 'learning', capabilities: ['github'], repos });
    },
    createThread,
    selectThread: (threadId: string | null) => {
      if (threadId) selectThread(threadId);
    },
    deleteThread,
    renameThread,
    updateContext,
    stopStreaming,
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.content}>
        <div className={styles.chatHost}>
          <LearningChat
            threads={threads}
            activeThreadId={activeThreadId}
            handlers={chatHandlers}
            availableRepos={availableRepos}
            isReposLoading={profileLoading}
            isThreadsLoading={isThreadsLoading}
            isStreaming={isStreaming}
            streamingThreadIds={streamingThreadIds}
            streamingAssistantMessageId={streamingAssistantMessageId}
            streamingContent={streamingContent}
            streamingToolEvents={streamingToolEvents}
            userAvatarUrl={profile?.user?.avatarUrl}
          />
        </div>
      </div>
    </div>
  );
}
