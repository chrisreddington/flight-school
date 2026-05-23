import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AIActivityEvent } from './types';

const mocks = vi.hoisted(() => ({
  ensureDir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
}));

vi.mock('@/lib/storage/utils', () => ({
  ensureDir: mocks.ensureDir,
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
  deleteFile: mocks.deleteFile,
}));

import {
  appendShadowActivityEvent,
  clearShadowActivityEvents,
  loadShadowActivityEvents,
  updateShadowActivityMetrics,
} from './shadow-store';

function mkEvent(overrides: Partial<AIActivityEvent> = {}): AIActivityEvent {
  return {
    id: 'evt-1',
    userId: 'user-1',
    timestamp: new Date('2026-05-24T00:00:01.000Z'),
    type: 'ask',
    operation: 'ask',
    latencyMs: 0,
    status: 'pending',
    ...overrides,
  };
}

describe('shadow-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readFile.mockResolvedValue(null);
  });

  it('appends activity events to durable user shadow storage', async () => {
    await appendShadowActivityEvent(mkEvent());

    expect(mocks.ensureDir).toHaveBeenCalledWith('users/user-1/activity', { mode: 0o700 });
    expect(mocks.writeFile).toHaveBeenCalledWith(
      'users/user-1/activity',
      'events.json',
      expect.any(String),
    );
    const written = JSON.parse(mocks.writeFile.mock.calls[0][2]) as {
      events: Array<{ id: string; timestamp: string }>;
    };
    expect(written.events[0]).toEqual(
      expect.objectContaining({
        id: 'evt-1',
        timestamp: '2026-05-24T00:00:01.000Z',
      }),
    );
  });

  it('loads and hydrates shadow events back into Date objects', async () => {
    mocks.readFile.mockResolvedValueOnce(
      JSON.stringify({
        version: 1,
        events: [
          {
            id: 'evt-1',
            userId: 'user-1',
            timestamp: '2026-05-24T00:00:01.000Z',
            type: 'ask',
            operation: 'ask',
            latencyMs: 0,
            status: 'pending',
          },
        ],
      }),
    );

    const events = await loadShadowActivityEvents('user-1');

    expect(events).toHaveLength(1);
    expect(events[0].timestamp).toBeInstanceOf(Date);
    expect(events[0].id).toBe('evt-1');
  });

  it('updates client metrics on existing shadow events', async () => {
    mocks.readFile.mockResolvedValueOnce(
      JSON.stringify({
        version: 1,
        events: [
          {
            id: 'evt-1',
            userId: 'user-1',
            timestamp: '2026-05-24T00:00:01.000Z',
            type: 'ask',
            operation: 'ask',
            latencyMs: 0,
            status: 'pending',
            input: {},
          },
        ],
      }),
    );

    const updated = await updateShadowActivityMetrics('user-1', 'evt-1', {
      firstTokenMs: 42,
      totalMs: 240,
    });

    expect(updated).toBe(true);
    const written = JSON.parse(mocks.writeFile.mock.calls[0][2]) as {
      events: Array<{ latencyMs: number; input: { clientMetrics: { totalMs: number } } }>;
    };
    expect(written.events[0].latencyMs).toBe(240);
    expect(written.events[0].input.clientMetrics.totalMs).toBe(240);
  });

  it('clears shadow events for one user', async () => {
    await clearShadowActivityEvents('user-1');

    expect(mocks.deleteFile).toHaveBeenCalledWith('users/user-1/activity', 'events.json');
  });
});
