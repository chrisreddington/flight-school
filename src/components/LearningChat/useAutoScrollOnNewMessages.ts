import { useEffect, useRef } from 'react';

interface AutoScrollOptions {
  /** Current active thread id (null when no thread is selected). */
  activeThreadId: string | null;
  /** Number of messages currently rendered (including any synthesised streaming message). */
  messageCount: number;
  /** True when the typing indicator is visible (treated as a new "message" for scroll purposes). */
  showTypingIndicator: boolean;
}

/**
 * Scroll the supplied sentinel into view whenever a new message lands
 * or the typing indicator appears.
 *
 * The hook deliberately suppresses scrolling on the very first render
 * and on the initial hydration of an existing thread so users do not
 * see an unexpected jump when the page loads with prior history. Both
 * guards are tested in `LearningChat.test.tsx`.
 */
export function useAutoScrollOnNewMessages({
  activeThreadId,
  messageCount,
  showTypingIndicator,
}: AutoScrollOptions): React.RefObject<HTMLDivElement | null> {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const previousMessageCountRef = useRef(0);
  const hasInitializedRef = useRef(false);
  const previousActiveThreadIdRef = useRef<string | null>(null);

  useEffect(() => {
    const previousActiveThreadId = previousActiveThreadIdRef.current;
    const didHydrateInitialThread = previousActiveThreadId === null && activeThreadId !== null;
    previousActiveThreadIdRef.current = activeThreadId;

    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      previousMessageCountRef.current = messageCount;
      return;
    }

    if (didHydrateInitialThread) {
      previousMessageCountRef.current = messageCount;
      return;
    }

    if (messageCount > previousMessageCountRef.current || showTypingIndicator) {
      sentinelRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    previousMessageCountRef.current = messageCount;
  }, [activeThreadId, messageCount, showTypingIndicator]);

  return sentinelRef;
}
