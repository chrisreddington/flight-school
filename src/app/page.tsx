'use client';

import { Dashboard } from '@/components/Dashboard';
import { Banner } from '@primer/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

function DashboardWithBanner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dismissed, setDismissed] = useState(false);

  const showSuccess = !dismissed && searchParams.get('challengeAdded') === '1';

  function handleDismiss() {
    setDismissed(true);
    // Remove the query param without adding a history entry
    router.replace('/');
  }

  return (
    <>
      {showSuccess && (
        <Banner
          title="Challenge added"
          description="Your custom challenge has been added to the queue."
          variant="success"
          onDismiss={handleDismiss}
        />
      )}
      <Dashboard />
    </>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<Dashboard />}>
      <DashboardWithBanner />
    </Suspense>
  );
}
