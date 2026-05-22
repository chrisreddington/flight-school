import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SkippingCard } from './SkippingCard';

describe('SkippingCard', () => {
  it('renders the item-specific generation message', () => {
    render(<SkippingCard id="goal-1" itemType="goal" skeletonLines={2} />);

    expect(screen.getByText('Generating new goal...')).toBeInTheDocument();
  });

  it('omits the stop button when no stop callback is provided', () => {
    render(<SkippingCard id="goal-1" itemType="goal" skeletonLines={2} />);

    expect(screen.queryByRole('button', { name: 'Stop generating goal' })).not.toBeInTheDocument();
  });

  it('calls the stop callback with the item id', () => {
    const onStop = vi.fn();
    render(<SkippingCard id="topic-1" itemType="topic" skeletonLines={3} onStop={onStop} />);

    fireEvent.click(screen.getByRole('button', { name: 'Stop generating topic' }));

    expect(onStop).toHaveBeenCalledWith('topic-1');
  });

  it('renders the requested number of skeleton lines', () => {
    const { rerender } = render(<SkippingCard id="goal-1" itemType="goal" skeletonLines={2} />);
    expect(screen.getAllByTestId('skipping-card-skeleton')).toHaveLength(2);

    rerender(<SkippingCard id="challenge-1" itemType="challenge" skeletonLines={3} />);
    expect(screen.getAllByTestId('skipping-card-skeleton')).toHaveLength(3);
  });
});
