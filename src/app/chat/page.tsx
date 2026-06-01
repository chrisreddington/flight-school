/**
 * `/chat` — Dedicated learning-chat surface.
 *
 * The full multi-thread chat experience (thread sidebar + transcript +
 * composer) lives here rather than embedded on the dashboard, so the
 * dashboard can read as a true overview. The page is a thin RSC shell that
 * enforces auth and then hands off to {@link ChatClient} for all interaction.
 */

import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AppHeader } from '@/components/AppHeader';
import { requireGuardedRscContext } from '@/lib/security/guard';

import { ChatClient } from './_components/ChatClient';

export default async function ChatPage() {
  const ctx = await requireGuardedRscContext('page.view');
  if (!ctx) redirect('/sign-in?callbackUrl=/chat');

  return (
    <>
      <AppHeader />
      {/* ChatClient reads the `?thread=` search param, which is dynamic IO under
          cacheComponents and must resolve below a Suspense boundary. */}
      <Suspense>
        <ChatClient />
      </Suspense>
    </>
  );
}
