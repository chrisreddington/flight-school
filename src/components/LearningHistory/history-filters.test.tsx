import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HistoryFilters } from './history-filters';
import type { StatusFilter, TypeFilter } from './types';

const noop = () => {};

function renderFilters(overrides: { typeFilter?: TypeFilter; statusFilter?: StatusFilter } = {}) {
  render(
    <HistoryFilters
      searchQuery=""
      onSearchChange={noop}
      typeFilter={overrides.typeFilter ?? 'all'}
      onTypeFilterChange={noop}
      statusFilter={overrides.statusFilter ?? 'all'}
      onStatusFilterChange={noop}
    />,
  );
}

describe('HistoryFilters', () => {
  it('presses only the active type filter button', () => {
    renderFilters({ typeFilter: 'challenge' });

    expect(screen.getByRole('button', { name: 'Challenges' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Goals' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Topics' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('presses only the active status filter button', () => {
    renderFilters({ statusFilter: 'completed' });

    expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Active' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Skipped' })).toHaveAttribute('aria-pressed', 'false');
  });
});
