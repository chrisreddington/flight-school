import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActivityGraph } from './activity-graph';
import type { ActivityDay } from './types';

const noop = () => {};

function makeActivity(): ActivityDay[] {
  return [
    { date: '2024-01-15', count: 1, weekIndex: 0, dayOfWeek: 1 },
    { date: '2024-01-16', count: 2, weekIndex: 0, dayOfWeek: 2 },
  ];
}

describe('ActivityGraph', () => {
  it('marks only the selected day cell as pressed', () => {
    render(<ActivityGraph activity={makeActivity()} selectedDate="2024-01-15" onSelectDate={noop} />);

    const selectedCell = screen.getByRole('button', { name: '2024-01-15: 1 item' });
    const unselectedCell = screen.getByRole('button', { name: '2024-01-16: 2 items' });

    expect(selectedCell).toHaveAttribute('aria-pressed', 'true');
    expect(unselectedCell).toHaveAttribute('aria-pressed', 'false');
  });

  it('pluralizes the day-cell label by item count', () => {
    render(<ActivityGraph activity={makeActivity()} selectedDate={null} onSelectDate={noop} />);

    // The accessible name carries the singular/plural noun; matching it by name
    // fails if the pluralization ternary regresses.
    expect(screen.getByRole('button', { name: '2024-01-15: 1 item' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2024-01-16: 2 items' })).toBeInTheDocument();
  });
});
