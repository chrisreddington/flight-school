import { getUserContext } from '@/lib/auth/context';
import { Heading } from '@primer/react';
import { redirect } from 'next/navigation';

import { SettingsClient } from './SettingsClient';
import styles from './settings.module.css';

/**
 * `/settings` — per-user preferences page. Currently surfaces the
 * "Privacy & data" section (delete-all-my-data). Server-rendered so
 * the GitHub login the modal needs for confirmation is resolved
 * server-side; unauthenticated callers are redirected to sign-in.
 */
export default async function SettingsPage() {
  const ctx = await getUserContext();
  if (!ctx) {
    redirect('/sign-in?callbackUrl=/settings');
  }

  return (
    <main className={styles.main}>
      <Heading as="h1" className={styles.pageHeading}>
        Settings
      </Heading>
      <SettingsClient login={ctx.login} />
    </main>
  );
}
