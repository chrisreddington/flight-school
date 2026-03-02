import type { LearningTopic } from '@/lib/focus/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopicCard } from './TopicCard';

const { getHistoryMock, transitionTopicMock } = vi.hoisted(() => ({
  getHistoryMock: vi.fn().mockResolvedValue({}),
  transitionTopicMock: vi.fn(),
}));

vi.mock('@/lib/focus', () => ({
  focusStore: {
    getHistory: getHistoryMock,
    transitionTopic: transitionTopicMock,
  },
}));

vi.mock('@/components/TopicQuiz', () => ({ TopicQuiz: () => null }));

function createTopic(overrides: Partial<LearningTopic> = {}): LearningTopic {
  return {
    id: 't1',
    title: 'Test Topic',
    description: 'desc',
    type: 'concept',
    ...overrides,
  };
}

describe('TopicCard', () => {
  it('renders topic title', async () => {
    render(<TopicCard topic={createTopic()} />);
    expect(await screen.findByRole('heading', { name: 'Test Topic' })).toBeInTheDocument();
  });

  it('shows actionError when explore fails', async () => {
    transitionTopicMock.mockRejectedValueOnce(new Error('Explore failed'));

    render(<TopicCard topic={createTopic()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Explore Topic' }));

    expect(await screen.findByText('Explore failed')).toBeInTheDocument();
  });
});
