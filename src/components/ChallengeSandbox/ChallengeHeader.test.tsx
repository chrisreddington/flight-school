/**
 * Tests for ChallengeHeader.
 *
 * Focus areas (X5 — challenge mobile + meta band):
 * - Renders the additive meta band (language + estimated time) so the
 *   header carries info scent like a GitHub page header.
 * - Keeps the Free/Guided mode toggle present and reachable.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@primer/react';

import { ChallengeHeader, type ChallengeHeaderProps } from './ChallengeHeader';
import type { ChallengeDef } from '@/lib/copilot/types';

// MarkdownContent dynamically imports react-markdown which isn't needed here.
vi.mock('@/components/MarkdownContent', () => ({
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}));

function baseChallenge(overrides: Partial<ChallengeDef> = {}): ChallengeDef {
  return {
    title: 'Compute WPM and Accuracy',
    description: 'Write a function that computes words-per-minute.',
    language: 'TypeScript',
    difficulty: 'intermediate',
    estimatedTime: '30 minutes',
    ...overrides,
  };
}

function renderHeader(overrides: Partial<ChallengeHeaderProps> = {}) {
  const props: ChallengeHeaderProps = {
    challenge: baseChallenge(),
    mode: 'free',
    onSelectMode: vi.fn(),
    isDescriptionCollapsed: true,
    onToggleDescription: vi.fn(),
    isDebugMode: false,
    onSolveChallenge: vi.fn(),
    isSolving: false,
    isEvaluating: false,
    ...overrides,
  };
  return render(
    <ThemeProvider>
      <ChallengeHeader {...props} />
    </ThemeProvider>,
  );
}

describe('ChallengeHeader meta band', () => {
  it('shows the language and estimated time', () => {
    renderHeader();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.getByText('30 minutes')).toBeInTheDocument();
  });

  it('omits the estimated time when none is provided', () => {
    renderHeader({ challenge: baseChallenge({ estimatedTime: undefined }) });
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.queryByText('30 minutes')).not.toBeInTheDocument();
  });

  it('keeps the Free/Guided mode toggle reachable', () => {
    renderHeader();
    expect(screen.getByRole('button', { name: 'Free Mode' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guided Mode' })).toBeInTheDocument();
  });
});
