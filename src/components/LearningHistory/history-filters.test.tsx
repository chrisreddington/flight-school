import { render, screen, within } from '@testing-library/react';
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

    // Scope to the Type group so the shared "All" label is unambiguous, then
    // assert exclusivity across every button in the group.
    const typeGroup = within(screen.getByRole('group', { name: 'Type' }));
    expect(typeGroup.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
    expect(typeGroup.getByRole('button', { name: 'Challenges' })).toHaveAttribute('aria-pressed', 'true');
    expect(typeGroup.getByRole('button', { name: 'Goals' })).toHaveAttribute('aria-pressed', 'false');
    expect(typeGroup.getByRole('button', { name: 'Topics' })).toHaveAttribute('aria-pressed', 'false');
    expect(typeGroup.getByRole('button', { name: 'Habits' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('presses only the active status filter button', () => {
    renderFilters({ statusFilter: 'completed' });

    const statusGroup = within(screen.getByRole('group', { name: 'Status' }));
    expect(statusGroup.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
    expect(statusGroup.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-pressed', 'true');
    expect(statusGroup.getByRole('button', { name: 'Active' })).toHaveAttribute('aria-pressed', 'false');
    expect(statusGroup.getByRole('button', { name: 'Skipped' })).toHaveAttribute('aria-pressed', 'false');
  });
});
