'use client';

import { DeleteMyDataDialog } from '@/components/DeleteMyDataDialog/DeleteMyDataDialog';
import { PageHeader } from '@/components/PageHeader';
import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import { useDebugMode } from '@/contexts/debug-context';
import { clearAllLocalData } from '@/lib/storage/clear-local-data';
import {
  Avatar,
  Banner,
  Button,
  Checkbox,
  FormControl,
  Heading,
  Link,
  SplitPageLayout,
  Stack,
  Text,
} from '@primer/react';
import { MarkGithubIcon, SignOutIcon, TrashIcon } from '@primer/octicons-react';
import { useCallback, useState } from 'react';

import { signOutAction } from './actions';
import styles from './settings.module.css';

interface SettingsClientProps {
  login: string;
}

/**
 * Client portion of the Settings page. Surfaces the signed-in GitHub account,
 * device-local preferences (the developer-mode toggle), and the two
 * destructive data actions — ordered least-to-most dangerous so the danger
 * zone sits last. The server page component (`page.tsx`) resolves the
 * authenticated identity and passes the GitHub login down so the avatar,
 * profile link, and account-deletion modal all bind to the real user.
 *
 * Developer mode is a per-device view setting (localStorage, via
 * `useDebugMode`), not server-persisted account data — so it doesn't need the
 * multi-tenant server storage the data actions use.
 */
export function SettingsClient({ login }: SettingsClientProps) {
  useBreadcrumb('/settings', 'Settings', '/settings');

  const { isDebugMode, setDebugMode } = useDebugMode();
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
          description="Manage your account, preferences, and the data Flight School stores for you."
        />

        <section aria-labelledby="account-heading" className={styles.section}>
          <Heading as="h2" id="account-heading" className={styles.sectionGroupHeading}>
            Account
          </Heading>
          <section className={styles.card}>
            <Stack direction="horizontal" align="center" justify="space-between" gap="normal" wrap="wrap">
              <Stack direction="horizontal" align="center" gap="normal">
                <Avatar src={`https://github.com/${login}.png?size=80`} size={48} alt="" />
                <Stack direction="vertical" gap="none">
                  <Text className={styles.accountName}>@{login}</Text>
                  <Link
                    href={`https://github.com/${login}`}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.accountLink}
                  >
                    <MarkGithubIcon size={14} /> View your GitHub profile
                  </Link>
                </Stack>
              </Stack>
              <Button leadingVisual={SignOutIcon} onClick={() => void signOutAction()}>
                Sign out
              </Button>
            </Stack>
          </section>
        </section>

        <section aria-labelledby="preferences-heading" className={styles.section}>
          <Heading as="h2" id="preferences-heading" className={styles.sectionGroupHeading}>
            Preferences
          </Heading>
          <section className={styles.card}>
            <FormControl>
              <Checkbox checked={isDebugMode} onChange={(event) => setDebugMode(event.target.checked)} />
              <FormControl.Label>Developer mode</FormControl.Label>
              <FormControl.Caption>
                Show tool names, performance metrics, and the AI activity panel (⌘⇧A on this device).
              </FormControl.Caption>
            </FormControl>
          </section>
        </section>

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
