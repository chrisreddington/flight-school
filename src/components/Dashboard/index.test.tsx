import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dashboard } from './index';

// The Dashboard is a composition shell: it wires hooks to section components
// inside a SplitPageLayout. These tests assert that composition (single h1 +
// the key regions render), so the heavy children and data hooks are mocked.

vi.mock('@/hooks/use-active-operations', () => ({
  useActiveOperations: vi.fn(),
}));

vi.mock('@/hooks/use-ai-focus', () => ({
  useAIFocus: () => ({ data: null, isAIEnabled: false, loadingComponents: {} }),
}));

vi.mock('@/hooks/use-learning-chat', () => ({
  useLearningChat: () => ({ threads: [], createThread: vi.fn(), sendMessage: vi.fn() }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/use-user-profile', () => ({
  useUserProfile: () => ({ data: null, isLoading: false, refetch: vi.fn() }),
  getDisplayName: () => 'Octocat',
}));

vi.mock('../AppHeader', () => ({ AppHeader: () => <div>app-header</div> }));
vi.mock('./continue-learning-section', () => ({
  ContinueLearningSection: () => <div>continue-learning</div>,
}));
vi.mock('./daily-focus-section', () => ({ DailyFocusSection: () => <div>daily-focus</div> }));
vi.mock('./review-due-widget', () => ({ ReviewDueWidget: () => <div>review-due</div> }));
vi.mock('./profile-activity-section', () => ({ ProfileActivitySection: () => <div>profile-activity</div> }));
vi.mock('./pro-tip-section', () => ({ ProTipSection: () => <div>pro-tip</div> }));
vi.mock('./footer', () => ({ Footer: () => <div>footer</div> }));

describe('Dashboard', () => {
  it('renders exactly one h1 from the page header', () => {
    render(<Dashboard />);

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Dashboard');
  });

  it('shows the personalized greeting in the header description', () => {
    render(<Dashboard />);

    expect(screen.getByText(/Octocat/)).toBeInTheDocument();
    expect(screen.getByText(/Ready to level up your skills/)).toBeInTheDocument();
  });

  it('renders the daily focus, review, and chat regions', () => {
    render(<Dashboard />);

    expect(screen.getByText('daily-focus')).toBeInTheDocument();
    expect(screen.getByText('review-due')).toBeInTheDocument();
    expect(screen.getByText('continue-learning')).toBeInTheDocument();
  });

  it('renders the activity sidebar pane', () => {
    render(<Dashboard />);

    expect(screen.getByText('profile-activity')).toBeInTheDocument();
    expect(screen.getByText('pro-tip')).toBeInTheDocument();
  });
});
