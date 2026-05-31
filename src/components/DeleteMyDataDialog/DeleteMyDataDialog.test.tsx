/**
 * Tests for DeleteMyDataDialog.
 *
 * Focus areas (S1.5 panel fix B — partial-delete safety):
 * - A partial server deletion (`success: false`) must NOT call
 *   `onConfirmed` (which signs the user out), and must surface an error
 *   so the user stays authed and can retry.
 * - A fully successful deletion calls `onConfirmed`.
 * - A registry-only cleanup failure (`success: true`,
 *   `registryCleanupPending: true`) still signs the user out — the data is
 *   gone, only the owner record lingers.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@primer/react';

const { apiDeleteMock } = vi.hoisted(() => ({ apiDeleteMock: vi.fn() }));

vi.mock('@/lib/api-client', () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public readonly status?: number,
      public readonly context?: Record<string, unknown>,
    ) {
      super(message);
    }
  }
  return { ApiError, apiDelete: apiDeleteMock };
});

vi.mock('next-auth/react', () => ({ signIn: vi.fn() }));

import { DeleteMyDataDialog } from './DeleteMyDataDialog';

function renderDialog() {
  let confirmedCount = 0;
  render(
    <ThemeProvider>
      <DeleteMyDataDialog
        login="octocat"
        isOpen
        onClose={() => {}}
        onConfirmed={() => {
          confirmedCount += 1;
        }}
      />
    </ThemeProvider>,
  );
  return { getConfirmedCount: () => confirmedCount };
}

async function confirmDeletion() {
  const input = screen.getByLabelText('Type your GitHub login to confirm');
  fireEvent.change(input, { target: { value: 'octocat' } });
  fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }));
}

afterEach(() => {
  apiDeleteMock.mockReset();
});

describe('DeleteMyDataDialog', () => {
  it('does not sign the user out when the server reports a partial deletion', async () => {
    apiDeleteMock.mockResolvedValue({ success: false, summary: { partial: true, failed: ['store-data:focus'] } });
    const { getConfirmedCount } = renderDialog();

    await confirmDeletion();

    await waitFor(() => expect(screen.getByText(/could not be deleted/i)).toBeInTheDocument());
    expect(getConfirmedCount()).toBe(0);
  });

  it('signs the user out on a fully successful deletion', async () => {
    apiDeleteMock.mockResolvedValue({ success: true, summary: {} });
    const { getConfirmedCount } = renderDialog();

    await confirmDeletion();

    await waitFor(() => expect(getConfirmedCount()).toBe(1));
  });

  it('signs the user out when only the registry cleanup is pending', async () => {
    // Data is fully gone; only the orphaned owner record lingers for a sweep.
    apiDeleteMock.mockResolvedValue({
      success: true,
      summary: { failed: ['store-registry'], registryCleanupPending: true },
    });
    const { getConfirmedCount } = renderDialog();

    await confirmDeletion();

    await waitFor(() => expect(getConfirmedCount()).toBe(1));
  });
});
