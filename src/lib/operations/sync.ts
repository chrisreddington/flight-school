/**
 * Cross-page synchronization service for UI refresh events.
 */

import { throttleRAF } from '@/lib/utils/throttle';

export const SYNC_FOCUS_DATA_CHANGED_EVENT = 'focus-data-changed';
export const SYNC_THREAD_DATA_CHANGED_EVENT = 'thread-data-changed';

export type SynchronizationEvent =
  | { type: 'focus-data-changed' }
  | { type: 'thread-data-changed'; threadId?: string };

export type SynchronizationListener = (event: SynchronizationEvent) => void;

/**
 * Centralizes custom event subscriptions with throttled delivery.
 */
export class SynchronizationService {
  private listeners = new Set<SynchronizationListener>();
  private pendingEvent: SynchronizationEvent | null = null;
  private isListening = false;
  private notifyThrottled = throttleRAF(() => this.flush());

  /** Subscribe to synchronization events across tabs and routes. */
  subscribe(listener: SynchronizationListener): () => void {
    this.listeners.add(listener);
    this.start();

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stop();
      }
    };
  }

  private start(): void {
    if (this.isListening || typeof window === 'undefined') {
      return;
    }

    window.addEventListener(SYNC_FOCUS_DATA_CHANGED_EVENT, this.handleFocusEvent);
    window.addEventListener(SYNC_THREAD_DATA_CHANGED_EVENT, this.handleThreadEvent);
    this.isListening = true;
  }

  private stop(): void {
    if (!this.isListening || typeof window === 'undefined') {
      return;
    }

    window.removeEventListener(SYNC_FOCUS_DATA_CHANGED_EVENT, this.handleFocusEvent);
    window.removeEventListener(SYNC_THREAD_DATA_CHANGED_EVENT, this.handleThreadEvent);
    this.notifyThrottled.cancel();
    this.pendingEvent = null;
    this.isListening = false;
  }

  private enqueue(event: SynchronizationEvent): void {
    if (this.listeners.size === 0) {
      return;
    }

    this.pendingEvent = event;
    this.notifyThrottled();
  }

  private flush(): void {
    if (!this.pendingEvent) {
      return;
    }

    const event = this.pendingEvent;
    this.pendingEvent = null;

    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private handleFocusEvent = () => {
    this.enqueue({ type: 'focus-data-changed' });
  };

  private handleThreadEvent = (event: Event) => {
    const customEvent = event as CustomEvent<{ threadId?: string }>;
    this.enqueue({
      type: 'thread-data-changed',
      threadId: customEvent.detail?.threadId,
    });
  };
}

export const synchronizationService = new SynchronizationService();
