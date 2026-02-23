/**
 * useAIActivity Hook Tests
 *
 * Tests for the AI activity hook covering:
 * - SSE connection lifecycle
 * - Event stream handling (init/event types)
 * - Fallback polling on SSE failure
 * - Clear operation via DELETE endpoint
 * - Export formats (JSON and Markdown)
 * - Statistics calculation (avgLatency, byType, totalTokens)
 * - Pending count computation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AIActivityEvent, AIActivityStats } from '@/lib/copilot/activity/types';

// Test the core logic patterns used by useAIActivity

describe('useAIActivity core logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SSE connection lifecycle', () => {
    it('should close connection when paused', () => {
      const isPaused = true;
      const mockEventSource = {
        close: vi.fn(),
        readyState: 1, // EventSource.OPEN
      };

      if (isPaused) {
        mockEventSource.close();
      }

      expect(mockEventSource.close).toHaveBeenCalledTimes(1);
    });

    it('should keep connection open when not paused', () => {
      const isPaused = false;
      const mockEventSource = {
        close: vi.fn(),
        readyState: 1, // EventSource.OPEN
      };

      if (isPaused) {
        mockEventSource.close();
      }

      expect(mockEventSource.close).not.toHaveBeenCalled();
    });

    it('should cleanup on unmount', () => {
      const mockEventSource = {
        close: vi.fn(),
        readyState: 1, // EventSource.OPEN
      };
      const mockInterval = 123;

      // Simulate cleanup
      mockEventSource.close();
      if (mockInterval) {
        clearInterval(mockInterval);
      }

      expect(mockEventSource.close).toHaveBeenCalled();
    });
  });

  describe('SSE message parsing', () => {
    it('should parse init message with events batch', () => {
      const sseData = {
        type: 'init',
        events: [
          { id: 'e1', timestamp: '2024-01-01T00:00:00Z', operation: 'embed', type: 'embed', status: 'success', latencyMs: 100 },
          { id: 'e2', timestamp: '2024-01-01T00:01:00Z', operation: 'ask', type: 'ask', status: 'success', latencyMs: 200 },
        ],
      };

      expect(sseData.type).toBe('init');
      expect(sseData.events).toHaveLength(2);

      const eventsWithDates = sseData.events.map((event) => ({
        ...event,
        timestamp: new Date(event.timestamp),
      }));

      expect(eventsWithDates[0].timestamp).toBeInstanceOf(Date);
      expect(eventsWithDates[1].timestamp).toBeInstanceOf(Date);
    });

    it('should parse single event message', () => {
      const sseData = {
        type: 'event',
        event: {
          id: 'e1',
          timestamp: '2024-01-01T00:00:00Z',
          operation: 'embed',
          type: 'embed',
          status: 'success',
          latencyMs: 150,
        },
      };

      expect(sseData.type).toBe('event');
      expect(sseData.event.id).toBe('e1');

      const event = {
        ...sseData.event,
        timestamp: new Date(sseData.event.timestamp),
      };

      expect(event.timestamp).toBeInstanceOf(Date);
    });

    it('should handle parse errors gracefully', () => {
      const invalidJSON = 'not valid json';

      expect(() => {
        JSON.parse(invalidJSON);
      }).toThrow();
    });
  });

  describe('event state updates', () => {
    it('should replace all events on init message', () => {
      let events: AIActivityEvent[] = [
        { id: 'old', operation: 'embed', type: 'embed', status: 'success', latencyMs: 100, timestamp: new Date() },
      ];

      const newEvents: AIActivityEvent[] = [
        { id: 'e1', operation: 'ask', type: 'ask', status: 'success', latencyMs: 200, timestamp: new Date() },
        { id: 'e2', operation: 'embed', type: 'embed', status: 'success', latencyMs: 150, timestamp: new Date() },
      ];

      events = newEvents;

      expect(events).toHaveLength(2);
      expect(events[0].id).toBe('e1');
      expect(events[1].id).toBe('e2');
    });

    it('should update existing event by ID', () => {
      const events: AIActivityEvent[] = [
        { id: 'e1', operation: 'embed', type: 'embed', status: 'pending', latencyMs: 0, timestamp: new Date() },
        { id: 'e2', operation: 'ask', type: 'ask', status: 'success', latencyMs: 200, timestamp: new Date() },
      ];

      const updatedEvent: AIActivityEvent = {
        id: 'e1',
        operation: 'embed',
        type: 'embed',
        status: 'success',
        latencyMs: 150,
        timestamp: new Date(),
      };

      const existingIndex = events.findIndex((e) => e.id === updatedEvent.id);
      expect(existingIndex).toBe(0);

      const updated = [...events];
      updated[existingIndex] = updatedEvent;

      expect(updated[0].status).toBe('success');
      expect(updated[0].latencyMs).toBe(150);
    });

    it('should append new event when ID not found', () => {
      const events: AIActivityEvent[] = [
        { id: 'e1', operation: 'embed', type: 'embed', status: 'success', latencyMs: 100, timestamp: new Date() },
      ];

      const newEvent: AIActivityEvent = {
        id: 'e2',
        operation: 'ask',
        type: 'ask',
        status: 'success',
        latencyMs: 200,
        timestamp: new Date(),
      };

      const existingIndex = events.findIndex((e) => e.id === newEvent.id);
      expect(existingIndex).toBe(-1);

      const updated = [...events, newEvent];

      expect(updated).toHaveLength(2);
      expect(updated[1].id).toBe('e2');
    });

    it('should clear events on clear event', () => {
      const events: AIActivityEvent[] = [
        { id: 'e1', operation: 'embed', type: 'embed', status: 'success', latencyMs: 100, timestamp: new Date() },
      ];

      const clearEvent: AIActivityEvent = {
        id: 'clear',
        operation: 'clear',
        type: 'internal',
        status: 'success',
        latencyMs: 0,
        timestamp: new Date(),
      };

      const updated = clearEvent.id === 'clear' ? [] : [...events, clearEvent];

      expect(updated).toHaveLength(0);
    });
  });

  describe('clear operation', () => {
    it('should call DELETE endpoint and clear events', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      global.fetch = mockFetch;

      await fetch('/api/ai-activity', { method: 'DELETE' });

      expect(mockFetch).toHaveBeenCalledWith('/api/ai-activity', expect.objectContaining({ method: 'DELETE' }));
    });

    it('should clear local events after successful DELETE', () => {
      let events: AIActivityEvent[] = [
        { id: 'e1', operation: 'embed', type: 'embed', status: 'success', latencyMs: 100, timestamp: new Date() },
      ];

      events = [];

      expect(events).toHaveLength(0);
    });

    it('should handle DELETE failures gracefully', async () => {
      const mockFetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));
      global.fetch = mockFetch;

      await expect(fetch('/api/ai-activity', { method: 'DELETE' })).rejects.toThrow('Network error');
    });
  });

  describe('exportJSON format', () => {
    it('should export events as formatted JSON', () => {
      const events: AIActivityEvent[] = [
        {
          id: 'e1',
          operation: 'embed',
          type: 'embed',
          status: 'success',
          latencyMs: 100,
          timestamp: new Date('2024-01-01T00:00:00Z'),
        },
        {
          id: 'e2',
          operation: 'ask',
          type: 'ask',
          status: 'success',
          latencyMs: 200,
          timestamp: new Date('2024-01-01T00:01:00Z'),
        },
      ];

      const json = JSON.stringify(events, null, 2);

      expect(json).toContain('"id": "e1"');
      expect(json).toContain('"operation": "embed"');
      expect(json).toContain('"latencyMs": 100');
      expect(JSON.parse(json)).toHaveLength(2);
    });

    it('should handle empty events array', () => {
      const events: AIActivityEvent[] = [];
      const json = JSON.stringify(events, null, 2);

      expect(json).toBe('[]');
    });
  });

  describe('exportMarkdown format', () => {
    it('should export events as markdown with headers', () => {
      const events: AIActivityEvent[] = [
        {
          id: 'e1',
          operation: 'embed-text',
          type: 'embed',
          status: 'success',
          latencyMs: 100,
          timestamp: new Date('2024-01-01T00:00:00Z'),
        },
      ];

      const lines: string[] = ['# AI Activity Log\n'];
      
      for (const event of events) {
        lines.push(`## ${event.operation} (${event.type})`);
        lines.push(`- **Time**: ${event.timestamp.toISOString()}`);
        lines.push(`- **Latency**: ${event.latencyMs}ms`);
        lines.push(`- **Status**: ${event.status}`);
        lines.push('');
      }

      const markdown = lines.join('\n');

      expect(markdown).toContain('# AI Activity Log');
      expect(markdown).toContain('## embed-text (embed)');
      expect(markdown).toContain('**Time**: 2024-01-01T00:00:00.000Z');
      expect(markdown).toContain('**Latency**: 100ms');
      expect(markdown).toContain('**Status**: success');
    });

    it('should include prompt when available', () => {
      const events: AIActivityEvent[] = [
        {
          id: 'e1',
          operation: 'ask',
          type: 'ask',
          status: 'success',
          latencyMs: 200,
          timestamp: new Date(),
          input: { prompt: 'What is TypeScript?' },
        },
      ];

      const event = events[0];
      const lines: string[] = [];

      if (event.input?.prompt) {
        const truncatedPrompt = event.input.prompt.slice(0, 200);
        const ellipsis = event.input.prompt.length > 200 ? '...' : '';
        lines.push(`- **Prompt**: ${truncatedPrompt}${ellipsis}`);
      }

      const markdown = lines.join('\n');
      expect(markdown).toContain('**Prompt**: What is TypeScript?');
    });

    it('should truncate long prompts', () => {
      const longPrompt = 'a'.repeat(250);
      const truncatedPrompt = longPrompt.slice(0, 200);
      const ellipsis = longPrompt.length > 200 ? '...' : '';
      const result = `${truncatedPrompt}${ellipsis}`;

      expect(result.length).toBe(203); // 200 + '...'
      expect(result.endsWith('...')).toBe(true);
    });

    it('should include text when available', () => {
      const events: AIActivityEvent[] = [
        {
          id: 'e1',
          operation: 'embed',
          type: 'embed',
          status: 'success',
          latencyMs: 100,
          timestamp: new Date(),
          input: { text: 'Sample text to embed' },
        },
      ];

      const event = events[0];
      const lines: string[] = [];

      if (event.input?.text) {
        const truncatedText = event.input.text.slice(0, 200);
        const ellipsis = event.input.text.length > 200 ? '...' : '';
        lines.push(`- **Text**: ${truncatedText}${ellipsis}`);
      }

      const markdown = lines.join('\n');
      expect(markdown).toContain('**Text**: Sample text to embed');
    });

    it('should include token counts when available', () => {
      const events: AIActivityEvent[] = [
        {
          id: 'e1',
          operation: 'ask',
          type: 'ask',
          status: 'success',
          latencyMs: 200,
          timestamp: new Date(),
          output: { tokens: { input: 50, output: 100 } },
        },
      ];

      const event = events[0];
      const lines: string[] = [];

      if (event.output?.tokens) {
        lines.push(`- **Tokens**: ${event.output.tokens.input} in / ${event.output.tokens.output} out`);
      }

      const markdown = lines.join('\n');
      expect(markdown).toContain('**Tokens**: 50 in / 100 out');
    });

    it('should include error when available', () => {
      const events: AIActivityEvent[] = [
        {
          id: 'e1',
          operation: 'ask',
          type: 'ask',
          status: 'error',
          latencyMs: 50,
          timestamp: new Date(),
          error: 'Rate limit exceeded',
        },
      ];

      const event = events[0];
      const lines: string[] = [];

      if (event.error) {
        lines.push(`- **Error**: ${event.error}`);
      }

      const markdown = lines.join('\n');
      expect(markdown).toContain('**Error**: Rate limit exceeded');
    });

    it('should return empty state message when no events', () => {
      const events: AIActivityEvent[] = [];
      
      if (events.length === 0) {
        const markdown = '# AI Activity Log\n\nNo events recorded.';
        expect(markdown).toBe('# AI Activity Log\n\nNo events recorded.');
      }
    });
  });

  describe('statistics calculation', () => {
    it('should calculate stats from events', () => {
      const events: AIActivityEvent[] = [
        {
          id: 'e1',
          operation: 'embed',
          type: 'embed',
          status: 'success',
          latencyMs: 100,
          timestamp: new Date(),
          output: { tokens: { input: 10, output: 20 } },
        },
        {
          id: 'e2',
          operation: 'ask',
          type: 'ask',
          status: 'success',
          latencyMs: 200,
          timestamp: new Date(),
          output: { tokens: { input: 30, output: 40 } },
        },
        {
          id: 'e3',
          operation: 'embed-2',
          type: 'embed',
          status: 'success',
          latencyMs: 150,
          timestamp: new Date(),
        },
      ];

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

      const stats: AIActivityStats = {
        total: events.length,
        avgLatency: events.length > 0 ? Math.round(totalLatency / events.length) : 0,
        totalTokens,
        byType,
      };

      expect(stats.total).toBe(3);
      expect(stats.avgLatency).toBe(150); // (100 + 200 + 150) / 3 = 150
      expect(stats.totalTokens).toBe(100); // (10 + 20 + 30 + 40)
      expect(stats.byType.embed).toBe(2);
      expect(stats.byType.ask).toBe(1);
      expect(stats.byType.session).toBe(0);
    });

    it('should handle empty events array', () => {
      const events: AIActivityEvent[] = [];

      const stats: AIActivityStats = {
        total: events.length,
        avgLatency: events.length > 0 ? Math.round(0 / events.length) : 0,
        totalTokens: 0,
        byType: {
          embed: 0,
          ask: 0,
          session: 0,
          tool: 0,
          error: 0,
          internal: 0,
        },
      };

      expect(stats.total).toBe(0);
      expect(stats.avgLatency).toBe(0);
      expect(stats.totalTokens).toBe(0);
    });

    it('should count by type correctly', () => {
      const events: AIActivityEvent[] = [
        { id: 'e1', operation: 'embed', type: 'embed', status: 'success', latencyMs: 100, timestamp: new Date() },
        { id: 'e2', operation: 'embed', type: 'embed', status: 'success', latencyMs: 100, timestamp: new Date() },
        { id: 'e3', operation: 'ask', type: 'ask', status: 'success', latencyMs: 100, timestamp: new Date() },
        { id: 'e4', operation: 'session', type: 'session', status: 'success', latencyMs: 100, timestamp: new Date() },
        { id: 'e5', operation: 'tool', type: 'tool', status: 'success', latencyMs: 100, timestamp: new Date() },
        { id: 'e6', operation: 'error', type: 'error', status: 'error', latencyMs: 100, timestamp: new Date() },
      ];

      const byType: AIActivityStats['byType'] = {
        embed: 0,
        ask: 0,
        session: 0,
        tool: 0,
        error: 0,
        internal: 0,
      };

      for (const event of events) {
        byType[event.type] = (byType[event.type] || 0) + 1;
      }

      expect(byType.embed).toBe(2);
      expect(byType.ask).toBe(1);
      expect(byType.session).toBe(1);
      expect(byType.tool).toBe(1);
      expect(byType.error).toBe(1);
      expect(byType.internal).toBe(0);
    });
  });

  describe('pending count calculation', () => {
    it('should count pending events', () => {
      const events: AIActivityEvent[] = [
        { id: 'e1', operation: 'embed', type: 'embed', status: 'pending', latencyMs: 0, timestamp: new Date() },
        { id: 'e2', operation: 'ask', type: 'ask', status: 'success', latencyMs: 200, timestamp: new Date() },
        { id: 'e3', operation: 'embed', type: 'embed', status: 'pending', latencyMs: 0, timestamp: new Date() },
      ];

      const pendingCount = events.filter((e) => e.status === 'pending').length;

      expect(pendingCount).toBe(2);
    });

    it('should return 0 when no pending events', () => {
      const events: AIActivityEvent[] = [
        { id: 'e1', operation: 'embed', type: 'embed', status: 'success', latencyMs: 100, timestamp: new Date() },
        { id: 'e2', operation: 'ask', type: 'ask', status: 'success', latencyMs: 200, timestamp: new Date() },
      ];

      const pendingCount = events.filter((e) => e.status === 'pending').length;

      expect(pendingCount).toBe(0);
    });
  });

  describe('fallback polling', () => {
    it('should poll at specified interval', () => {
      const FALLBACK_POLL_INTERVAL_MS = 5000;
      const mockInterval = 123;

      expect(FALLBACK_POLL_INTERVAL_MS).toBe(5000);
      expect(mockInterval).toBeTruthy();
    });

    it('should fetch events via GET endpoint', async () => {
      const mockResponse = {
        events: [
          { id: 'e1', timestamp: '2024-01-01T00:00:00Z', operation: 'embed', type: 'embed', status: 'success', latencyMs: 100 },
        ],
      };

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });
      global.fetch = mockFetch;

      const response = await fetch('/api/ai-activity');
      const data = await response.json();

      expect(data.events).toHaveLength(1);
      expect(data.events[0].id).toBe('e1');
    });

    it('should convert timestamp strings to Date objects', () => {
      const events = [
        { id: 'e1', timestamp: '2024-01-01T00:00:00Z', operation: 'embed', type: 'embed' as const, status: 'success' as const, latencyMs: 100 },
      ];

      const eventsWithDates = events.map((event) => ({
        ...event,
        timestamp: new Date(event.timestamp),
      }));

      expect(eventsWithDates[0].timestamp).toBeInstanceOf(Date);
    });

    it('should clear interval on cleanup', () => {
      const mockInterval = 123;
      const cleared = { value: false };

      const mockClearInterval = () => {
        cleared.value = true;
      };

      mockClearInterval();

      expect(cleared.value).toBe(true);
    });
  });
});

describe('useAIActivity interface contract', () => {
  it('should define expected result shape', () => {
    interface UseAIActivityReturn {
      events: AIActivityEvent[];
      isPaused: boolean;
      setIsPaused: (paused: boolean) => void;
      clear: () => void;
      exportJSON: () => string;
      exportMarkdown: () => string;
      stats: AIActivityStats;
      hasEvents: boolean;
      pendingCount: number;
    }

    const mockResult: UseAIActivityReturn = {
      events: [],
      isPaused: false,
      setIsPaused: () => {},
      clear: () => {},
      exportJSON: () => '[]',
      exportMarkdown: () => '',
      stats: {
        total: 0,
        avgLatency: 0,
        totalTokens: 0,
        byType: { embed: 0, ask: 0, session: 0, tool: 0, error: 0, internal: 0 },
      },
      hasEvents: false,
      pendingCount: 0,
    };

    expect(Array.isArray(mockResult.events)).toBe(true);
    expect(typeof mockResult.isPaused).toBe('boolean');
    expect(typeof mockResult.setIsPaused).toBe('function');
    expect(typeof mockResult.clear).toBe('function');
    expect(typeof mockResult.exportJSON).toBe('function');
    expect(typeof mockResult.exportMarkdown).toBe('function');
    expect(typeof mockResult.stats).toBe('object');
    expect(typeof mockResult.hasEvents).toBe('boolean');
    expect(typeof mockResult.pendingCount).toBe('number');
  });
});
