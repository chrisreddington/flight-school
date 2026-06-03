import { getUserContext } from '@/lib/auth/context';
import { redirect } from 'next/navigation';

import { AppHeader } from '@/components/AppHeader';

import { SettingsClient } from './SettingsClient';

/**
 * `/settings` — per-user preferences page. Server shell: resolves auth,
 * renders the shared AppHeader, then hands off to the `'use client'` island
 * which owns the PageHeader + SplitPageLayout + destructive-action flows.
 */
export default async function SettingsPage() {
  const ctx = await getUserContext();
  if (!ctx) {
    redirect('/sign-in?callbackUrl=/settings');
  }

  return (
    <>
      <AppHeader />
      <SettingsClient login={ctx.login} />
    </>
  );
}
