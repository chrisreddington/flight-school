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

  it('stops emitting heartbeats after the consumer cancels', async () => {
    const { generator, release } = pendingGenerator();
    const response = createSSEResponse(generator);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // Connected frame.
    await readNextFrame(reader, decoder);

    // First heartbeat.
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await readNextFrame(reader, decoder)).toBe(': heartbeat\n\n');

    // Consumer cancels — interval should be torn down.
    await reader.cancel();

    // Spy on clearInterval to catch any further attempts (none expected since interval was cleared).
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');

    // Advance well past several heartbeat intervals. If the interval were still
    // running its callback would fire and (since the controller is closed) clear
    // itself via clearHeartbeat — that would show up on the spy.
    await vi.advanceTimersByTimeAsync(75_000);

    expect(clearSpy).not.toHaveBeenCalled();
    release();
    clearSpy.mockRestore();
  });

  it('does not start a heartbeat interval when heartbeatMs is 0', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const { generator, release } = pendingGenerator();

    const response = createSSEResponse(generator, { heartbeatMs: 0 });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // Initial connect frame still arrives.
    expect(await readNextFrame(reader, decoder)).toBe(': connected\n\n');

    // No interval was created by createSSEResponse.
    expect(setIntervalSpy).not.toHaveBeenCalled();

    // Advance time — no heartbeat frame should appear. Race a short
    // real-time timeout against the next read to assert absence.
    const racePromise = Promise.race([
      reader.read().then(() => 'frame' as const),
      new Promise<'idle'>((res) => setTimeout(() => res('idle'), 100)),
    ]);
    await vi.advanceTimersByTimeAsync(60_000);
    // Drain pending real-time setTimeout.
    vi.useRealTimers();
    const winner = await racePromise;
    expect(winner).toBe('idle');
    vi.useFakeTimers();

    release();
    await reader.cancel();
    setIntervalSpy.mockRestore();
  });

  it('also disables heartbeat when heartbeatMs is false', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const { generator, release } = pendingGenerator();

    const response = createSSEResponse(generator, { heartbeatMs: false });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    expect(await readNextFrame(reader, decoder)).toBe(': connected\n\n');
    expect(setIntervalSpy).not.toHaveBeenCalled();

    release();
    await reader.cancel();
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
