'use client';

import { DeleteMyDataDialog } from '@/components/DeleteMyDataDialog/DeleteMyDataDialog';
import { PageHeader } from '@/components/PageHeader';
import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import { clearAllLocalData } from '@/lib/storage/clear-local-data';
import { Banner, Button, Heading, SplitPageLayout, Stack, Text } from '@primer/react';
import { TrashIcon } from '@primer/octicons-react';
import { useCallback, useState } from 'react';

import { signOutAction } from './actions';
import styles from './settings.module.css';

interface SettingsClientProps {
  login: string;
}

/**
 * Client portion of the Settings page. Hosts the two destructive data
 * actions: a server-side account wipe (typed-confirmation dialog) and a
 * device-local reset (inline critical banner). The server page component
 * (`page.tsx`) resolves the authenticated identity and passes the GitHub
 * login down so the account-deletion modal can enforce typed-confirmation.
 */
export function SettingsClient({ login }: SettingsClientProps) {
  useBreadcrumb('/settings', 'Settings', '/settings');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [showLocalResetConfirm, setShowLocalResetConfirm] = useState(false);

  const onConfirmed = useCallback(async () => {
    setDialogOpen(false);
    await signOutAction();
  }, []);

  const onResetLocalData = useCallback(async () => {
    await clearAllLocalData();
    window.location.href = '/';
  }, []);

  return (
    <SplitPageLayout className={styles.layout}>
      <SplitPageLayout.Content>
        <PageHeader
          title="Settings"
          description="Manage your account preferences and the data Flight School stores for you."
        />
        <section aria-labelledby="danger-zone-heading" className={styles.dangerZoneSection}>
          <Heading as="h2" id="danger-zone-heading" className={styles.dangerZoneHeading}>
            Danger zone
          </Heading>
          <Stack direction="vertical" gap="spacious">
            <section className={styles.card}>
              <Heading as="h3" className={styles.sectionHeading}>
                Reset app data on this device
              </Heading>
              <Text as="p" className={styles.sectionLead}>
                Clears locally stored skills, focus history, chat threads, workspaces, habits, and the challenge queue
                from this browser. Your account and server-side history are kept — re-syncing restores detected skills.
              </Text>
              {showLocalResetConfirm ? (
                <Banner
                  variant="critical"
                  title="Reset local data?"
                  description="This clears Flight School data stored in this browser. It can't be undone here."
                  primaryAction={<Banner.PrimaryAction onClick={onResetLocalData}>Reset app data</Banner.PrimaryAction>}
                  secondaryAction={
                    <Banner.SecondaryAction onClick={() => setShowLocalResetConfirm(false)}>
                      Cancel
                    </Banner.SecondaryAction>
                  }
                />
              ) : (
                <Button variant="danger" leadingVisual={TrashIcon} onClick={() => setShowLocalResetConfirm(true)}>
                  Reset app data
                </Button>
              )}
            </section>

            <section className={styles.card}>
              <Heading as="h3" className={styles.sectionHeading}>
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
          </Stack>
        </section>
      </SplitPageLayout.Content>
      <DeleteMyDataDialog
        login={login}
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onConfirmed={onConfirmed}
      />
    </SplitPageLayout>
  );
}
