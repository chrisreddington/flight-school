import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { SettingsClient } from './SettingsClient';
import { signOutAction } from './actions';

// Hoisted mock fns so the module factories below can reference them. The
// debugState object lets individual tests flip the initial developer-mode
// value (the mock reads it live) to cover both the off->on and on->off paths.
const { setDebugMode, debugState } = vi.hoisted(() => ({
  setDebugMode: vi.fn(),
  debugState: { isDebugMode: false },
}));

// Breadcrumb context is only used for side-effects (registration); stub it
// so the hook doesn't error in a bare render tree.
vi.mock('@/contexts/breadcrumb-context', () => ({
  useBreadcrumb: vi.fn(),
}));

// Developer-mode preference comes from the debug context (localStorage-backed
// in the app); stub it so the toggle has a deterministic initial state.
vi.mock('@/contexts/debug-context', () => ({
  useDebugMode: () => ({ isDebugMode: debugState.isDebugMode, setDebugMode, toggleDebugMode: vi.fn() }),
}));

// Server action — cannot run in jsdom.
vi.mock('./actions', () => ({
  signOutAction: vi.fn().mockResolvedValue(undefined),
}));

// localStorage-clearing helper — test the UI flow without touching real storage.
vi.mock('@/lib/storage/clear-local-data', () => ({
  clearAllLocalData: vi.fn().mockResolvedValue(undefined),
}));

// Modal dialog — tests focus on SettingsClient behaviour, not dialog internals.
vi.mock('@/components/DeleteMyDataDialog/DeleteMyDataDialog', () => ({
  DeleteMyDataDialog: vi.fn(() => null),
}));

function renderSettings(login = 'octocat') {
  return render(<SettingsClient login={login} />);
}

describe('SettingsClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    debugState.isDebugMode = false;
  });

  it('renders "Settings" as the page h1', () => {
    renderSettings();
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  });

  it('exposes a "Danger zone" region landmark', () => {
    renderSettings();
    expect(screen.getByRole('region', { name: 'Danger zone' })).toBeInTheDocument();
  });

  it('orders the sections account -> preferences -> danger zone so destructive actions sit last', () => {
    renderSettings();
    const account = screen.getByRole('region', { name: 'Account' });
    const preferences = screen.getByRole('region', { name: 'Preferences' });
    const dangerZone = screen.getByRole('region', { name: 'Danger zone' });

    expect(account.compareDocumentPosition(preferences) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(preferences.compareDocumentPosition(dangerZone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  describe('account section', () => {
    it('shows the signed-in GitHub handle and a link to that profile', () => {
      renderSettings('monalisa');
      const account = screen.getByRole('region', { name: 'Account' });

      expect(within(account).getByText('@monalisa')).toBeInTheDocument();
      expect(within(account).getByRole('link', { name: /view your github profile/i })).toHaveAttribute(
        'href',
        'https://github.com/monalisa',
      );
    });

    it('signs the user out when "Sign out" is clicked', () => {
      renderSettings();
      const account = screen.getByRole('region', { name: 'Account' });

      fireEvent.click(within(account).getByRole('button', { name: /sign out/i }));

      expect(signOutAction).toHaveBeenLastCalledWith();
    });
  });

  describe('preferences section', () => {
    it('renders the developer-mode toggle reflecting the current state', () => {
      renderSettings();
      const toggle = screen.getByRole('checkbox', { name: /developer mode/i });
      expect(toggle).not.toBeChecked();
    });

    it('updates the developer-mode preference when the toggle is flipped', () => {
      renderSettings();

      fireEvent.click(screen.getByRole('checkbox', { name: /developer mode/i }));

      expect(setDebugMode).toHaveBeenLastCalledWith(true);
    });

    it('reflects developer mode already enabled and turns it back off when flipped', () => {
      debugState.isDebugMode = true;
      renderSettings();

      const toggle = screen.getByRole('checkbox', { name: /developer mode/i });
      expect(toggle).toBeChecked();

      fireEvent.click(toggle);

      expect(setDebugMode).toHaveBeenLastCalledWith(false);
    });
  });

  it('contains both destructive action buttons inside the Danger zone region', () => {
    renderSettings();
    const danger = screen.getByRole('region', { name: 'Danger zone' });
    expect(within(danger).getByRole('button', { name: /reset app data/i })).toBeInTheDocument();
    expect(within(danger).getByRole('button', { name: /delete all my data/i })).toBeInTheDocument();
  });

  describe('local reset flow', () => {
    it('shows a critical confirmation banner when "Reset app data" is clicked', () => {
      renderSettings();
      const danger = screen.getByRole('region', { name: 'Danger zone' });

      fireEvent.click(within(danger).getByRole('button', { name: /reset app data/i }));

      expect(screen.getByText('Reset local data?')).toBeInTheDocument();
    });

    it('dismisses the banner when "Cancel" is clicked', () => {
      renderSettings();
      const danger = screen.getByRole('region', { name: 'Danger zone' });

      fireEvent.click(within(danger).getByRole('button', { name: /reset app data/i }));
      // Banner renders its actions twice for responsive layout — click the first Cancel.
      fireEvent.click(screen.getAllByRole('button', { name: /cancel/i })[0]);

      expect(screen.queryByText('Reset local data?')).not.toBeInTheDocument();
    });

    it('calls clearAllLocalData when the banner confirm is clicked', async () => {
      const { clearAllLocalData } = await import('@/lib/storage/clear-local-data');
      Object.defineProperty(window, 'location', { writable: true, value: { href: '' } });

      renderSettings();
      const danger = screen.getByRole('region', { name: 'Danger zone' });

      fireEvent.click(within(danger).getByRole('button', { name: /reset app data/i }));
      // Banner renders its actions twice for responsive layout — click the first match.
      fireEvent.click(screen.getAllByRole('button', { name: /reset app data/i })[0]);

      expect(clearAllLocalData).toHaveBeenCalledOnce();
    });
  });

  describe('account delete flow', () => {
    it('opens the DeleteMyDataDialog when "Delete all my data" is clicked', async () => {
      const { DeleteMyDataDialog } = await import('@/components/DeleteMyDataDialog/DeleteMyDataDialog');
      const mockDialog = vi.mocked(DeleteMyDataDialog);

      renderSettings();
      const danger = screen.getByRole('region', { name: 'Danger zone' });

      expect(mockDialog).toHaveBeenLastCalledWith(expect.objectContaining({ isOpen: false }), undefined);

      fireEvent.click(within(danger).getByRole('button', { name: /delete all my data/i }));

      expect(mockDialog).toHaveBeenLastCalledWith(expect.objectContaining({ isOpen: true }), undefined);
    });

    it('passes the login prop through to DeleteMyDataDialog', async () => {
      const { DeleteMyDataDialog } = await import('@/components/DeleteMyDataDialog/DeleteMyDataDialog');
      const mockDialog = vi.mocked(DeleteMyDataDialog);

      renderSettings('monalisa');

      expect(mockDialog).toHaveBeenCalledWith(expect.objectContaining({ login: 'monalisa' }), undefined);
    });
  });
});
