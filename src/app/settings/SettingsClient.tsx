'use client';

import { DeleteMyDataDialog } from '@/components/DeleteMyDataDialog/DeleteMyDataDialog';
import { Button, Heading, Stack, Text } from '@primer/react';
import { TrashIcon } from '@primer/octicons-react';
import { useCallback, useState } from 'react';

import { signOutAction } from './actions';
import styles from './settings.module.css';

interface SettingsClientProps {
  login: string;
}

/**
 * Client portion of the Settings page. Owns the modal state and the
 * post-deletion sign-out hop. The server page component
 * (`page.tsx`) resolves the authenticated identity and passes the
 * GitHub login down so the modal can enforce typed-confirmation.
 */
export function SettingsClient({ login }: SettingsClientProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const onConfirmed = useCallback(async () => {
    setDialogOpen(false);
    await signOutAction();
  }, []);

  return (
    <Stack direction="vertical" gap="spacious">
      <section>
        <Heading as="h2" className={styles.sectionHeading}>
          Privacy &amp; data
        </Heading>
        <Text as="p" className={styles.sectionLead}>
          Flight School stores your chats, evaluations, and background job history per-account on the server so AI
          features can resume across devices. You can wipe everything from your account here.
        </Text>
        <Button variant="danger" leadingVisual={TrashIcon} onClick={() => setDialogOpen(true)}>
          Delete all my data
        </Button>
      </section>
      <DeleteMyDataDialog
        login={login}
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onConfirmed={onConfirmed}
      />
    </Stack>
  );
}
