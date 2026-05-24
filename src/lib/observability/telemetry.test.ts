import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const histogramRecords: Array<{ name: string; value: number; attributes?: Record<string, unknown> }> = [];
  const counterRecords: Array<{ name: string; value: number; attributes?: Record<string, unknown> }> = [];

  return {
    counterRecords,
    histogramRecords,
    startSpan: vi.fn(() => ({
      end: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
    })),
    traceSetSpan: vi.fn(() => ({})),
    traceGetSpan: vi.fn(() => undefined),
    createCounter: vi.fn((name: string) => ({
      add: (value: number, attributes?: Record<string, unknown>) => {
        counterRecords.push({ name, value, attributes });
      },
    })),
    createHistogram: vi.fn((name: string) => ({
      record: (value: number, attributes?: Record<string, unknown>) => {
        histogramRecords.push({ name, value, attributes });
      },
    })),
  };
});

vi.mock('@opentelemetry/api', () => ({
  SpanStatusCode: { OK: 1, ERROR: 2 },
  context: {
    active: vi.fn(() => ({})),
    with: vi.fn(async (_ctx: unknown, callback: () => Promise<unknown>) => await callback()),
  },
  metrics: {
    getMeter: vi.fn(() => ({
      createHistogram: mocks.createHistogram,
      createCounter: mocks.createCounter,
    })),
  },
  trace: {
    getTracer: vi.fn(() => ({
      startSpan: mocks.startSpan,
    })),
    setSpan: mocks.traceSetSpan,
    getSpan: mocks.traceGetSpan,
  },
}));

import {
  recordAiStreamMetrics,
  recordJobQueueWait,
} from './telemetry';

describe('telemetry stream and queue metrics', () => {
  beforeEach(() => {
    mocks.histogramRecords.length = 0;
    mocks.counterRecords.length = 0;
  });

  it('records stream lifecycle metrics with stable attributes', () => {
    recordAiStreamMetrics({
      model: 'claude-haiku-4.5',
      mcpEnabled: true,
      poolHit: false,
      firstTokenMs: 180,
      durationMs: 2500,
      deltaCount: 12,
      deltaBytes: 960,
      toolCalls: 2,
      terminalState: 'completed',
    });

    expect(mocks.histogramRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'gen_ai.client.operation.time_to_first_chunk',
        value: 0.18,
      }),
      expect.objectContaining({
        name: 'flight_school.ai.stream.delta_count',
        value: 12,
      }),
      expect.objectContaining({
        name: 'flight_school.ai.stream.delta_bytes',
        value: 960,
      }),
    ]));
    expect(mocks.counterRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'flight_school.ai.stream.tool_calls',
        value: 2,
      }),
    ]));
  });

  it('records worker queue wait metric by job type', () => {
    recordJobQueueWait(420, 'chat-response');

    expect(mocks.histogramRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'flight_school.jobs.queue_wait',
        value: 0.42,
      }),
    ]));
  });
});
