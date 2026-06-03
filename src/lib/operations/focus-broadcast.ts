import 'client-only';

import { focusStore } from '@/lib/focus/storage';

const FOCUS_INVALIDATE_EVENT = 'focus-invalidate';

const CHANNEL_NAME = 'focus-invalidate';
const STORAGE_FALLBACK_KEY = 'focus-invalidate-tick';

let activeChannel: BroadcastChannel | null = null;
let subscriberCount = 0;

function acquireChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null;
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!activeChannel) {
    activeChannel = new BroadcastChannel(CHANNEL_NAME);
  }
  subscriberCount += 1;
  return activeChannel;
}

function releaseChannel(): void {
  subscriberCount = Math.max(0, subscriberCount - 1);
  if (subscriberCount === 0 && activeChannel) {
    activeChannel.close();
    activeChannel = null;
  }
}

type HotMeta = ImportMeta & { hot?: { dispose: (callback: () => void) => void } };
if (typeof import.meta !== 'undefined' && (import.meta as HotMeta).hot) {
  (import.meta as HotMeta).hot?.dispose(() => {
    activeChannel?.close();
    activeChannel = null;
    subscriberCount = 0;
  });
}

export function broadcastFocusInvalidate(): void {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent(FOCUS_INVALIDATE_EVENT));

  const channel = acquireChannel();
  if (channel) {
    try {
      channel.postMessage({ type: 'invalidate', at: Date.now() });
    } finally {
      releaseChannel();
    }
    return;
  }

  try {
    localStorage.setItem(STORAGE_FALLBACK_KEY, String(Date.now()));
  } catch {
    // Ignore private-mode/localStorage write failures.
  }
}

export function subscribeFocusInvalidate(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const windowHandler = () => handler();
  const storageHandler = (event: StorageEvent) => {
    if (event.key === STORAGE_FALLBACK_KEY) {
      handler();
    }
  };

  window.addEventListener(FOCUS_INVALIDATE_EVENT, windowHandler);
  window.addEventListener('storage', storageHandler);

  const channel = acquireChannel();
  const channelHandler = () => handler();
  channel?.addEventListener('message', channelHandler);

  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;

    window.removeEventListener(FOCUS_INVALIDATE_EVENT, windowHandler);
    window.removeEventListener('storage', storageHandler);
    channel?.removeEventListener('message', channelHandler);
    if (channel) {
      releaseChannel();
    }
  };
}

export async function invalidateFocusCache(): Promise<void> {
  await focusStore.clearTodaysFocus();
  broadcastFocusInvalidate();
}
