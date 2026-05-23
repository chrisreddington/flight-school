import { act, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@primer/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopilotRequiredBanner } from './index';
import { COPILOT_REQUIRED_EVENT } from '@/lib/copilot/required-event';

// next/navigation needs a controllable pathname so we can exercise the
// route-change dismissal branch.
let mockPathname = '/dashboard';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

function renderBanner() {
  return render(
    <ThemeProvider>
      <CopilotRequiredBanner />
    </ThemeProvider>,
  );
}

function dispatch(detail?: { message?: string; signUpUrl?: string }) {
  act(() => {
    window.dispatchEvent(new CustomEvent(COPILOT_REQUIRED_EVENT, { detail }));
  });
}

describe('CopilotRequiredBanner', () => {
  afterEach(() => {
    mockPathname = '/dashboard';
  });

  it('renders nothing before any copilot-required event', () => {
    renderBanner();
    expect(screen.queryByText(/GitHub Copilot required/i)).toBeNull();
  });

  it('renders banner content when copilot-required fires', () => {
    renderBanner();
    dispatch({ message: 'Need Copilot to chat.' });

    expect(screen.getByText(/GitHub Copilot required/i)).toBeInTheDocument();
    expect(screen.getByText(/Need Copilot to chat\./)).toBeInTheDocument();
  });

  it('falls back to the default message when no detail is provided', () => {
    renderBanner();
    dispatch();

    expect(screen.getByText(/AI features need a GitHub Copilot subscription/i)).toBeInTheDocument();
  });

  it('wraps the banner in an aria-live="polite" region', () => {
    renderBanner();
    dispatch({ message: 'hello' });

    const live = screen.getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
  });

  it('dismisses on route change', () => {
    const { rerender } = renderBanner();
    dispatch({ message: 'hello' });
    expect(screen.getByText(/GitHub Copilot required/i)).toBeInTheDocument();

    // Simulate navigation: the next render observes the new pathname.
    mockPathname = '/profile';
    rerender(
      <ThemeProvider>
        <CopilotRequiredBanner />
      </ThemeProvider>,
    );

    expect(screen.queryByText(/GitHub Copilot required/i)).toBeNull();
  });
});
