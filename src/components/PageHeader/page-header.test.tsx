import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageHeader } from './index';

describe('PageHeader', () => {
  it('renders the title as a single h1 by default', () => {
    render(<PageHeader title="Dashboard" />);
    expect(screen.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument();
    expect(document.querySelectorAll('h1')).toHaveLength(1);
  });

  it('renders the title at the caller-specified heading level', () => {
    render(<PageHeader title="Section" headingLevel="h2" />);
    expect(screen.getByRole('heading', { name: 'Section', level: 2 })).toBeInTheDocument();
  });

  it('renders the description when provided', () => {
    render(<PageHeader title="Settings" description="Manage your account preferences." />);
    expect(screen.getByText('Manage your account preferences.')).toBeInTheDocument();
  });

  it('omits the description slot when the description prop is absent', () => {
    const { container } = render(<PageHeader title="Settings" />);
    // Only the title area should render — no description text in the tree
    expect(container.textContent).toBe('Settings');
  });

  it('renders the leading visual when provided', () => {
    render(<PageHeader title="Skills" leadingVisual={<span data-testid="page-icon">icon</span>} />);
    expect(screen.getByTestId('page-icon')).toBeInTheDocument();
  });

  it('omits the leading visual slot when the leadingVisual prop is absent', () => {
    render(<PageHeader title="Skills" />);
    expect(screen.queryByTestId('page-icon')).not.toBeInTheDocument();
  });

  it('renders actions when provided', () => {
    render(<PageHeader title="Page" actions={<button>New item</button>} />);
    expect(screen.getByRole('button', { name: 'New item' })).toBeInTheDocument();
  });

  it('omits the actions slot when the actions prop is absent', () => {
    render(<PageHeader title="Page" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders actions outside the title area so Primer right-aligns them', () => {
    // Regression guard: nesting PageHeader.Actions inside TitleArea collapses
    // it into the shrink-wrapped title row and renders it left of the title.
    // Actions must be a direct sibling of TitleArea under the PageHeader root.
    const { container } = render(<PageHeader title="Page" actions={<button>New item</button>} />);
    const actionsButton = screen.getByRole('button', { name: 'New item' });
    const titleArea = container.querySelector('[class*="PageHeader-TitleArea"]');

    expect(titleArea).not.toBeNull();
    expect(titleArea?.contains(actionsButton)).toBe(false);
  });

  it('accepts a ReactNode description for inline skeleton composition', () => {
    render(<PageHeader title="Dashboard" description={<span data-testid="greeting-skeleton">Loading…</span>} />);
    expect(screen.getByTestId('greeting-skeleton')).toBeInTheDocument();
  });
});
