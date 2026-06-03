import type { DailyChallenge } from '@/lib/focus/types';
import { getDateKey } from '@/lib/utils/date-utils';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChallengeCard } from './ChallengeCard';

const { getHistoryMock, addChallengeMock, transitionChallengeMock, pushMock } = vi.hoisted(() => ({
  getHistoryMock: vi.fn().mockResolvedValue({}),
  addChallengeMock: vi.fn(),
  transitionChallengeMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock('@/lib/focus', () => ({
  focusStore: {
    getHistory: getHistoryMock,
    addChallenge: addChallengeMock,
    transitionChallenge: transitionChallengeMock,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/components/ChallengeActionMenu', () => ({
  ChallengeActionMenu: ({ onMarkComplete }: { onMarkComplete?: () => void }) =>
    onMarkComplete ? <button onClick={onMarkComplete}>Mark Complete</button> : null,
}));

vi.mock('@/components/DifficultyBadge', () => ({
  DifficultyBadge: ({ difficulty }: { difficulty: string }) => <span>{difficulty}</span>,
}));

vi.mock('@/components/MarkdownContent', () => ({
  MarkdownContent: ({ content }: { content: string }) => <span>{content}</span>,
}));

function createChallenge(overrides: Partial<DailyChallenge> = {}): DailyChallenge {
  return {
    id: 'c1',
    title: 'Test Challenge',
    description: 'desc',
    language: 'TypeScript',
    difficulty: 'beginner',
    whyThisChallenge: [],
    ...overrides,
  };
}

describe('ChallengeCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addChallengeMock.mockResolvedValue(undefined);
    transitionChallengeMock.mockResolvedValue(undefined);
  });

  it('renders challenge title', async () => {
    render(<ChallengeCard challenge={createChallenge()} />);
    expect(await screen.findByRole('heading', { name: 'Test Challenge' })).toBeInTheDocument();
  });

  it('shows actionError when markComplete fails', async () => {
    addChallengeMock.mockResolvedValueOnce(undefined);
    transitionChallengeMock.mockRejectedValueOnce(new Error('Mark failed'));

    render(<ChallengeCard challenge={createChallenge()} dateKey={getDateKey()} showHistoryActions={true} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Mark Complete' }));

    expect(await screen.findByText('Mark failed')).toBeInTheDocument();
  });

  it('uses Start as pure navigation without writing focus state', async () => {
    const dateKey = '2026-01-01';
    const challenge = createChallenge();

    render(<ChallengeCard challenge={challenge} dateKey={dateKey} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Start →' }));

    await waitFor(() => {
      expect(pushMock.mock.calls[0]).toEqual(['/challenge?id=c1']);
    });
    expect(addChallengeMock.mock.calls.length).toBe(0);
    expect(transitionChallengeMock.mock.calls.length).toBe(0);
  });

  it('navigates to /challenge with id only (no title/description query leakage)', async () => {
    const challenge = createChallenge({ id: 'safe-id_123' });
    render(<ChallengeCard challenge={challenge} dateKey="2026-01-01" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Start →' }));

    await waitFor(() => {
      expect(pushMock.mock.calls[0]).toEqual(['/challenge?id=safe-id_123']);
    });
  });

  it('shows a secondary ↻ New challenge button and calls onRefresh', async () => {
    const onRefresh = vi.fn();
    render(<ChallengeCard challenge={createChallenge()} onRefresh={onRefresh} />);

    const newChallengeButton = await screen.findByRole('button', { name: '↻ New challenge' });
    fireEvent.click(newChallengeButton);

    expect(onRefresh.mock.calls.length).toBe(1);
  });

  it('shows next challenge button and advances queue when completed with queued items', async () => {
    const onAdvanceQueue = vi.fn();
    getHistoryMock.mockResolvedValueOnce({
      [getDateKey()]: {
        challenges: [
          {
            data: { id: 'c1' },
            stateHistory: [{ state: 'completed' }],
          },
        ],
      },
    });

    render(<ChallengeCard challenge={createChallenge()} queueCount={2} onAdvanceQueue={onAdvanceQueue} />);

    const nextChallengeButton = await screen.findByRole('button', { name: 'Next Challenge' });
    fireEvent.click(nextChallengeButton);
    expect(onAdvanceQueue.mock.calls.length).toBe(1);
  });

  it('calls addChallenge before transitionChallenge when marking complete', async () => {
    const dateKey = getDateKey();
    const challenge = createChallenge();
    addChallengeMock.mockResolvedValueOnce(undefined);
    transitionChallengeMock.mockResolvedValueOnce(undefined);

    render(<ChallengeCard challenge={challenge} dateKey={dateKey} showHistoryActions={true} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Mark Complete' }));

    await waitFor(() => {
      expect(addChallengeMock.mock.calls[0]).toEqual([dateKey, challenge]);
      expect(transitionChallengeMock.mock.calls[0]).toEqual([dateKey, challenge.id, 'completed', 'history']);
    });
    expect(addChallengeMock.mock.invocationCallOrder[0]).toBeLessThan(
      transitionChallengeMock.mock.invocationCallOrder[0],
    );
  });
});
