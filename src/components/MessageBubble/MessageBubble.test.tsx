import type { Message, ToolCallEvent } from '@/lib/threads/types';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@primer/react';
import { useState } from 'react';
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
    </ThemeProvider>,
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
    renderBubble(
      buildMessage(
        [
          {
            id: 't-1',
            name: 'search_code',
            status: 'running',
            args: { owner: 'chrisreddington', repo: 'flight-school', q: 'auth' },
          },
        ],
        '',
      ),
    );

    const list = screen.getByTestId('tool-event-list');
    const item = within(list).getByLabelText(/Tool running:/);
    expect(item.textContent).toContain('Searching code');
    expect(item.textContent).toContain('chrisreddington/flight-school');
    expect(item.textContent).toContain('auth');
    // No "Show details" disclosure outside debug mode.
    expect(within(list).queryByText('Show details')).toBeNull();
  });

  describe('MessageBubble learning layout', () => {
    it('renders a collapsed deep-dive disclosure while keeping the TL;DR visible', () => {
      isDebugModeRef.current = false;
      renderBubble({
        id: 'msg-learning-1',
        role: 'assistant',
        content: `Use a reducer when state transitions depend on previous values.

  Reducers centralize update logic and make complex state transitions explicit.

  ## Follow-up questions
  1. Where does this component currently duplicate state update logic?
  2. Could this state shape benefit from action-based transitions?`,
        timestamp: '2025-01-01T00:00:00.000Z',
      });

      expect(screen.getByText(/Use a reducer when state transitions/)).toBeInTheDocument();

      const deepDiveDisclosure = screen.getByTestId('learning-deep-dive');
      expect(deepDiveDisclosure).not.toHaveAttribute('open');
      expect(within(deepDiveDisclosure).getByText(/Reducers centralize update logic/)).toBeInTheDocument();
    });

    it('renders follow-up chips that submit follow-up text when clicked', () => {
      isDebugModeRef.current = false;
      function FollowUpHarness() {
        const [selectedFollowUp, setSelectedFollowUp] = useState('');
        return (
          <>
            <MessageBubble
              message={{
                id: 'msg-learning-2',
                role: 'assistant',
                content: `TL;DR paragraph.

  Deep explanation paragraph.

  ## Follow-up questions
  - Refactor one component state transition into a reducer.
  - How would you name the action types for readability?`,
                timestamp: '2025-01-01T00:00:00.000Z',
              }}
              onFollowUpSelect={setSelectedFollowUp}
            />
            <output data-testid="selected-follow-up">{selectedFollowUp}</output>
          </>
        );
      }

      render(
        <ThemeProvider>
          <FollowUpHarness />
        </ThemeProvider>,
      );

      const firstChip = screen.getByRole('button', {
        name: 'Refactor one component state transition into a reducer.',
      });
      fireEvent.click(firstChip);

      expect(screen.getByTestId('selected-follow-up').textContent).toBe(
        'Refactor one component state transition into a reducer.',
      );
    });

    it('does not render follow-up chips when heading level is not exactly ##', () => {
      isDebugModeRef.current = false;
      const onFollowUpSelect = vi.fn();

      render(
        <ThemeProvider>
          <MessageBubble
            message={{
              id: 'msg-learning-3',
              role: 'assistant',
              content: `TL;DR paragraph.

Deep explanation paragraph.

### Follow-up questions
- Refactor one component state transition into a reducer.
- Measure rerenders before and after the refactor.`,
              timestamp: '2025-01-01T00:00:00.000Z',
            }}
            onFollowUpSelect={onFollowUpSelect}
          />
        </ThemeProvider>,
      );

      expect(screen.queryByRole('button', { name: /Refactor one component/ })).toBeNull();
    });

    it('renders one chip per bullet item under the follow-up heading', () => {
      isDebugModeRef.current = false;
      const onFollowUpSelect = vi.fn();

      render(
        <ThemeProvider>
          <MessageBubble
            message={{
              id: 'msg-learning-4',
              role: 'assistant',
              content: `TL;DR paragraph.

Deep explanation paragraph.

## Follow-up questions
- Which reducer action would you introduce first?
- Refactor one component state transition into a reducer.
- Measure rerenders before and after the refactor.`,
              timestamp: '2025-01-01T00:00:00.000Z',
            }}
            onFollowUpSelect={onFollowUpSelect}
          />
        </ThemeProvider>,
      );

      expect(screen.getAllByRole('button')).toHaveLength(3);
    });
  });

  it('renders the completed state with a checkmark, summary, and duration', () => {
    isDebugModeRef.current = false;
    renderBubble(
      buildMessage([
        {
          id: 't-1',
          name: 'get_file_contents',
          status: 'complete',
          args: { owner: 'foo', repo: 'bar', path: 'README.md' },
          result: '# Hello',
          durationMs: 1234,
        },
      ]),
    );

    const list = screen.getByTestId('tool-event-list');
    const item = within(list).getByLabelText(/Tool completed:/);
    expect(item.textContent).toContain('Reading');
    expect(item.textContent).toContain('README.md');
    // Duration label rendered (1234ms → 1.2s).
    expect(list.textContent).toContain('1.2s');
  });

  it('exposes a "Show details" disclosure with raw args/result when debug mode is on', () => {
    isDebugModeRef.current = true;
    renderBubble(
      buildMessage([
        {
          id: 't-1',
          name: 'search_code',
          status: 'complete',
          args: { q: 'auth' },
          result: 'matched 12 files',
          durationMs: 500,
        },
      ]),
    );

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
      </ThemeProvider>,
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
          message={buildMessage([{ id: 't-1', name: 'search_code', status: 'running', args: { q: 'auth' } }], '')}
        />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText(/Tool running:/)).toBeInTheDocument();

    // Then tool.execution_complete arrives → the same id flips to complete.
    rerender(
      <ThemeProvider>
        <MessageBubble
          message={buildMessage(
            [
              {
                id: 't-1',
                name: 'search_code',
                status: 'complete',
                args: { q: 'auth' },
                result: '12 matches',
                durationMs: 800,
              },
            ],
            'Here are the matches…',
          )}
        />
      </ThemeProvider>,
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
