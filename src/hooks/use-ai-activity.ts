'use client';

/**
 * React hook for subscribing to AI Activity events
 *
 * Uses Server-Sent Events (SSE) to receive real-time updates from the
 * server-side activity logger. No polling required - events are pushed
 * as they happen.
 *
 * Falls back to polling if SSE connection fails.
 */

import { apiDelete, apiGet } from '@/lib/api-client';
import { logger } from '@/lib/logger';
import type { AIActivityEvent, AIActivityStats } from '@/lib/copilot/activity/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Fallback polling interval if SSE fails */
const FALLBACK_POLL_INTERVAL_MS = 5000;

export interface UseAIActivityReturn {
  /** All activity events (newest last) */
  events: AIActivityEvent[];
  /** Whether event streaming is paused */
  isPaused: boolean;
  /** Toggle pause state */
  setIsPaused: (paused: boolean) => void;
  /** Clear all events */
  clear: () => void;
  /** Export events as JSON string */
  exportJSON: () => string;
  /** Export events as Markdown */
  exportMarkdown: () => string;
  /** Statistics about events */
  stats: AIActivityStats;
  /** Whether there are any events */
  hasEvents: boolean;
  /** Number of pending operations */
  pendingCount: number;
}

export function useAIActivity(): UseAIActivityReturn {
  const [events, setEvents] = useState<AIActivityEvent[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const fallbackIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Use SSE for real-time updates, with polling fallback
  useEffect(() => {
    if (isPaused) {
      // Close SSE connection when paused
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      return;
    }

    // Try SSE first
    const connectSSE = () => {
      const eventSource = new EventSource('/api/ai-activity/stream');
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);

          if (data.type === 'init') {
            // Initial batch of events
            const eventsWithDates = data.events.map((event: AIActivityEvent & { timestamp: string }) => ({
              ...event,
              timestamp: new Date(event.timestamp),
            }));
            setEvents(eventsWithDates);
          } else if (data.type === 'event') {
            // Single event update
            const event = {
              ...data.event,
              timestamp: new Date(data.event.timestamp),
            };

            setEvents((prev) => {
              // Update existing event or add new one
              const existingIndex = prev.findIndex((e) => e.id === event.id);
              if (existingIndex >= 0) {
                const updated = [...prev];
                updated[existingIndex] = event;
                return updated;
              }
              // Handle clear event
              if (event.id === 'clear') {
                return [];
              }
              return [...prev, event];
            });
          }
        } catch (error) {
          logger.error('Failed to parse SSE message', { error }, 'useAIActivity');
        }
      };

      eventSource.onerror = () => {
        logger.warn('SSE connection failed, falling back to polling', undefined, 'useAIActivity');
        eventSource.close();
        eventSourceRef.current = null;
        startFallbackPolling();
      };
    };

    // Fallback polling if SSE fails
    const startFallbackPolling = () => {
      if (fallbackIntervalRef.current) return; // Already polling

      const fetchEvents = async () => {
        try {
          const data = await apiGet<{ events: Array<AIActivityEvent & { timestamp: string }> }>(
            '/api/ai-activity',
            { throwOnError: false }
          );
          
          const eventsWithDates: AIActivityEvent[] = data.events.map(
            (event: AIActivityEvent & { timestamp: string }) => ({
              ...event,
              timestamp: new Date(event.timestamp),
            })
          );
          setEvents(eventsWithDates);
        } catch (error) {
          logger.error('Fallback poll failed', { error }, 'useAIActivity');
        }
      };

      fetchEvents();
      fallbackIntervalRef.current = setInterval(fetchEvents, FALLBACK_POLL_INTERVAL_MS);
    };

    connectSSE();

    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      if (fallbackIntervalRef.current) {
        clearInterval(fallbackIntervalRef.current);
        fallbackIntervalRef.current = null;
      }
    };
  }, [isPaused]);

  const clear = useCallback(async () => {
    try {
      await apiDelete('/api/ai-activity', { throwOnError: false });
      setEvents([]);
    } catch (error) {
      logger.error('Failed to clear events', { error }, 'useAIActivity');
    }
  }, []);

  const exportJSON = useCallback(() => {
    return JSON.stringify(events, null, 2);
  }, [events]);

  const exportMarkdown = useCallback(() => {
    if (events.length === 0) {
      return '# AI Activity Log\n\nNo events recorded.';
    }

    const lines = ['# AI Activity Log\n'];

    for (const event of events) {
      lines.push(`## ${event.operation} (${event.type})`);
      lines.push(`- **Time**: ${event.timestamp.toISOString()}`);
      lines.push(`- **Latency**: ${event.latencyMs}ms`);
      lines.push(`- **Status**: ${event.status}`);

      if (event.input?.prompt) {
        const truncatedPrompt = event.input.prompt.slice(0, 200);
        const ellipsis = event.input.prompt.length > 200 ? '...' : '';
        lines.push(`- **Prompt**: ${truncatedPrompt}${ellipsis}`);
      }
      if (event.input?.text) {
        const truncatedText = event.input.text.slice(0, 200);
        const ellipsis = event.input.text.length > 200 ? '...' : '';
        lines.push(`- **Text**: ${truncatedText}${ellipsis}`);
      }
      if (event.output?.tokens) {
        lines.push(`- **Tokens**: ${event.output.tokens.input} in / ${event.output.tokens.output} out`);
      }
      if (event.error) {
        lines.push(`- **Error**: ${event.error}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }, [events]);

  const stats = useMemo((): AIActivityStats => {
    const byType: AIActivityStats['byType'] = {
      embed: 0,
      ask: 0,
      session: 0,
      tool: 0,
      error: 0,
      internal: 0,
    };

    let totalLatency = 0;
    let totalTokens = 0;

    for (const event of events) {
      byType[event.type] = (byType[event.type] || 0) + 1;
      totalLatency += event.latencyMs;
      if (event.output?.tokens) {
        totalTokens += event.output.tokens.input + event.output.tokens.output;
      }
    }

    return {
      total: events.length,
      avgLatency: events.length > 0 ? Math.round(totalLatency / events.length) : 0,
      totalTokens,
      byType,
    };
  }, [events]);

  const pendingCount = useMemo(() => {
    return events.filter((e) => e.status === 'pending').length;
  }, [events]);

  return {
    events,
    isPaused,
    setIsPaused,
    clear,
    exportJSON,
    exportMarkdown,
    stats,
    hasEvents: events.length > 0,
    pendingCount,
  };
}
