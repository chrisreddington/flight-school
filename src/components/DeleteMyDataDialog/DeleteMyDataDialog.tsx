'use client';

/**
 * Delete-my-data confirmation dialog.
 *
 * Server-side enforcement lives on `DELETE /api/user/data` (request
 * body must include `confirmLogin: <github-login>` matching the
 * authenticated user). This modal exists for UX only — it gates the
 * destructive action behind an explicit username-typing step so users
 * can't fat-finger their entire history away.
 *
 * On success it calls {@link onConfirmed} (typically signs the user
 * out) so the page doesn't immediately attempt to refetch state for
 * an account that no longer has data. The authoritative signal is the
 * response's `success` flag: when it is `false` the server kept some
 * user data behind, so {@link onConfirmed} is NOT called and the user
 * stays signed in to retry. The `summary.partial` field is purely
 * informational/diagnostic — the dialog never branches on it. A
 * registry-only cleanup failure reports `success: true` (the data is
 * gone, only the owner record lingers), so it still signs out.
 */

import { ApiError, apiDelete } from '@/lib/api-client';
import { Banner, Dialog, FormControl, Stack, Text, TextInput } from '@primer/react';
import React, { useCallback, useState } from 'react';
import { signIn } from 'next-auth/react';

interface DeleteDataResponse {
  /**
   * Authoritative completion signal: `false` means user data may still be on
   * the server (a partition, activity-buffer, or legacy storage-dir wipe
   * failure), so the dialog keeps the user signed in for a retry. A
   * registry-only cleanup failure still reports `true` — the data is gone,
   * only the owner record lingers.
   */
  success: boolean;
  summary?: {
    partial?: true;
    failed?: string[];
    registryCleanupPending?: true;
  };
}

export interface DeleteMyDataDialogProps {
  /** Caller's GitHub login as known to the authenticated session. */
  login: string;
  isOpen: boolean;
  onClose: () => void;
  /** Called when the server reports successful deletion. */
  onConfirmed: () => void;
}

export function DeleteMyDataDialog({ login, isOpen, onClose, onConfirmed }: DeleteMyDataDialogProps) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const matches = typed === login;

  const handleConfirm = useCallback(async () => {
    if (!matches || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiDelete<DeleteDataResponse>('/api/user/data', {
        body: JSON.stringify({ confirmLogin: login }),
      });
      if (!result.success) {
        // The server kept some user data behind. Don't sign the user out —
        // surface the failure so they can retry from a still-authed session.
        // A registry-only cleanup failure reports `success: true`, so it
        // correctly falls through to sign-out below.
        setError('Some of your data could not be deleted. Please try again in a moment.');
        return;
      }
      onConfirmed();
    } catch (err) {
      if (err instanceof ApiError && err.context?.code === 'recent_auth_required') {
        // Sudo-mode style: bounce through a fresh sign-in then return to
        // /settings so the user can retry the deletion within the window.
        const callbackUrl =
          typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '/settings';
        await signIn('github', { callbackUrl });
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to delete data. Try again.');
    } finally {
      setSubmitting(false);
    }
  }, [login, matches, submitting, onConfirmed]);

  if (!isOpen) return null;

  return (
    <Dialog
      title="Delete all my data?"
      subtitle="This cannot be undone."
      onClose={onClose}
      width="medium"
      footerButtons={[
        { content: 'Cancel', onClick: onClose, disabled: submitting },
        {
          content: submitting ? 'Deleting…' : 'Delete everything',
          onClick: handleConfirm,
          buttonType: 'danger',
          disabled: !matches || submitting,
        },
      ]}
    >
      <Stack direction="vertical" gap="normal">
        <Text as="p">
          This will permanently delete every conversation, evaluation, focus item, and background job stored on the
          server for your account. Your session will be signed out afterwards.
        </Text>
        <Text as="p">
          To confirm, type your GitHub login <strong>{login}</strong> below.
        </Text>
        <FormControl>
          <FormControl.Label visuallyHidden>Confirm by typing your GitHub login</FormControl.Label>
          <TextInput
            block
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={login}
            aria-label="Type your GitHub login to confirm"
            autoComplete="off"
          />
        </FormControl>
        {error ? <Banner variant="critical" title="Could not delete data" description={error} /> : null}
      </Stack>
    </Dialog>
  );
}
