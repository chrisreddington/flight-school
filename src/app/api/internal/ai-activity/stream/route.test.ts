import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  ensureHydrated: vi.fn(),
}));

vi.mock('../auth', () => ({
  authorizeInternalActivity: mocks.authorize,
}));

vi.mock('@/lib/copilot/activity/logger-worker', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/lib/copilot/activity/logger-worker')
  >();
  return {
    ...actual,
    // Spy on hydration so we don't touch disk in tests.
    activityLoggerWorker: {
      ...actual.activityLoggerWorker,
      ensureHydrated: mocks.ensureHydrated,
    },
  };
});

vi.mock('@/lib/observability/context-propagation', () => ({
  withExtractedTraceContext: (
    _headers: Headers,
    fn: () => Promise<Response>,
  ) => fn(),
}));

import { NextRequest } from 'next/server';

import { activityBus } from '@/lib/copilot/activity/activity-bus';
import type { AIActivityEvent } from '@/lib/copilot/activity/types';

import { GET } from './route';

function mkEvent(overrides: Partial<AIActivityEvent> = {}): AIActivityEvent {
  return {
    id: 'evt-1',
    userId: 'user-1',
    timestamp: new Date('2026-05-24T00:00:00.000Z'),
    type: 'ask',
    operation: 'ask',
    latencyMs: 0,
    status: 'pending',
    ...overrides,
  };
}

async function readSSEPayloads(response: Response, take: number): Promise<string[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const payloads: string[] = [];
  let buffer = '';
  while (payloads.length < take) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = frame
        .split('\n')
        .find((line) => line.startsWith('data: '));
      if (dataLine) payloads.push(dataLine.slice('data: '.length));
      if (payloads.length >= take) break;
    }
  }
  await reader.cancel().catch(() => undefined);
  return payloads;
}

describe('GET /api/internal/ai-activity/stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activityBus.__resetForTests();
    mocks.authorize.mockReturnValue({
      ok: true,
      auth: { userId: 'user-1' },
    });
    mocks.ensureHydrated.mockResolvedValue(undefined);
  });

  afterEach(() => {
    activityBus.__resetForTests();
  });

  it('emits an `init` frame (replace semantics) on first connect with no cursor', async () => {
    activityBus.append('user-1', mkEvent({ id: 'a' }));
    activityBus.append('user-1', mkEvent({ id: 'b' }));

    const request = new NextRequest('http://localhost/api/internal/ai-activity/stream');
    const response = await GET(request as never);

    const [first] = await readSSEPayloads(response, 1);
    const parsed = JSON.parse(first) as {
      type: string;
      events: Array<{ id: string }>;
      cursor: string | null;
    };
    expect(parsed.type).toBe('init');
    expect(parsed.events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(parsed.cursor).toBe('b');
  });

  it('does NOT emit an `init` frame when the cursor resolves to a replay (inclusive)', async () => {
    // Regression: previously the route emitted `{type:'init',events:[]}`
    // for replay mode, which wiped the client's existing list.
    activityBus.append('user-1', mkEvent({ id: 'a' }));
    activityBus.append('user-1', mkEvent({ id: 'b' }));
    activityBus.append('user-1', mkEvent({ id: 'c' }));

    const request = new NextRequest(
      'http://localhost/api/internal/ai-activity/stream?cursor=b',
    );
    const response = await GET(request as never);

    const payloads = await readSSEPayloads(response, 2);
    const frames = payloads.map((p) => JSON.parse(p));
    // First two frames must be inclusive replay `event` frames starting
    // at the cursor — no `init` should appear at the head of the stream.
    expect(frames[0].type).toBe('event');
    expect(frames[0].event.id).toBe('b');
    expect(frames[1].type).toBe('event');
    expect(frames[1].event.id).toBe('c');
  });

  it('emits a full `init` frame when the cursor is unknown/evicted', async () => {
    activityBus.append('user-1', mkEvent({ id: 'a' }));
    activityBus.append('user-1', mkEvent({ id: 'b' }));

    const request = new NextRequest(
      'http://localhost/api/internal/ai-activity/stream?cursor=ghost',
    );
    const response = await GET(request as never);

    const [first] = await readSSEPayloads(response, 1);
    const parsed = JSON.parse(first) as {
      type: string;
      events: Array<{ id: string }>;
    };
    expect(parsed.type).toBe('init');
    expect(parsed.events.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('rejects unauthenticated requests via authorizeInternalActivity', async () => {
    mocks.authorize.mockReturnValueOnce({
      ok: false,
      response: new Response('unauthorized', { status: 401 }),
    });
    const request = new NextRequest('http://localhost/api/internal/ai-activity/stream');
    const response = await GET(request as never);
    expect(response.status).toBe(401);
  });
});
