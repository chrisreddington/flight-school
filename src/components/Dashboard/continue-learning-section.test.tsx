import { render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@primer/react';
import { describe, expect, it } from 'vitest';

import type { Thread } from '@/lib/threads/types';

import { ContinueLearningSection } from './continue-learning-section';

function makeThread(id: string, title: string, updatedAt: string): Thread {
  return {
    id,
    title,
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  } as Thread;
}

function renderSection(threads: Thread[]) {
  return render(
    <ThemeProvider>
      <ContinueLearningSection threads={threads} />
    </ThemeProvider>,
  );
}

describe('ContinueLearningSection', () => {
  it('always offers a primary link into the chat surface', () => {
    renderSection([]);
    expect(screen.getByRole('link', { name: /Open chat/ })).toHaveAttribute('href', '/chat');
  });

  it('shows an inline empty state when there are no conversations', () => {
    renderSection([]);
    expect(screen.getByText(/No conversations yet/)).toBeInTheDocument();
  });

  it('lists the three most recently updated conversations as deep links', () => {
    const threads = [
      makeThread('a', 'Oldest', '2026-01-01T00:00:00.000Z'),
      makeThread('b', 'Middle', '2026-02-01T00:00:00.000Z'),
      makeThread('c', 'Newest', '2026-03-01T00:00:00.000Z'),
      makeThread('d', 'Fourth', '2026-04-01T00:00:00.000Z'),
    ];
    renderSection(threads);

    // Newest-first, capped at three: "Oldest" (the 4th newest) is dropped.
    expect(screen.getByRole('link', { name: 'Fourth' })).toHaveAttribute('href', '/chat?thread=d');
    expect(screen.getByRole('link', { name: 'Newest' })).toHaveAttribute('href', '/chat?thread=c');
    expect(screen.getByRole('link', { name: 'Middle' })).toHaveAttribute('href', '/chat?thread=b');
    expect(screen.queryByRole('link', { name: 'Oldest' })).not.toBeInTheDocument();
  });

  it('does not render the empty state once conversations exist', () => {
    renderSection([makeThread('a', 'Only', '2026-01-01T00:00:00.000Z')]);
    expect(screen.queryByText(/No conversations yet/)).not.toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(within(list).getByRole('link', { name: 'Only' })).toBeInTheDocument();
  });
});
