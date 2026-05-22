import { describe, expect, it, vi } from 'vitest';
import { createPerUserRuntimePool } from './per-user-pool';

describe('createPerUserRuntimePool', () => {
  it('reuses a runtime for the same user', async () => {
    const disconnect = vi.fn();
    const createRuntime = vi.fn(async (userId: string) => ({ userId, disconnect }));
    const onEvent = vi.fn();
    const pool = createPerUserRuntimePool({ createRuntime, idleTtlMs: 60_000, maxActiveRuntimes: 2, onEvent });

    const first = await pool.getRuntime('123');
    const second = await pool.getRuntime('123');

    expect(first).toBe(second);
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'created', userId: '123' });
    expect(onEvent).toHaveBeenCalledWith({ type: 'reused', userId: '123' });
  });

  it('shares concurrent runtime creation for the same user', async () => {
    const disconnect = vi.fn();
    const createRuntime = vi.fn(async (userId: string) => ({ userId, disconnect }));
    const pool = createPerUserRuntimePool({ createRuntime, idleTtlMs: 60_000, maxActiveRuntimes: 2 });

    const [first, second] = await Promise.all([
      pool.getRuntime('123'),
      pool.getRuntime('123'),
    ]);

    expect(first).toBe(second);
    expect(createRuntime).toHaveBeenCalledTimes(1);
  });

  it('evicts the least recently used runtime when capacity is exceeded', async () => {
    let currentTime = 0;
    const disconnects = new Map<string, ReturnType<typeof vi.fn>>();
    const createRuntime = vi.fn(async (userId: string) => {
      const disconnect = vi.fn();
      disconnects.set(userId, disconnect);
      return { userId, disconnect };
    });
    const pool = createPerUserRuntimePool({
      createRuntime,
      idleTtlMs: 60_000,
      maxActiveRuntimes: 2,
      now: () => currentTime,
    });

    await pool.getRuntime('123');
    currentTime = 1;
    await pool.getRuntime('456');
    currentTime = 2;
    await pool.getRuntime('789');

    expect(disconnects.get('123')).toHaveBeenCalledTimes(1);
    expect(disconnects.get('456')).not.toHaveBeenCalled();
    expect(disconnects.get('789')).not.toHaveBeenCalled();
    expect(createRuntime).toHaveBeenCalledTimes(3);
  });

  it('evicts idle runtimes before returning a runtime', async () => {
    let currentTime = 0;
    const disconnect = vi.fn();
    const createRuntime = vi.fn(async (userId: string) => ({ userId, disconnect }));
    const pool = createPerUserRuntimePool({
      createRuntime,
      idleTtlMs: 100,
      maxActiveRuntimes: 2,
      now: () => currentTime,
    });

    await pool.getRuntime('123');
    currentTime = 101;
    await pool.getRuntime('456');

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(createRuntime).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid runtime capacity', () => {
    const createRuntime = vi.fn(async (userId: string) => ({ userId, disconnect: vi.fn() }));

    expect(() => createPerUserRuntimePool({
      createRuntime,
      idleTtlMs: 60_000,
      maxActiveRuntimes: 0,
    })).toThrow('maxActiveRuntimes must be at least 1');
  });
});
