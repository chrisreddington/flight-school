import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewDueWidget } from './review-due-widget';

const { useSpacedRepCandidatesMock, getHistoryMock, markTopicReviewedMock } = vi.hoisted(() => ({
  useSpacedRepCandidatesMock: vi.fn(),
  getHistoryMock: vi.fn(),
  markTopicReviewedMock: vi.fn(),
}));

vi.mock('@/hooks/use-spaced-rep-candidates', () => ({
  useSpacedRepCandidates: () => useSpacedRepCandidatesMock(),
}));

vi.mock('@/lib/focus', () => ({
  focusStore: {
    getHistory: () => getHistoryMock(),
    markTopicReviewed: () => markTopicReviewedMock(),
  },
}));

vi.mock('@/components/TopicQuiz', () => ({
  TopicQuiz: ({ topicTitle, onClose }: { topicTitle: string; onClose: () => void }) => (
    <div>
      <span>quiz-open: {topicTitle}</span>
      <button onClick={onClose}>close-quiz</button>
    </div>
  ),
}));

vi.mock('@/lib/utils/date-utils', () => ({
  getDateKey: () => '2026-01-01',
}));

const candidate = {
  topicId: 'closures',
  title: 'JavaScript Closures',
  daysSinceSeen: 5,
  isForgotten: false,
};

describe('ReviewDueWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markTopicReviewedMock.mockResolvedValue(undefined);
  });

  it('renders nothing while candidates are loading', () => {
    useSpacedRepCandidatesMock.mockReturnValue({ candidates: [], isLoading: true });
    getHistoryMock.mockResolvedValue({});

    const { container } = render(<ReviewDueWidget />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a brand-new user with no history', async () => {
    useSpacedRepCandidatesMock.mockReturnValue({ candidates: [], isLoading: false });
    getHistoryMock.mockResolvedValue({});

    const { container } = render(<ReviewDueWidget />);

    await waitFor(() => expect(getHistoryMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a caught-up state when history exists but nothing is due', async () => {
    useSpacedRepCandidatesMock.mockReturnValue({ candidates: [], isLoading: false });
    getHistoryMock.mockResolvedValue({ '2026-01-01': {} });

    render(<ReviewDueWidget />);

    expect(await screen.findByText(/You're all caught up/)).toBeInTheDocument();
  });

  it('lists due candidates with a quiz action', () => {
    useSpacedRepCandidatesMock.mockReturnValue({ candidates: [candidate], isLoading: false });
    getHistoryMock.mockResolvedValue({});

    render(<ReviewDueWidget />);

    expect(screen.getByText('JavaScript Closures')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Quick Quiz/ })).toBeInTheDocument();
  });

  it('opens and closes the quiz overlay', async () => {
    useSpacedRepCandidatesMock.mockReturnValue({ candidates: [candidate], isLoading: false });
    getHistoryMock.mockResolvedValue({});

    render(<ReviewDueWidget />);

    fireEvent.click(screen.getByRole('button', { name: /Quick Quiz/ }));

    expect(await screen.findByText(/quiz-open: JavaScript Closures/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'close-quiz' }));

    await waitFor(() => expect(screen.queryByText(/quiz-open:/)).not.toBeInTheDocument());
    expect(markTopicReviewedMock).toHaveBeenCalled();
  });
});
