import { useSyncExternalStore } from 'react';

/**
 * Returns `false` during server rendering and the first client render, then
 * `true` once the component has hydrated on the client.
 *
 * Use this to gate values that depend on browser-only state (the visitor's
 * local clock, `window`, `localStorage`, etc.). Reading such state during SSR
 * bakes in the server's environment and mismatches the client on hydration;
 * gating on this flag guarantees the server and the first client render agree,
 * so the browser-derived value only appears after hydration completes.
 *
 * Implemented with `useSyncExternalStore` rather than a `useState` +
 * `useEffect` mount flag so there is no `setState`-in-effect and the server
 * snapshot is honoured during hydration.
 */
export function useHasMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, getMountedClientSnapshot, getMountedServerSnapshot);
}

/** No external source changes this value, so the subscription is a no-op. */
function subscribeNoop(): () => void {
  return () => {};
}

function getMountedClientSnapshot(): boolean {
  return true;
}

function getMountedServerSnapshot(): boolean {
  return false;
}
