/**
 * `/skills` — Server-rendered skill-profile page.
 *
 * The user's profile is read directly from disk via the per-user server
 * storage helper, then handed to {@link SkillsClient} for all interaction.
 * This removes the previous client-side fetch+spinner round-trip on first
 * paint.
 */

import { redirect } from 'next/navigation';

import { AppHeader } from '@/components/AppHeader';
import { requireGuardedRscContext } from '@/lib/security/guard';
import { readUserSkillsProfile } from '@/lib/skills/server';

import { SkillsClient } from './_components/SkillsClient';

export default async function SkillProfilePage() {
  const ctx = await requireGuardedRscContext('page.view');
  if (!ctx) redirect('/sign-in?callbackUrl=/skills');

  const initialProfile = await readUserSkillsProfile();

  return (
    <>
      <AppHeader />
      <SkillsClient initialProfile={initialProfile} />
    </>
  );
}
