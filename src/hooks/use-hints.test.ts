/**
 * useHints — behaviour suite. Mocks live at the system seam (`fetch`)
 * only: the hook, abort controllers, and message id generation all run
 * for real.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, type Mock } from 'vitest';

import type { ChallengeDef } from '@/lib/copilot/types';

import { useHints } from './use-hints';

const fetchMock = global.fetch as unknown as Mock;

const challenge: ChallengeDef = {
  title: 'Sum',
  description: 'Add two numbers',
  language: 'TypeScript',
  difficulty: 'easy',
  starterCode: '',
  hiddenTests: '',
  visibleTests: '',
  solutionCode: '',
};

function okJson(body: unknown) {
  return { ok: true, status: 200, headers: new Headers(), json: async () => body };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('useHints — requestHint', () => {
  it('passes the latest currentCode (via ref) when the hint is requested', async () => {
    fetchMock.mockImplementation(async () => okJson({ success: true, hint: 'try a loop' }));

    let currentCode = 'first';
    const getCurrentCode = () => currentCode;

    // The unused destructured parameter forces a real prop change so
    // React re-runs the hook, exercising the ref-update effect path.
    const { result, rerender } = renderHook(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ({ code }: { code: string }) => useHints({ challenge, getCurrentCode }),
      { initialProps: { code: currentCode } },
    );

    currentCode = 'second';
    rerender({ code: currentCode });

    await act(async () => {
      await result.current.requestHint('what next?');
    });

    expect(fetchMock.mock.calls.length).toBe(1);
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? '{}');
    expect(body.currentCode).toBe('second');
    expect(result.current.hints).toHaveLength(1);
    expect(result.current.hints[0]?.response.hint).toBe('try a loop');
    expect(result.current.isLoadingHint).toBe(false);
    expect(result.current.hintError).toBeNull();
  });

  it('surfaces the error message when the API reports failure', async () => {
    fetchMock.mockImplementation(async () => okJson({ success: false, hint: '', error: 'rate limited' }));

    const { result } = renderHook(() => useHints({ challenge, getCurrentCode: () => '' }));

    await act(async () => {
      await result.current.requestHint('why?');
    });

    expect(result.current.hintError).toBe('rate limited');
    expect(result.current.hints).toHaveLength(0);
    expect(result.current.isLoadingHint).toBe(false);
  });

  it('ignores re-entrant requests while a hint is already in flight', async () => {
    let resolveFetch!: (value: ReturnType<typeof okJson>) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<ReturnType<typeof okJson>>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const { result } = renderHook(() => useHints({ challenge, getCurrentCode: () => '' }));

    let firstCall!: Promise<void>;
    act(() => {
      firstCall = result.current.requestHint('q1');
    });
    await waitFor(() => expect(result.current.isLoadingHint).toBe(true));

    await act(async () => {
      await result.current.requestHint('q2');
    });
    expect(fetchMock.mock.calls.length).toBe(1);

    resolveFetch(okJson({ success: true, hint: 'h1' }));
    await act(async () => {
      await firstCall;
    });

    expect(result.current.hints).toHaveLength(1);
    expect(result.current.hints[0]?.question).toBe('q1');
  });
});

describe('useHints — stop / clear / reset', () => {
  it('clearHints empties the list and error without affecting loading state', async () => {
    fetchMock.mockImplementation(async () => okJson({ success: true, hint: 'h1' }));

    const { result } = renderHook(() => useHints({ challenge, getCurrentCode: () => '' }));

    await act(async () => {
      await result.current.requestHint('q1');
    });
    expect(result.current.hints).toHaveLength(1);

    act(() => {
      result.current.clearHints();
    });
    expect(result.current.hints).toEqual([]);
    expect(result.current.hintError).toBeNull();
  });

  it('resetHints clears state and stops any in-flight request', async () => {
    fetchMock.mockImplementation(
      () => new Promise(() => undefined), // never resolves
    );

    const { result } = renderHook(() => useHints({ challenge, getCurrentCode: () => '' }));

    act(() => {
      void result.current.requestHint('q1');
    });
    await waitFor(() => expect(result.current.isLoadingHint).toBe(true));

    act(() => {
      result.current.resetHints();
    });

    expect(result.current.hints).toEqual([]);
    expect(result.current.hintError).toBeNull();
    expect(result.current.isLoadingHint).toBe(false);
  });
});
