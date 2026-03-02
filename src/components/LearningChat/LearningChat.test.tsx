import type { Thread } from '@/lib/threads/types';
import { render, act } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LearningChat } from './index';

vi.mock('../ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}));

vi.mock('../RepoSelector', () => ({
  RepoSelector: () => <div data-testid="repo-selector" />,
}));

vi.mock('../ThreadSidebar', () => ({
  ThreadSidebar: () => <div data-testid="thread-sidebar" />,
}));

vi.mock('../MessageBubble', () => ({
  MessageBubble: ({ message }: { message: { content: string } }) => (
    <div data-testid="message-bubble">{message.content}</div>
  ),
}));

const noop = vi.fn();

const defaultHandlers = {
  sendMessage: noop,
  createThread: noop,
  selectThread: noop,
  deleteThread: noop,
  renameThread: noop,
  updateContext: noop,
  stopStreaming: noop,
};

function createThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    title: 'Thread 1',
    context: { repos: [] },
    messages: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('LearningChat typing indicator', () => {
  function renderChat(props: Partial<ComponentProps<typeof LearningChat>> = {}): string {
    return renderToStaticMarkup(
      <LearningChat
        threads={[]}
        activeThreadId={null}
        handlers={defaultHandlers}
        isStreaming={false}
        {...props}
      />
    );
  }

  it('shows typing indicator when isStreaming is true and no streaming message exists', () => {
    const markup = renderChat({ isStreaming: true });
    expect(markup).toContain('aria-label="Copilot is thinking"');
  });

  it('does not show typing indicator when streaming message already exists', () => {
    const markup = renderChat({
      threads: [
        createThread({
          messages: [
            {
              id: 'streaming-abc',
              role: 'assistant',
              content: 'Thinking...',
              timestamp: '2025-01-01T00:00:00.000Z',
            },
          ],
          isStreaming: true,
        }),
      ],
      activeThreadId: 'thread-1',
      isStreaming: true,
    });

    expect(markup).not.toContain('aria-label="Copilot is thinking"');
  });

  it('does not show typing indicator when not streaming', () => {
    const markup = renderChat({ isStreaming: false });
    expect(markup).not.toContain('aria-label="Copilot is thinking"');
  });
});

describe('LearningChat auto-scroll', () => {
  it('does not call scrollIntoView on initial render when messages are already present', async () => {
    const scrollIntoViewMock = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    const thread = createThread({
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          timestamp: '2025-01-01T00:00:00.000Z',
        },
      ],
    });

    await act(async () => {
      render(
        <LearningChat
          threads={[thread]}
          activeThreadId="thread-1"
          handlers={defaultHandlers}
          isStreaming={false}
        />
      );
    });

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('calls scrollIntoView when typing indicator appears', async () => {
    const scrollIntoViewMock = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    const thread = createThread({
      messages: [],
      isStreaming: true,
    });

    const { rerender } = render(
      <LearningChat
        threads={[createThread({ messages: [] })]}
        activeThreadId="thread-1"
        handlers={defaultHandlers}
        isStreaming={false}
      />
    );

    await act(async () => {
      rerender(
        <LearningChat
          threads={[thread]}
          activeThreadId="thread-1"
          handlers={defaultHandlers}
          isStreaming={true}
        />
      );
    });

    // Typing indicator should show (no streaming message), so scrollIntoView called
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it('does not call scrollIntoView when active thread hydrates after initial load', async () => {
    const scrollIntoViewMock = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    const hydratedThread = createThread({
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Previously saved message',
          timestamp: '2025-01-01T00:00:00.000Z',
        },
      ],
    });

    const { rerender } = render(
      <LearningChat
        threads={[]}
        activeThreadId={null}
        handlers={defaultHandlers}
        isStreaming={false}
      />
    );

    await act(async () => {
      rerender(
        <LearningChat
          threads={[hydratedThread]}
          activeThreadId="thread-1"
          handlers={defaultHandlers}
          isStreaming={false}
        />
      );
    });

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });
});
