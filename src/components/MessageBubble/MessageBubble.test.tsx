import type { Message, ToolCallEvent } from '@/lib/threads/types';
import { render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@primer/react';
import { describe, expect, it, vi } from 'vitest';
import { MessageBubble } from './index';

const { isDebugModeRef } = vi.hoisted(() => ({ isDebugModeRef: { current: false } }));

vi.mock('@/contexts/debug-context', () => ({
  useDebugMode: () => ({
    isDebugMode: isDebugModeRef.current,
    toggleDebugMode: vi.fn(),
    setDebugMode: vi.fn(),
  }),
}));

vi.mock('@/components/MarkdownContent', () => ({
  MarkdownContent: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));

function renderBubble(message: Message, opts: { isStreaming?: boolean } = {}) {
  return render(
    <ThemeProvider>
      <MessageBubble message={message} isStreaming={opts.isStreaming ?? false} />
    </ThemeProvider>
  );
}

function buildMessage(toolEvents: ToolCallEvent[], content = 'hello'): Message {
  return {
    id: 'msg-1',
    role: 'assistant',
    content,
    timestamp: '2025-01-01T00:00:00.000Z',
    toolEvents,
  };
}

describe('MessageBubble tool events', () => {
  it('renders the running state with a spinner and human summary outside debug mode', () => {
    isDebugModeRef.current = false;
    renderBubble(buildMessage([
      {
        id: 't-1',
        name: 'search_code',
        status: 'running',
        args: { owner: 'chrisreddington', repo: 'flight-school', q: 'auth' },
      },
    ], ''));

    const list = screen.getByTestId('tool-event-list');
    const item = within(list).getByLabelText(/Tool running:/);
    expect(item.textContent).toContain('Searching code');
    expect(item.textContent).toContain('chrisreddington/flight-school');
    expect(item.textContent).toContain('auth');
    // No "Show details" disclosure outside debug mode.
    expect(within(list).queryByText('Show details')).toBeNull();
  });

  it('renders the completed state with a checkmark, summary, and duration', () => {
    isDebugModeRef.current = false;
    renderBubble(buildMessage([
      {
        id: 't-1',
        name: 'get_file_contents',
        status: 'complete',
        args: { owner: 'foo', repo: 'bar', path: 'README.md' },
        result: '# Hello',
        durationMs: 1234,
      },
    ]));

    const list = screen.getByTestId('tool-event-list');
    const item = within(list).getByLabelText(/Tool completed:/);
    expect(item.textContent).toContain('Reading');
    expect(item.textContent).toContain('README.md');
    // Duration label rendered (1234ms → 1.2s).
    expect(list.textContent).toContain('1.2s');
  });

  it('exposes a "Show details" disclosure with raw args/result when debug mode is on', () => {
    isDebugModeRef.current = true;
    renderBubble(buildMessage([
      {
        id: 't-1',
        name: 'search_code',
        status: 'complete',
        args: { q: 'auth' },
        result: 'matched 12 files',
        durationMs: 500,
      },
    ]));

    const list = screen.getByTestId('tool-event-list');
    expect(within(list).getByText('Show details')).toBeInTheDocument();
    // Raw args + result are rendered in pre blocks.
    expect(list.textContent).toContain('"q": "auth"');
    expect(list.textContent).toContain('matched 12 files');
  });

  it('falls back to the legacy toolCalls: string[] form when toolEvents is absent', () => {
    isDebugModeRef.current = false;
    render(
      <ThemeProvider>
        <MessageBubble
          message={{
            id: 'm-legacy',
            role: 'assistant',
            content: 'hi',
            timestamp: '2025-01-01T00:00:00.000Z',
            toolCalls: ['search_code'],
          }}
        />
      </ThemeProvider>
    );
    const list = screen.getByTestId('tool-event-list');
    expect(within(list).getByLabelText(/Tool completed:/)).toBeInTheDocument();
    expect(list.textContent).toContain('Searching code');
  });

  it('renders running then completed states in order across re-renders (chat stream integration)', () => {
    isDebugModeRef.current = false;
    // Simulate a stream: first tool.execution_start arrives → running state.
    const { rerender } = render(
      <ThemeProvider>
        <MessageBubble
          message={buildMessage([
            { id: 't-1', name: 'search_code', status: 'running', args: { q: 'auth' } },
          ], '')}
        />
      </ThemeProvider>
    );
    expect(screen.getByLabelText(/Tool running:/)).toBeInTheDocument();

    // Then tool.execution_complete arrives → the same id flips to complete.
    rerender(
      <ThemeProvider>
        <MessageBubble
          message={buildMessage([
            {
              id: 't-1',
              name: 'search_code',
              status: 'complete',
              args: { q: 'auth' },
              result: '12 matches',
              durationMs: 800,
            },
          ], 'Here are the matches…')}
        />
      </ThemeProvider>
    );
    expect(screen.queryByLabelText(/Tool running:/)).toBeNull();
    expect(screen.getByLabelText(/Tool completed:/)).toBeInTheDocument();
  });

  it('renders nothing tool-related when the message has no tool events', () => {
    isDebugModeRef.current = false;
    renderBubble({
      id: 'm-bare',
      role: 'assistant',
      content: 'hello',
      timestamp: '2025-01-01T00:00:00.000Z',
    });
    expect(screen.queryByTestId('tool-event-list')).toBeNull();
  });
});
