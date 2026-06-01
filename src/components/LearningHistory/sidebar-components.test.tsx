import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DateNavigation } from './sidebar-components';
import type { HistoryEntry } from './types';

const noop = () => {};

function makeEntry(dateKey: string, displayDate: string): HistoryEntry {
  return {
    dateKey,
    displayDate,
    accessibleDate: displayDate,
    items: [],
    totalCount: 0,
    completedCount: 0,
    skippedCount: 0,
  };
}

function renderDateNavigation(selectedDate: string | null) {
  const groupedEntries = new Map<string, HistoryEntry[]>([
    ['January 2024', [makeEntry('2024-01-15', 'Jan 15'), makeEntry('2024-01-16', 'Jan 16')]],
  ]);

  render(
    <DateNavigation
      groupedEntries={groupedEntries}
      expandedMonths={new Set(['January 2024'])}
      onToggleMonth={noop}
      selectedDate={selectedDate}
      onSelectDate={noop}
    />,
  );
}

describe('DateNavigation', () => {
  it('presses only the day button matching the selected date', () => {
    renderDateNavigation('2024-01-15');

    expect(screen.getByRole('button', { name: /Jan 15/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Jan 16/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('presses no day button when no date is selected', () => {
    renderDateNavigation(null);

    expect(screen.getByRole('button', { name: /Jan 15/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Jan 16/ })).toHaveAttribute('aria-pressed', 'false');
  });
});
