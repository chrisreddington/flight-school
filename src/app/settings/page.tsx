import { getUserContext } from '@/lib/auth/context';
import { Heading, Text } from '@primer/react';
import { redirect } from 'next/navigation';

import { AppHeader } from '@/components/AppHeader';
import layoutStyles from '@/styles/two-column-layout.module.css';

import { SettingsClient } from './SettingsClient';
import styles from './settings.module.css';

/**
 * `/settings` — per-user preferences page. Currently surfaces the
 * "Privacy & data" section (delete-all-my-data). Server-rendered so
 * the GitHub login the modal needs for confirmation is resolved
 * server-side; unauthenticated callers are redirected to sign-in.
 *
 * Wrapped in the shared app shell ({@link AppHeader} + layout root) so it
 * matches every other authenticated page rather than rendering bare content.
 */
export default async function SettingsPage() {
  const ctx = await getUserContext();
  if (!ctx) {
    redirect('/sign-in?callbackUrl=/settings');
  }

  return (
    <div className={layoutStyles.root}>
      <AppHeader />
      <main className={styles.main}>
        <div className={styles.pageHeader}>
          <Heading as="h1" className={styles.pageHeading}>
            Settings
          </Heading>
          <Text as="p" className={styles.pageSubtitle}>
            Manage your account preferences and the data Flight School stores for you.
          </Text>
        </div>
        <SettingsClient login={ctx.login} />
      </main>
    </div>
  );
}
