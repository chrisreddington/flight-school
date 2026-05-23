'use client';

/**
 * CopilotRequiredBanner (P5 / F4)
 *
 * Surfaces a friendly banner when an AI route returns 402
 * `{ error: 'copilot_required' }`. Listens for a window event dispatched
 * by `src/lib/api-client.ts` whenever it observes that response shape.
 *
 * Mounted globally in `src/app/providers.tsx` so every page that talks
 * to AI surfaces gets the banner — no per-page wiring required. The
 * banner auto-dismisses on route change so a 402 on one page doesn't
 * follow the user forever.
 */

import { Banner } from '@primer/react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  COPILOT_REQUIRED_EVENT,
  type CopilotRequiredEventDetail,
} from '@/lib/copilot/required-event';

const COPILOT_SIGN_UP_URL = 'https://github.com/features/copilot';

const DEFAULT_MESSAGE =
  'AI features need a GitHub Copilot subscription. Sign up to unlock learning chat, daily focus, and challenge feedback.';

export function CopilotRequiredBanner() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [signUpUrl, setSignUpUrl] = useState(COPILOT_SIGN_UP_URL);
  const [triggeredPath, setTriggeredPath] = useState<string | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    function onCopilotRequired(event: Event) {
      const detail = (event as CustomEvent<CopilotRequiredEventDetail>).detail;
      if (detail?.message) setMessage(detail.message);
      if (detail?.signUpUrl) setSignUpUrl(detail.signUpUrl);
      setTriggeredPath(pathname);
      setVisible(true);
    }
    window.addEventListener(COPILOT_REQUIRED_EVENT, onCopilotRequired);
    return () => window.removeEventListener(COPILOT_REQUIRED_EVENT, onCopilotRequired);
  }, [pathname]);

  // Dismiss on route change so the banner doesn't shadow unrelated pages
  // after the user navigates away from the AI surface that triggered it.
  // Visibility is derived during render to avoid a cascading effect-driven
  // re-render after navigation.
  const isVisible = visible && triggeredPath === pathname;

  if (!isVisible) return null;

  return (
    <div aria-live="polite" role="status">
      <Banner
        variant="upsell"
        title="GitHub Copilot required"
        description={message}
        primaryAction={
          <Banner.PrimaryAction
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.open(signUpUrl, '_blank', 'noopener,noreferrer');
              }
            }}
          >
            Get Copilot
          </Banner.PrimaryAction>
        }
        onDismiss={() => setVisible(false)}
      />
    </div>
  );
}
