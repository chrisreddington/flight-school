/**
 * useStoreQuery Hook
 *
 * Subscribes a component to an async query against a stable, repository-
 * style source. Encapsulates the loading-state machine, unmount-safe
 * state updates, and an optional post-load side effect.
 *
 * Replaces the `useState + useEffect + try/catch + isActive-flag`
 * pattern that was duplicated across `useThreads`,
 * `useCustomChallengeQueue`, `useSpacedRepCandidates`, `useUserProfile`,
 * and `useGuidedPlan`.
 *
 * @remarks
 * Behavioural contract:
 * - `data` is `initialValue` until the first successful resolve.
 * - `isLoading` is `true` until the first resolve OR reject completes.
 * - On reject, `data` stays at the most recent resolve (or
 *   `initialValue` if none happened), `error` is set, and `isLoading`
 *   flips to false. Callers that want wipe-on-error semantics should
 *   reset `data` themselves in response to `error`.
 * - `refresh()` re-runs the query and flips `isLoading` back to true.
 * - State updates after unmount are swallowed (no act warning).
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseStoreQueryOptions<T> {
  /** Value of `data` before the first resolve. Defaults to `null as T`. */
  initialValue?: T;
  /** Side effect after each successful load. Errors here are logged but not surfaced. */
  onLoaded?: (value: T) => void | Promise<void>;
  /** Re-run the query when any of these change. Defaults to `[]`. */
  deps?: ReadonlyArray<unknown>;
}

export interface UseStoreQueryResult<T> {
  data: T;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

/**
 * Run an async query and bind the result + lifecycle state into React.
 *
 * @param query - Producer for the value. Re-invoked when `deps` change or `refresh()` fires.
 * @param options - Initial value, post-load hook, and dependency list.
 */
export function useStoreQuery<T>(
  query: () => Promise<T>,
  options: UseStoreQueryOptions<T> = {},
): UseStoreQueryResult<T> {
  const { initialValue = null as T, onLoaded, deps = [] } = options;

  const [data, setData] = useState<T>(initialValue);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Keep refs to query/onLoaded so changing function identity does not
  // re-run the load. Consumers control re-runs through `deps`.
  const queryRef = useRef(query);
  queryRef.current = query;
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  const activeSignalRef = useRef<{ aborted: boolean } | null>(null);

  const run = useCallback(async () => {
    if (activeSignalRef.current) {
      activeSignalRef.current.aborted = true;
    }
    const signal = { aborted: false };
    activeSignalRef.current = signal;

    setIsLoading(true);
    setError(null);
    try {
      const value = await queryRef.current();
      if (signal.aborted) return;
      setData(value);
      const sideEffect = onLoadedRef.current;
      if (sideEffect) {
        try {
          await sideEffect(value);
        } catch {
          // onLoaded errors are isolated: the consumer's data is still valid.
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (!signal.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
    return () => {
      if (activeSignalRef.current) {
        activeSignalRef.current.aborted = true;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, ...deps]);

  const refresh = useCallback(async () => {
    await run();
  }, [run]);

  return { data, isLoading, error, refresh };
}
