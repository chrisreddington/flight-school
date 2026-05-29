/**
 * Tests for the sign-in page (X6 — branded hero).
 *
 * Focus areas:
 * - Renders the welcome heading and one-line value prop.
 * - Surfaces the GitHub sign-in button.
 * - Shows an accessible error alert when sign-in fails.
 */

import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@primer/react';

import SignInPage from './page';

vi.mock('./actions', () => ({
  signInWithGitHub: vi.fn(),
}));

async function renderSignIn(params: { callbackUrl?: string; error?: string } = {}) {
  await act(async () => {
    render(
      <ThemeProvider>
        <Suspense fallback={null}>
          <SignInPage searchParams={Promise.resolve(params)} />
        </Suspense>
      </ThemeProvider>,
    );
  });
}

describe('SignInPage', () => {
  it('renders the welcome heading and value prop', async () => {
    await renderSignIn();
    expect(screen.getByRole('heading', { level: 1, name: /welcome to flight school/i })).toBeInTheDocument();
    expect(screen.getByText(/personalized challenges/i)).toBeInTheDocument();
  });

  it('renders the GitHub sign-in button', async () => {
    await renderSignIn();
    expect(screen.getByRole('button', { name: /sign in with github/i })).toBeInTheDocument();
  });

  it('shows an error alert when sign-in failed', async () => {
    await renderSignIn({ error: 'OAuthCallback' });
    expect(screen.getByRole('alert')).toHaveTextContent(/try again/i);
  });

  it('does not show an error alert by default', async () => {
    await renderSignIn();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
