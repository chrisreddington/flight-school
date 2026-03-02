import type { DailyChallenge } from '@/lib/focus/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AuthoringMessage } from './authoring-chat';
import { AuthoringMessageList } from './authoring-message-list';

vi.mock('@/components/MarkdownContent', () => ({
  MarkdownContent: ({
    content,
    isStreaming,
  }: {
    content: string;
    isStreaming?: boolean;
  }) => <div data-testid={isStreaming ? 'markdown-streaming' : 'markdown'}>{content}</div>,
}));

const mockPendingChallenge: DailyChallenge = {
  id: 'challenge-1',
  title: 'Array Challenge',
  description: 'Solve arrays',
  difficulty: 'beginner',
  language: 'typescript',
  estimatedTime: '30 minutes',
  whyThisChallenge: ['Practice arrays'],
};

const userMessage: AuthoringMessage = {
  id: 'user-1',
  role: 'user',
  content: 'Create me a challenge',
  timestamp: '2026-01-01T00:00:00.000Z',
};

const assistantMessage: AuthoringMessage = {
  id: 'assistant-1',
  role: 'assistant',
  content: 'Sure, here is one.',
  timestamp: '2026-01-01T00:00:01.000Z',
};

function renderMessageList(props: Partial<React.ComponentProps<typeof AuthoringMessageList>> = {}) {
  return render(
    <AuthoringMessageList
      messages={[]}
      isStreaming={false}
      streamingContent=""
      messagesEndRef={{ current: null }}
      pendingChallenge={null}
      onCreateChallenge={vi.fn()}
      {...props}
    />
  );
}

describe('AuthoringMessageList', () => {
  it('shows empty state when messages are empty and not streaming', () => {
    renderMessageList();

    expect(screen.getByText('Describe your challenge')).toBeInTheDocument();
  });

  it('shows typing indicator when streaming and no content has arrived', () => {
    renderMessageList({ isStreaming: true, streamingContent: '' });

    const indicator = screen.getByRole('status', { name: 'Copilot is thinking' });
    expect(indicator).toBeInTheDocument();
    expect(indicator.querySelectorAll('span')).toHaveLength(3);
  });

  it('does not show typing indicator when not streaming', () => {
    renderMessageList({ messages: [assistantMessage] });

    expect(screen.queryByRole('status', { name: 'Copilot is thinking' })).not.toBeInTheDocument();
  });

  it('shows streaming content bubble and not typing indicator when streaming has content', () => {
    renderMessageList({ isStreaming: true, streamingContent: 'Hello' });

    expect(screen.getByTestId('markdown-streaming')).toHaveTextContent('Hello');
    expect(screen.queryByRole('status', { name: 'Copilot is thinking' })).not.toBeInTheDocument();
  });

  it('renders a user message correctly', () => {
    renderMessageList({ messages: [userMessage] });

    expect(screen.getByText('Create me a challenge')).toBeInTheDocument();
  });

  it('renders an assistant message correctly', () => {
    renderMessageList({ messages: [assistantMessage] });

    expect(screen.getByTestId('markdown')).toHaveTextContent('Sure, here is one.');
  });

  it('shows create challenge button when pending challenge is set and not streaming', () => {
    renderMessageList({
      messages: [assistantMessage],
      pendingChallenge: mockPendingChallenge,
      isStreaming: false,
    });

    expect(screen.getByRole('button', { name: 'Create Challenge' })).toBeInTheDocument();
  });

  it('does not show create challenge button when streaming', () => {
    renderMessageList({
      messages: [assistantMessage],
      pendingChallenge: mockPendingChallenge,
      isStreaming: true,
    });

    expect(screen.queryByRole('button', { name: 'Create Challenge' })).not.toBeInTheDocument();
  });
});
