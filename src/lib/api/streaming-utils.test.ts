import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSSEResponse } from './streaming-utils';

/**
 * Creates a "hung" async generator whose first yield never resolves
 * until the test resolves the returned `release` promise. This lets us
 * inspect the connect frame + heartbeat behavior without the generator
 * racing to completion.
 */
function pendingGenerator(): {
  generator: () => AsyncGenerator<{ type: string }, void, undefined>;
  release: () => void;
} {
  let resolveHold: (() => void) | undefined;
  const hold = new Promise<void>((res) => {
    resolveHold = res;
  });

  async function* gen(): AsyncGenerator<{ type: string }, void, undefined> {
    await hold;
  }

  return {
    generator: gen,
    release: () => resolveHold?.(),
  };
}

async function readNextFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder
): Promise<string> {
  const { value, done } = await reader.read();
  if (done) return '';
  return decoder.decode(value);
}

describe('createSSEResponse heartbeats', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends ": connected" as the first frame on stream open', async () => {
    const { generator, release } = pendingGenerator();
    const response = createSSEResponse(generator);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    const first = await readNextFrame(reader, decoder);
    expect(first).toBe(': connected\n\n');

    release();
    await reader.cancel();
  });

  it('enqueues ": heartbeat" after 25s without any event', async () => {
    const { generator, release } = pendingGenerator();
    const response = createSSEResponse(generator);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // Consume the initial ": connected" frame first.
    await readNextFrame(reader, decoder);

    // Nothing should be pending yet — advance by just under 25s.
    await vi.advanceTimersByTimeAsync(24_999);

    // Now cross the 25s threshold; a heartbeat should be enqueued.
    await vi.advanceTimersByTimeAsync(2);

    const second = await readNextFrame(reader, decoder);
    expect(second).toBe(': heartbeat\n\n');

    release();
    await reader.cancel();
  });

  it('clears the heartbeat interval handle when the consumer cancels (M4)', async () => {
    // Spy on BOTH setInterval and clearInterval *before* opening the stream so
    // we can capture the exact interval handle createSSEResponse allocated and
    // then assert that the cancel() path passed that same handle to clearInterval.
    // This protects against a resource-leak regression where cancel forgets to
    // tear down the interval but the heartbeat-frame absence test still passes
    // (because the callback short-circuits on a closed controller).
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');

    const { generator, release } = pendingGenerator();
    const response = createSSEResponse(generator);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // Connected frame and the first heartbeat establish that the interval is live.
    await readNextFrame(reader, decoder);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await readNextFrame(reader, decoder)).toBe(': heartbeat\n\n');

    // setInterval must have been called exactly once by createSSEResponse;
    // capture the handle so we can match it on the clearInterval side.
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    const intervalHandle = setIntervalSpy.mock.results[0].value;

    // Consumer cancels — interval should be torn down with the same handle.
    await reader.cancel();
    expect(clearSpy).toHaveBeenCalledWith(intervalHandle);

    release();
    setIntervalSpy.mockRestore();
    clearSpy.mockRestore();
  });

  it('does not start a heartbeat interval when heartbeatMs is 0 (M1)', async () => {
    // Replaces the previous flaky test that mixed fake + real timers. We now
    // (a) assert directly on setInterval that no interval was scheduled and
    // (b) drain every queued frame after the generator finishes to prove
    // empirically that no `: heartbeat` frame was ever enqueued.
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const { generator, release } = pendingGenerator();

    const response = createSSEResponse(generator, { heartbeatMs: 0 });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // Initial connect frame still arrives.
    expect(await readNextFrame(reader, decoder)).toBe(': connected\n\n');

    // No interval was scheduled by createSSEResponse — this is the primary
    // invariant. Stays true regardless of how much fake time elapses below.
    expect(setIntervalSpy).not.toHaveBeenCalled();

    // Burn far more than one heartbeat period of fake time. If a stray
    // setInterval had slipped in we'd see it on the spy AND see a heartbeat
    // frame after we drain the stream below.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(setIntervalSpy).not.toHaveBeenCalled();

    // Let the held generator complete; the stream closes naturally afterwards.
    release();

    // Drain the rest of the stream and prove no `: heartbeat\n\n` frame ever
    // landed in the queue. Reading until done is fully deterministic under
    // fake timers because no real-time `setTimeout` is in play.
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const frame = decoder.decode(value);
      expect(frame).not.toBe(': heartbeat\n\n');
    }

    setIntervalSpy.mockRestore();
  });

  it('also disables heartbeat when heartbeatMs is false (M1)', async () => {
    // Mirrors the `heartbeatMs: 0` test using the same drain pattern so the
    // `false` path is covered without re-introducing a real-timer race.
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const { generator, release } = pendingGenerator();

    const response = createSSEResponse(generator, { heartbeatMs: false });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    expect(await readNextFrame(reader, decoder)).toBe(': connected\n\n');
    expect(setIntervalSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(setIntervalSpy).not.toHaveBeenCalled();

    release();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const frame = decoder.decode(value);
      expect(frame).not.toBe(': heartbeat\n\n');
    }

    setIntervalSpy.mockRestore();
  });
});

describe('createSSEResponse event delivery', () => {
  // Keep event-delivery tests using real timers so the async generator can run normally.
  it('streams generator events as data frames followed by [DONE]', async () => {
    async function* gen(): AsyncGenerator<{ type: string; value: number }, void, undefined> {
      yield { type: 'tick', value: 1 };
      yield { type: 'tick', value: 2 };
    }

    const response = createSSEResponse(gen, { heartbeatMs: 0 });
    const text = await response.text();

    expect(text).toContain(': connected\n\n');
    expect(text).toContain('data: {"type":"tick","value":1}\n\n');
    expect(text).toContain('data: {"type":"tick","value":2}\n\n');
    expect(text).toContain('data: [DONE]\n\n');
  });
});
