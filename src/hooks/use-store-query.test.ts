import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useStoreQuery } from './use-store-query';

/**
 * Behavioural test suite for useStoreQuery. This is the canonical
 * exemplar referenced by the tests-that-respect-boundaries skill:
 * no module-under-test mocks, all assertions are on `result.current`.
 */
describe('useStoreQuery — lifecycle', () => {
  it('exposes initialValue and isLoading=true before the first resolve', async () => {
    const query = vi.fn(() => new Promise<number[]>(() => {}));
    const { result } = renderHook(() => useStoreQuery(query, { initialValue: [] }));
    expect(result.current.data).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('flips data + isLoading after a successful resolve', async () => {
    const query = vi.fn(async () => [1, 2, 3]);
    const { result } = renderHook(() => useStoreQuery(query, { initialValue: [] }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual([1, 2, 3]);
    expect(result.current.error).toBeNull();
  });

  it('sets error and keeps initialValue when the query rejects', async () => {
    const query = vi.fn(async () => {
      throw new Error('boom');
    });
    const { result } = renderHook(() => useStoreQuery(query, { initialValue: [] as number[] }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual([]);
    expect(result.current.error).toEqual(new Error('boom'));
  });

  it('wraps non-Error throws in an Error instance', async () => {
    const query = vi.fn(async () => {
      throw 'string error';
    });
    const { result } = renderHook(() => useStoreQuery(query));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toEqual(new Error('string error'));
  });
});

describe('useStoreQuery — refresh', () => {
  it('re-runs the query and toggles isLoading', async () => {
    let counter = 0;
    const query = vi.fn(async () => ++counter);
    const { result } = renderHook(() => useStoreQuery(query, { initialValue: 0 }));
    await waitFor(() => expect(result.current.data).toBe(1));

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.data).toBe(2);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('clears stale error on successful refresh', async () => {
    let shouldFail = true;
    const query = vi.fn(async () => {
      if (shouldFail) throw new Error('first');
      return [42];
    });
    const { result } = renderHook(() => useStoreQuery(query, { initialValue: [] as number[] }));
    await waitFor(() => expect(result.current.error).toEqual(new Error('first')));

    shouldFail = false;
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual([42]);
  });
});

describe('useStoreQuery — onLoaded', () => {
  it('invokes onLoaded with the resolved value', async () => {
    const onLoaded = vi.fn();
    const query = vi.fn(async () => ({ id: 'x' }));
    renderHook(() => useStoreQuery(query, { onLoaded }));
    await waitFor(() => expect(onLoaded).toHaveBeenCalledWith({ id: 'x' }));
  });

  it('isolates onLoaded errors so data/error state stays clean', async () => {
    const query = vi.fn(async () => [1]);
    const onLoaded = vi.fn(async () => {
      throw new Error('post-load failed');
    });
    const { result } = renderHook(() => useStoreQuery(query, { initialValue: [] as number[], onLoaded }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual([1]);
    expect(result.current.error).toBeNull();
  });
});

describe('useStoreQuery — unmount safety', () => {
  it('does not set state after unmount', async () => {
    let resolveQuery!: (value: number[]) => void;
    const query = vi.fn(
      () =>
        new Promise<number[]>((resolve) => {
          resolveQuery = resolve;
        }),
    );
    const { result, unmount } = renderHook(() => useStoreQuery(query, { initialValue: [] as number[] }));
    unmount();
    await act(async () => {
      resolveQuery([99]);
      await Promise.resolve();
    });
    expect(result.current.data).toEqual([]);
  });
});

describe('useStoreQuery — deps', () => {
  it('re-runs the query when deps change', async () => {
    const query = vi.fn(async (id: number) => id * 10);
    const { result, rerender } = renderHook(
      ({ id }) => useStoreQuery(() => query(id), { initialValue: 0, deps: [id] }),
      { initialProps: { id: 1 } },
    );
    await waitFor(() => expect(result.current.data).toBe(10));
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.data).toBe(20));
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not re-run when deps are stable across renders', async () => {
    const query = vi.fn(async () => 1);
    const { result, rerender } = renderHook(() => useStoreQuery(query, { initialValue: 0 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    rerender();
    rerender();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
