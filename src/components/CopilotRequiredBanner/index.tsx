'use client';

/**
 * CopilotRequiredBanner (P5)
 *
 * Surfaces a friendly banner when an AI route returns 402
 * `{ error: 'copilot_required' }`. Listens for a window event dispatched
 * by `src/lib/api-client.ts` whenever it observes that response shape.
 *
 * Pages that fetch AI APIs through `apiPost` / `apiGet` automatically
 * trigger this banner; no per-call wiring required.
 */

import { Banner } from '@primer/react';
import { useEffect, useState } from 'react';

import {
  COPILOT_REQUIRED_EVENT,
  type CopilotRequiredEventDetail,
} from '@/lib/copilot/required-event';

export const COPILOT_SIGN_UP_URL = 'https://github.com/features/copilot';

const DEFAULT_MESSAGE =
  'AI features need a GitHub Copilot subscription. Sign up to unlock learning chat, daily focus, and challenge feedback.';

export function CopilotRequiredBanner() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [signUpUrl, setSignUpUrl] = useState(COPILOT_SIGN_UP_URL);

  useEffect(() => {
    function onCopilotRequired(event: Event) {
      const detail = (event as CustomEvent<CopilotRequiredEventDetail>).detail;
      if (detail?.message) setMessage(detail.message);
      if (detail?.signUpUrl) setSignUpUrl(detail.signUpUrl);
      setVisible(true);
    }
    window.addEventListener(COPILOT_REQUIRED_EVENT, onCopilotRequired);
    return () => window.removeEventListener(COPILOT_REQUIRED_EVENT, onCopilotRequired);
  }, []);

  if (!visible) return null;

  return (
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
  );
}

export default CopilotRequiredBanner;
