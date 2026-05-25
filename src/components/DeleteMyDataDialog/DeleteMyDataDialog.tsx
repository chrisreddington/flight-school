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
 * an account that no longer has data.
 */

import { ApiError, apiDelete } from '@/lib/api-client';
import { Banner, Dialog, FormControl, Stack, Text, TextInput } from '@primer/react';
import React, { useCallback, useState } from 'react';
import { signIn } from 'next-auth/react';

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
      await apiDelete<{ success: boolean }>('/api/user/data', {
        body: JSON.stringify({ confirmLogin: login }),
      });
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
