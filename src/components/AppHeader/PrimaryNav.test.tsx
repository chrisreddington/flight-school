import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@primer/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PrimaryNav } from './PrimaryNav';

// next/navigation drives the active-item highlight, so the pathname is
// controllable to exercise the aria-current branch per route.
let mockPathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

function renderNav() {
  return render(
    <ThemeProvider>
      <PrimaryNav />
    </ThemeProvider>,
  );
}

describe('PrimaryNav', () => {
  afterEach(() => {
    mockPathname = '/';
  });

  it('renders every core destination as a link', () => {
    renderNav();
    expect(screen.getByRole('link', { name: /Dashboard/ })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /Chat/ })).toHaveAttribute('href', '/chat');
    expect(screen.getByRole('link', { name: /Skills/ })).toHaveAttribute('href', '/skills');
    expect(screen.getByRole('link', { name: /Habits/ })).toHaveAttribute('href', '/habits');
    expect(screen.getByRole('link', { name: /History/ })).toHaveAttribute('href', '/history');
  });

  it('labels the navigation landmark for assistive tech', () => {
    renderNav();
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
  });

  it('marks the item matching the current pathname as the current page', () => {
    mockPathname = '/skills';
    renderNav();
    expect(screen.getByRole('link', { name: /Skills/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Dashboard/ })).not.toHaveAttribute('aria-current', 'page');
  });

  it('keeps History current on query-only changes (exact-path match)', () => {
    // /history?tab=stats resolves to pathname "/history", so History stays lit.
    mockPathname = '/history';
    renderNav();
    expect(screen.getByRole('link', { name: /History/ })).toHaveAttribute('aria-current', 'page');
  });

  it('highlights no item on routes outside the primary set', () => {
    mockPathname = '/settings';
    renderNav();
    expect(screen.getByRole('link', { name: /Dashboard/ })).not.toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Skills/ })).not.toHaveAttribute('aria-current', 'page');
  });
});
