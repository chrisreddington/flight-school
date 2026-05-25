/**
 * Adaptive typewriter pacing for live-streamed chat text.
 *
 * Upstream tokens arrive in bursts — the Copilot SDK may emit a clump of
 * 30 chars then go quiet for 200ms then emit 5 chars. Rendering each
 * burst directly produces a visible stutter. This hook decouples the
 * arrival cadence from the render cadence: it accepts a monotonically
 * growing `target` and advances a `displayed` substring toward it via
 * `requestAnimationFrame` at a rate that scales with the current
 * backlog. Small backlogs feel like a typewriter; large backlogs catch
 * up quickly; very large backlogs (snapshot/terminal flush) snap.
 *
 * Resetting between streams is driven by `streamKey`: when the caller
 * passes a new key (e.g. a new `assistantMessageId`), the buffer
 * empties so the next stream starts at character zero.
 */
import { useEffect, useRef, useState } from 'react';

/** Cap perceived scroll velocity even when the backlog is huge. */
const MAX_CHARS_PER_FRAME = 40;

/**
 * Backlog size at which we abandon pacing and snap to the target.
 * Reached when a terminal snapshot arrives with the full response.
 */
const SNAP_THRESHOLD = 800;

/**
 * `ceil(backlog / CATCHUP_DIVISOR)` characters per frame, so a 16-char
 * backlog drains at 2/frame and a 200-char backlog drains at 25/frame.
 */
const CATCHUP_DIVISOR = 8;

const isBrowserEnv = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function';

/**
 * Returns a smoothed substring of `target` that grows steadily over
 * animation frames rather than jumping with each upstream burst.
 *
 * @param target - Full text accumulated so far (grows monotonically
 *   within a single stream).
 * @param streamKey - Stable identifier for the current stream. When it
 *   changes, the buffer resets to the empty string.
 */
export function useSmoothedText(target: string, streamKey: string | null): string {
  // In SSR / test environments without rAF, render the target directly
  // so server-rendered output is complete and tests don't have to wait
  // for animation frames that never run.
  const [displayed, setDisplayed] = useState(isBrowserEnv ? '' : target);
  const targetRef = useRef(target);
  const streamKeyRef = useRef(streamKey);
  const displayedLenRef = useRef(isBrowserEnv ? 0 : target.length);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isBrowserEnv) return;

    targetRef.current = target;
    if (streamKey !== streamKeyRef.current) {
      streamKeyRef.current = streamKey;
      displayedLenRef.current = 0;
    }

    if (rafRef.current !== null) return;
    if (displayedLenRef.current >= target.length) return;

    const tick = (): void => {
      const liveTarget = targetRef.current;
      const displayedLen = displayedLenRef.current;
      const backlog = liveTarget.length - displayedLen;

      if (backlog <= 0) {
        rafRef.current = null;
        return;
      }

      const shouldSnap = backlog >= SNAP_THRESHOLD;
      const charsThisFrame = shouldSnap
        ? backlog
        : Math.min(MAX_CHARS_PER_FRAME, Math.max(1, Math.ceil(backlog / CATCHUP_DIVISOR)));
      const nextLen = displayedLen + charsThisFrame;
      displayedLenRef.current = nextLen;
      setDisplayed(liveTarget.slice(0, nextLen));

      if (nextLen < liveTarget.length) {
        rafRef.current = window.requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [target, streamKey]);

  return displayed;
}
