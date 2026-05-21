/**
 * Tests for EvaluationResultDisplay.
 *
 * Focus areas (F7 — Jobs progress + credentials-expired CTA):
 * - Renders the re-auth CTA when a job fails with a structured
 *   credentials-expired errorCode.
 * - Surfaces step narration while the executor is still working.
 * - Falls back to a plain error banner for generic (non-credentials)
 *   failures.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@primer/react';

import { EvaluationResultDisplay } from './evaluation-result-display';
import type { EvaluationState } from '@/hooks/use-challenge-sandbox';

// react-markdown is dynamically imported and not needed for these tests
vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

function renderWithTheme(state: EvaluationState) {
  return render(
    <ThemeProvider>
      <EvaluationResultDisplay evaluation={state} />
    </ThemeProvider>,
  );
}

function baseState(overrides: Partial<EvaluationState> = {}): EvaluationState {
  return {
    isLoading: false,
    partialResult: null,
    streamingFeedback: '',
    result: null,
    error: null,
    errorCode: null,
    currentStep: null,
    isCancelling: false,
    ...overrides,
  };
}

describe('EvaluationResultDisplay', () => {
  it('renders the re-auth CTA when errorCode is credentials_missing', () => {
    renderWithTheme(
      baseState({
        error: 'GitHub credentials missing — user must re-authenticate.',
        errorCode: 'credentials_missing',
      }),
    );

    expect(screen.getByText(/your github session expired/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /sign in with github/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toMatch(/^\/sign-in\?callbackUrl=/);
  });

  it('renders the re-auth CTA when errorCode is credentials_refresh_failed', () => {
    renderWithTheme(
      baseState({
        error: 'GitHub credentials expired — user must re-authenticate.',
        errorCode: 'credentials_refresh_failed',
      }),
    );

    expect(screen.getByRole('link', { name: /sign in with github/i })).toBeInTheDocument();
  });

  it('renders step narration while loading without a partial result', () => {
    renderWithTheme(
      baseState({
        isLoading: true,
        currentStep: 'Running tests…',
      }),
    );

    expect(screen.getByText('Running tests…')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('renders generic error banner when error is set without a structured errorCode', () => {
    renderWithTheme(
      baseState({
        error: 'Provider returned a 500',
      }),
    );

    expect(screen.getByText('Provider returned a 500')).toBeInTheDocument();
    // Should NOT show the credentials CTA
    expect(screen.queryByRole('link', { name: /sign in with github/i })).not.toBeInTheDocument();
  });

  it('renders empty state when idle with no result', () => {
    renderWithTheme(baseState());
    expect(screen.getByText(/run your code to see evaluation results/i)).toBeInTheDocument();
  });
});
